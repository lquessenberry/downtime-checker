//! HTTP and server-sent events for the globe HUD.
//!
//! The JSON event names match `visualizer/server.mjs`: `hello`, `scan-start`,
//! `result`, `locating`, `location`, `scan-done`, `scan-stop`, and `error`.

#![deny(unsafe_code)]

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use downtime_core::{
    blast_card, blast_rings, first_public_ipv4, is_public_ipv4, locate, places_for, BlastShot,
    Loaded, LocateMode, Place, Report, Status, KT_PRESETS, LOOKUP_WORKERS,
};
use downtime_native::{
    cache_record, check_all, load_catalog_dir, lookup_ipwho, read_cache, record_value, write_cache,
    HostCheck,
};
use serde_json::{json, Map, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, watch, Semaphore};

pub struct ServerConfig {
    pub root: PathBuf,
    pub static_dir: PathBuf,
    pub workers: usize,
    pub lookup: bool,
}

struct ScanState {
    running: bool,
    scan_id: u64,
    heading: String,
    search_id: String,
    total: usize,
    done: usize,
    up: usize,
    down: usize,
    started_at_ms: u64,
    finished_at_ms: u64,
    results: Vec<Value>,
}

impl ScanState {
    fn idle() -> Self {
        Self {
            running: false,
            scan_id: 0,
            heading: String::new(),
            search_id: String::new(),
            total: 0,
            done: 0,
            up: 0,
            down: 0,
            started_at_ms: 0,
            finished_at_ms: 0,
            results: Vec::new(),
        }
    }
}

struct App {
    config: ServerConfig,
    state: Mutex<ScanState>,
    events: Mutex<Vec<mpsc::UnboundedSender<String>>>,
    /// Latest scan id. Writers send after they change `ScanState.scan_id`.
    cancel: watch::Sender<u64>,
}

pub async fn serve(listener: TcpListener, config: ServerConfig) -> std::io::Result<()> {
    let (cancel, _) = watch::channel(0u64);
    let app = Arc::new(App {
        config,
        state: Mutex::new(ScanState::idle()),
        events: Mutex::new(Vec::new()),
        cancel,
    });
    loop {
        let (socket, _) = listener.accept().await?;
        let app = Arc::clone(&app);
        tokio::spawn(async move {
            if let Err(err) = handle(socket, app).await {
                let _ = err;
            }
        });
    }
}

async fn handle(mut socket: TcpStream, app: Arc<App>) -> std::io::Result<()> {
    let request = match read_request(&mut socket).await {
        Ok(request) => request,
        Err(_) => return Ok(()),
    };
    if request.method == "OPTIONS" {
        let body = b"";
        return write_response(&mut socket, 204, "No Content", "text/plain", body, "Access-Control-Allow-Methods: GET,POST,OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\n").await;
    }
    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/api/catalog") => {
            let body = match load_catalog_dir(&app.config.root) {
                Ok(loaded) => catalog_json(&loaded),
                Err(err) => json!({"error": err.to_string()}).to_string(),
            };
            write_json(&mut socket, 200, &body).await
        }
        ("GET", "/api/state") => {
            let body = snapshot(&app).to_string();
            write_json(&mut socket, 200, &body).await
        }
        ("GET", "/api/events") => sse(socket, app).await,
        ("POST", "/api/scan") => post_scan(&mut socket, app, &request.body).await,
        ("POST", "/api/stop") => {
            stop(&app);
            write_json(&mut socket, 200, r#"{"ok":true}"#).await
        }
        ("GET", "/api/blast") => write_json(&mut socket, 200, &blast_json(&request.query)).await,
        ("GET", "/healthz") => {
            write_json(
                &mut socket,
                200,
                r#"{"ok":true,"runtime":"rust","threads":"tokio-multi-thread"}"#,
            )
            .await
        }
        ("GET", "/favicon.ico") => {
            write_response(&mut socket, 204, "No Content", "image/x-icon", b"", "").await
        }
        ("GET", path) => serve_static(&mut socket, &app.config.static_dir, path).await,
        _ => write_json(&mut socket, 404, r#"{"error":"Not found"}"#).await,
    }
}

async fn post_scan(socket: &mut TcpStream, app: Arc<App>, body: &[u8]) -> std::io::Result<()> {
    let parsed: Value = serde_json::from_slice(body).unwrap_or_else(|_| json!({}));
    let id = parsed
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    let country = parsed
        .get("country")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if id.is_empty() {
        return write_json(socket, 400, r#"{"error":"Missing search id."}"#).await;
    }
    let loaded = match load_catalog_dir(&app.config.root) {
        Ok(loaded) => loaded,
        Err(err) => {
            let body = json!({"error": err.to_string()}).to_string();
            return write_json(socket, 500, &body).await;
        }
    };
    let country_filter = if country.is_empty() {
        None
    } else {
        Some(country.as_str())
    };
    let places = places_for(&loaded, &id, country_filter);
    if places.is_empty() {
        return write_json(socket, 400, r#"{"error":"No places in that search."}"#).await;
    }
    let heading = if id == "country" {
        if country.is_empty() {
            "Country".to_string()
        } else {
            country.clone()
        }
    } else {
        loaded
            .searches
            .iter()
            .find(|search| search.id == id)
            .map(|search| search.label.to_string())
            .unwrap_or_else(|| id.clone())
    };
    let scan_id = {
        let mut state = app.state.lock().expect("scan state");
        if state.running {
            None
        } else {
            state.scan_id += 1;
            state.running = true;
            state.heading = heading.clone();
            state.search_id = id.clone();
            state.total = places.len();
            state.done = 0;
            state.up = 0;
            state.down = 0;
            state.started_at_ms = now_ms();
            state.finished_at_ms = 0;
            state.results = places
                .iter()
                .enumerate()
                .map(|(index, place)| pending_json(place, index))
                .collect();
            Some(state.scan_id)
        }
    };
    let Some(scan_id) = scan_id else {
        return write_json(socket, 409, r#"{"error":"A scan is already running."}"#).await;
    };
    let _ = app.cancel.send(scan_id);
    emit(
        &app,
        json!({
            "type": "scan-start",
            "scanId": scan_id,
            "heading": heading,
            "searchId": id,
            "country": country,
            "total": places.len(),
        }),
    );
    let workers = app.config.workers;
    let lookup = app.config.lookup;
    let root = app.config.root.clone();
    tokio::spawn(async move {
        if let Err(err) = run_scan(app.clone(), scan_id, places, workers, lookup, root).await {
            let mut state = app.state.lock().expect("scan state");
            if state.scan_id == scan_id {
                state.running = false;
                drop(state);
                emit(&app, json!({"type": "error", "message": err}));
            }
        }
    });
    write_json(socket, 202, r#"{"ok":true}"#).await
}

async fn run_scan(
    app: Arc<App>,
    scan_id: u64,
    places: Vec<Place>,
    workers: usize,
    lookup: bool,
    root: PathBuf,
) -> Result<(), String> {
    let hosts: Vec<String> = places.iter().map(|place| place.address.clone()).collect();
    let mut incoming = check_all(hosts, workers);
    let mut finished = vec![None; places.len()];
    let mut received = 0usize;
    let cache = read_cache(&root);
    let mut cancel = app.cancel.subscribe();
    if *cancel.borrow() != scan_id {
        return Ok(());
    }
    while received < places.len() {
        tokio::select! {
            biased;
            changed = cancel.changed() => {
                if changed.is_err() || *cancel.borrow() != scan_id {
                    drop(incoming);
                    return Ok(());
                }
            }
            message = incoming.recv() => {
                let Some((index, checked)) = message else {
                    break;
                };
                received += 1;
                finished[index] = Some(checked.clone());
                let mut report = report_from(&places[index], &checked);
                apply_globe_location(&mut report, &cache);
                let event = {
                    let mut state = app.state.lock().expect("scan state");
                    if state.scan_id != scan_id {
                        drop(state);
                        drop(incoming);
                        return Ok(());
                    }
                    state.results[index] = result_json(&report, index);
                    state.done += 1;
                    if report.status == Status::Up {
                        state.up += 1;
                    } else {
                        state.down += 1;
                    }
                    json!({
                        "type": "result",
                        "scanId": scan_id,
                        "done": state.done,
                        "total": state.total,
                        "up": state.up,
                        "down": state.down,
                        "result": state.results[index].clone(),
                    })
                };
                emit(&app, event);
            }
        }
    }
    if lookup {
        enrich(&app, scan_id, &places, &finished, &root).await;
    }
    let event = {
        let mut state = app.state.lock().expect("scan state");
        if state.scan_id != scan_id {
            return Ok(());
        }
        state.running = false;
        state.finished_at_ms = now_ms();
        let elapsed = state.finished_at_ms.saturating_sub(state.started_at_ms);
        let mut countries = Vec::new();
        for result in &state.results {
            if let Some(country) = result.get("country").and_then(Value::as_str) {
                if !country.is_empty()
                    && !countries
                        .iter()
                        .any(|existing: &String| existing == country)
                {
                    countries.push(country.to_string());
                }
            }
        }
        countries.sort_by_key(|name| name.to_lowercase());
        json!({
            "type": "scan-done",
            "scanId": scan_id,
            "up": state.up,
            "down": state.down,
            "total": state.total,
            "ms": elapsed,
            "countries": countries,
        })
    };
    emit(&app, event);
    Ok(())
}

async fn enrich(
    app: &App,
    scan_id: u64,
    places: &[Place],
    finished: &[Option<HostCheck>],
    root: &Path,
) {
    let mut cache = read_cache(root);
    let mut pending = Vec::new();
    for (index, place) in places.iter().enumerate() {
        let Some(checked) = finished[index].as_ref() else {
            continue;
        };
        let mut report = report_from(place, checked);
        apply_globe_location(&mut report, &cache);
        if (report.place.location.is_empty() || report.approx) && is_public_ipv4(&report.ip) {
            pending.push((index, report.ip.clone()));
        }
    }
    if pending.is_empty() || !still_current(app, scan_id) {
        return;
    }
    emit(
        app,
        json!({"type": "locating", "scanId": scan_id, "count": pending.len()}),
    );
    let pending_len = pending.len();
    let (tx, mut rx) = mpsc::unbounded_channel();
    let producer = tokio::spawn(async move {
        let semaphore = Arc::new(Semaphore::new(LOOKUP_WORKERS));
        for (index, ip) in pending {
            if tx.is_closed() {
                break;
            }
            let permit = tokio::select! {
                biased;
                _ = tx.closed() => break,
                permit = semaphore.clone().acquire_owned() => {
                    match permit {
                        Ok(permit) => permit,
                        Err(_) => break,
                    }
                }
            };
            if tx.is_closed() {
                break;
            }
            let tx = tx.clone();
            tokio::spawn(async move {
                let found = lookup_ipwho(&ip).await;
                let _ = tx.send((index, ip, found));
                drop(permit);
            });
        }
        drop(tx);
    });
    let mut dirty = false;
    let mut seen = 0usize;
    let mut stop = false;
    while seen < pending_len && !stop {
        let Some((index, ip, found)) = rx.recv().await else {
            break;
        };
        seen += 1;
        let Some(found) = found else {
            continue;
        };
        let event = {
            let mut state = app.state.lock().expect("scan state");
            if state.scan_id != scan_id {
                stop = true;
                None
            } else if let Some(result) = state.results.get_mut(index) {
                cache.insert(ip.clone(), record_value(&found));
                dirty = true;
                result["location"] = json!(found.location);
                result["city"] = json!(found.city);
                result["region"] = json!(found.region);
                if !found.country.is_empty() {
                    result["country"] = json!(found.country);
                }
                let key = result
                    .get("address")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let (lat, lon) = downtime_core::jitter(found.lat, found.lon, &key);
                result["lat"] = json!(lat);
                result["lon"] = json!(lon);
                result["ip"] = json!(ip);
                result["approx"] = json!(false);
                Some(json!({"type": "location", "scanId": scan_id, "result": result.clone()}))
            } else {
                None
            }
        };
        if let Some(event) = event {
            emit(app, event);
        }
    }
    drop(rx);
    let _ = producer.await;
    if dirty && app.state.lock().expect("scan state").scan_id == scan_id {
        let _ = write_cache(root, &cache);
    }
}

fn stop(app: &App) {
    let mut state = app.state.lock().expect("scan state");
    state.scan_id += 1;
    state.running = false;
    state.finished_at_ms = now_ms();
    let scan_id = state.scan_id;
    drop(state);
    let _ = app.cancel.send(scan_id);
    emit(app, json!({"type": "scan-stop", "scanId": scan_id}));
}

fn still_current(app: &App, scan_id: u64) -> bool {
    app.state.lock().expect("scan state").scan_id == scan_id
}

fn report_from(place: &Place, checked: &HostCheck) -> Report {
    Report {
        place: place.clone(),
        status: checked.status,
        method: checked.method,
        elapsed_ms: checked.elapsed_ms,
        ips: checked.ips.clone(),
        ip: first_public_ipv4(&checked.ips).unwrap_or("").to_string(),
        approx: false,
    }
}

fn apply_globe_location(report: &mut Report, cache: &Map<String, Value>) {
    let cached = first_public_ipv4(&report.ips)
        .and_then(|ip| cache.get(ip))
        .and_then(cache_record);
    let located = locate(
        &report.place,
        &report.ips,
        cached.as_ref(),
        LocateMode::Globe,
    );
    if !located.ip.is_empty() {
        report.ip = located.ip;
    }
    report.place.location = located.location;
    if !located.city.is_empty() {
        report.place.city = located.city;
    }
    if !located.region.is_empty() {
        report.place.region = located.region;
    }
    if !located.country.is_empty() {
        report.place.country = located.country;
    }
    report.place.lat = located.lat;
    report.place.lon = located.lon;
    report.approx = located.approx;
}

fn pending_json(place: &Place, index: usize) -> Value {
    json!({
        "name": place.name,
        "address": place.address,
        "country": place.country,
        "city": place.city,
        "region": place.region,
        "location": place.location,
        "kinds": place.kinds,
        "source": place.source,
        "lat": place.lat,
        "lon": place.lon,
        "status": "pending",
        "method": "",
        "ms": 0,
        "ip": "",
        "ips": [],
        "approx": false,
        "index": index,
    })
}

fn result_json(report: &Report, index: usize) -> Value {
    json!({
        "name": report.place.name,
        "address": report.place.address,
        "country": report.place.country,
        "city": report.place.city,
        "region": report.place.region,
        "location": report.place.location,
        "kinds": report.place.kinds,
        "source": report.place.source,
        "lat": report.place.lat,
        "lon": report.place.lon,
        "status": report.status.as_str(),
        "method": report.method.as_str(),
        "ms": report.elapsed_ms,
        "ip": report.ip,
        "ips": report.ips,
        "approx": report.approx,
        "index": index,
    })
}

fn catalog_json(loaded: &Loaded) -> String {
    json!({
        "countries": loaded.countries,
        "searches": loaded.searches.iter().map(|search| json!({
            "id": search.id,
            "label": search.label,
            "group": search.group,
            "count": search.count,
        })).collect::<Vec<_>>(),
    })
    .to_string()
}

fn snapshot(app: &App) -> Value {
    let state = app.state.lock().expect("scan state");
    let clients = app.events.lock().expect("clients").len();
    snapshot_value(&state, clients)
}

fn snapshot_value(state: &ScanState, clients: usize) -> Value {
    json!({
        "running": state.running,
        "scanId": state.scan_id,
        "heading": state.heading,
        "searchId": state.search_id,
        "total": state.total,
        "done": state.done,
        "up": state.up,
        "down": state.down,
        "startedAt": state.started_at_ms,
        "finishedAt": state.finished_at_ms,
        "results": state.results,
        "clients": clients,
    })
}

fn emit(app: &App, event: Value) {
    let payload = format!("data: {event}\n\n");
    // State lock first, then the client list, so a subscriber can snapshot and
    // register without an event landing in neither place.
    let _state = app.state.lock().expect("scan state");
    let mut clients = app.events.lock().expect("clients");
    clients.retain(|sender| sender.send(payload.clone()).is_ok());
}

fn reap_clients(app: &App) {
    let _state = app.state.lock().expect("scan state");
    let mut clients = app.events.lock().expect("clients");
    clients.retain(|sender| !sender.is_closed());
}

async fn sse(mut socket: TcpStream, app: Arc<App>) -> std::io::Result<()> {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let hello = {
        let state = app.state.lock().expect("scan state");
        let mut clients = app.events.lock().expect("clients");
        let body = format!(
            "data: {}\n\n",
            json!({"type": "hello", "state": snapshot_value(&state, clients.len() + 1)})
        );
        clients.push(tx);
        body
    };
    let header = "\
HTTP/1.1 200 OK\r\n\
Content-Type: text/event-stream\r\n\
Cache-Control: no-cache\r\n\
Connection: keep-alive\r\n\
Access-Control-Allow-Origin: *\r\n\
\r\n";
    if socket.write_all(header.as_bytes()).await.is_err()
        || socket.write_all(hello.as_bytes()).await.is_err()
    {
        drop(rx);
        reap_clients(&app);
        return Ok(());
    }
    let mut buf = [0u8; 32];
    loop {
        tokio::select! {
            message = rx.recv() => {
                match message {
                    Some(message) => {
                        if socket.write_all(message.as_bytes()).await.is_err() {
                            break;
                        }
                    }
                    None => break,
                }
            }
            read = socket.read(&mut buf) => {
                match read {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {}
                }
            }
            _ = tokio::time::sleep(Duration::from_secs(15)) => {
                if socket.write_all(b": ping\n\n").await.is_err() {
                    break;
                }
            }
        }
    }
    drop(rx);
    reap_clients(&app);
    Ok(())
}

async fn serve_static(socket: &mut TcpStream, root: &Path, url_path: &str) -> std::io::Result<()> {
    let mut url_path = decode_path(url_path);
    if url_path == "/" {
        url_path = "/index.html".into();
    }
    let relative = url_path.trim_start_matches('/');
    let candidate = root.join(relative);
    let Ok(root_canon) = root.canonicalize() else {
        return write_text(socket, 404, "Not found").await;
    };
    let Ok(file_canon) = candidate.canonicalize() else {
        return write_text(socket, 404, "Not found").await;
    };
    if !file_canon.starts_with(&root_canon) {
        return write_text(socket, 403, "Forbidden").await;
    }
    match tokio::fs::read(&file_canon).await {
        Ok(bytes) => {
            let mime = mime_of(&file_canon);
            write_response(socket, 200, "OK", mime, &bytes, "").await
        }
        Err(_) => write_text(socket, 404, "Not found").await,
    }
}

fn mime_of(path: &Path) -> &'static str {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("png") => "image/png",
        Some("svg") => "image/svg+xml",
        Some("ico") => "image/x-icon",
        _ => "application/octet-stream",
    }
}

fn decode_path(path: &str) -> String {
    let mut out = String::new();
    let bytes = path.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(value) = u8::from_str_radix(
                std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or(""),
                16,
            ) {
                out.push(value as char);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index] as char);
        index += 1;
    }
    out
}

struct Request {
    method: String,
    path: String,
    query: String,
    body: Vec<u8>,
}

async fn read_request(socket: &mut TcpStream) -> std::io::Result<Request> {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    let header_end = loop {
        let read = socket.read(&mut tmp).await?;
        if read == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "closed",
            ));
        }
        buf.extend_from_slice(&tmp[..read]);
        if let Some(position) = buf.windows(4).position(|window| window == b"\r\n\r\n") {
            break position;
        }
        if buf.len() > 65_536 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "headers too large",
            ));
        }
    };
    let head = String::from_utf8_lossy(&buf[..header_end]).into_owned();
    let mut body = buf[header_end + 4..].to_vec();
    let mut lines = head.split("\r\n");
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let raw_path = parts.next().unwrap_or("/");
    let mut split = raw_path.splitn(2, '?');
    let path = split.next().unwrap_or("/").to_string();
    let query = split.next().unwrap_or("").to_string();
    let mut content_length = 0usize;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                content_length = value.trim().parse().unwrap_or(0);
            }
        }
    }
    if content_length > 1_000_000 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "body too large",
        ));
    }
    while body.len() < content_length {
        let read = socket.read(&mut tmp).await?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&tmp[..read]);
    }
    body.truncate(content_length);
    Ok(Request {
        method,
        path,
        query,
        body,
    })
}

fn query_param<'a>(query: &'a str, key: &str) -> Option<&'a str> {
    query.split('&').find_map(|pair| {
        let (name, value) = pair.split_once('=')?;
        (name == key).then_some(value)
    })
}

fn blast_json(query: &str) -> String {
    let kt: f64 = query_param(query, "kt")
        .and_then(|v| v.parse().ok())
        .unwrap_or(15.0);
    let air = query_param(query, "air").map(|v| v != "0").unwrap_or(true);
    let lat: f64 = query_param(query, "lat")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0.0);
    let lon: f64 = query_param(query, "lon")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0.0);
    let r = blast_rings(kt, air);
    json!({
        "runtime": "rust",
        "yieldKt": r.yield_kt,
        "airburst": r.airburst,
        "fireballM": r.fireball_m,
        "heavyM": r.heavy_m,
        "mediumM": r.medium_m,
        "lightM": r.light_m,
        "thermalM": r.thermal_m,
        "falloutM": r.fallout_m,
        "presets": KT_PRESETS,
        "card": blast_card(BlastShot { lat, lon, yield_kt: kt, airburst: air }),
    })
    .to_string()
}

async fn write_json(socket: &mut TcpStream, status: u16, body: &str) -> std::io::Result<()> {
    write_response(
        socket,
        status,
        reason(status),
        "application/json; charset=utf-8",
        body.as_bytes(),
        "",
    )
    .await
}

async fn write_text(socket: &mut TcpStream, status: u16, body: &str) -> std::io::Result<()> {
    write_response(
        socket,
        status,
        reason(status),
        "text/plain; charset=utf-8",
        body.as_bytes(),
        "",
    )
    .await
}

async fn write_response(
    socket: &mut TcpStream,
    status: u16,
    reason: &str,
    content_type: &str,
    body: &[u8],
    extra: &str,
) -> std::io::Result<()> {
    let extra = if extra.is_empty() {
        String::new()
    } else {
        format!("{extra}\r\n")
    };
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n{extra}\r\n",
        body.len()
    );
    socket.write_all(header.as_bytes()).await?;
    socket.write_all(body).await?;
    Ok(())
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        202 => "Accepted",
        204 => "No Content",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        409 => "Conflict",
        500 => "Internal Server Error",
        _ => "OK",
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::SocketAddr;
    use std::time::Duration;

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
    }

    async fn http(addr: SocketAddr, request: &str) -> String {
        let mut socket = TcpStream::connect(addr).await.unwrap();
        socket.write_all(request.as_bytes()).await.unwrap();
        let mut buf = Vec::new();
        let _ = tokio::time::timeout(Duration::from_secs(3), socket.read_to_end(&mut buf)).await;
        String::from_utf8_lossy(&buf).into_owned()
    }

    #[tokio::test]
    async fn catalog_and_globe_index_are_served() {
        let root = repo_root();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let config = ServerConfig {
            root: root.clone(),
            static_dir: root.join("visualizer/public"),
            workers: 4,
            lookup: false,
        };
        tokio::spawn(async move {
            let _ = serve(listener, config).await;
        });
        let catalog = http(
            addr,
            "GET /api/catalog HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
        )
        .await;
        assert!(catalog.contains("200"), "{catalog}");
        assert!(catalog.contains("\"id\":\"weather\""));
        assert!(catalog.contains("\"count\":4"));
        let index = http(
            addr,
            "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
        )
        .await;
        assert!(index.contains("DOWNTIME // LIVE GRID"), "{index}");
        let events = http(
            addr,
            "GET /api/events HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
        )
        .await;
        assert!(events.contains("text/event-stream"), "{events}");
        assert!(events.contains("\"type\":\"hello\""));
        let blast = http(
            addr,
            "GET /api/blast?kt=15&air=1 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
        )
        .await;
        assert!(blast.contains("\"runtime\":\"rust\""), "{blast}");
        assert!(blast.contains("lightM"), "{blast}");
        let health = http(
            addr,
            "GET /healthz HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
        )
        .await;
        assert!(health.contains("tokio-multi-thread"), "{health}");
    }
}
