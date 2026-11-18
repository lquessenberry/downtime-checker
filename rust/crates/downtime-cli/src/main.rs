//! Native downtime checker.
//!
//! Probe order matches the Python CLI and the Node visualizer: ping the website
//! name, and if that stays silent try TCP 443, then TCP 80. The sample IP in a
//! catalog row is not contacted.

#![deny(unsafe_code)]

use std::env;
use std::io::{self, IsTerminal, Write};
use std::path::PathBuf;
use std::process::Command;
use std::time::Instant;

use downtime_core::{
    builtin_layers, checked_address, first_public_ipv4, is_public_ipv4, locate, normalize_address,
    parse_ipv4, places_for, summarize, LayerKind, Loaded, LocateMode, Place, Report, Status,
    DEFAULT_WORKERS, LOOKUP_WORKERS,
};
use downtime_native::{
    cache_record, check_all, find_root, icmp_mode, load_catalog_dir, load_saved_places,
    lookup_ipwho, read_cache, record_value, resolve_v4, write_cache, write_saved, IcmpMode,
};
use serde_json::{json, Map, Value};
use tokio::sync::Semaphore;

struct Opts {
    root: Option<PathBuf>,
    workers: usize,
    color: bool,
    json: bool,
    lookup: bool,
    fail_on_down: bool,
    command: CommandKind,
}

enum CommandKind {
    Help,
    List,
    Layers,
    Menu,
    Check { id: String, country: String },
    Add { name: String, address: String },
}

#[tokio::main]
async fn main() {
    let opts = match parse_args() {
        Ok(opts) => opts,
        Err(message) => {
            eprintln!("{message}");
            eprintln!("Try `downtime help`.");
            std::process::exit(1);
        }
    };
    let code = match run(opts).await {
        Ok(code) => code,
        Err(message) => {
            eprintln!("{message}");
            1
        }
    };
    std::process::exit(code);
}

async fn run(opts: Opts) -> Result<i32, String> {
    match opts.command {
        CommandKind::Help => {
            print_help();
            Ok(0)
        }
        CommandKind::List => {
            let (root, loaded) = open_catalog(&opts)?;
            let _ = root;
            print_searches(&loaded);
            Ok(0)
        }
        CommandKind::Layers => {
            for layer in builtin_layers() {
                let kind = match layer.kind {
                    LayerKind::Active => "active",
                    LayerKind::Stub => "stub",
                };
                println!("{:<16} {:<8} {}", layer.id, kind, layer.title);
                println!("  {}", layer.summary);
            }
            Ok(0)
        }
        CommandKind::Menu => menu(opts).await,
        CommandKind::Check {
            ref id,
            ref country,
        } => {
            let id = resolve_search(id)?;
            run_check(&opts, &id, country).await
        }
        CommandKind::Add {
            ref name,
            ref address,
        } => add_place(&opts, name, address).await,
    }
}

async fn menu(opts: Opts) -> Result<i32, String> {
    loop {
        let (_root, loaded) = open_catalog(&opts)?;
        print_banner(&loaded);
        let choices = main_choices();
        for (index, choice) in choices.iter().enumerate() {
            println!("{:2}  {}", index + 1, choice.0);
        }
        println!(" 0  Quit");
        println!();
        match choose(choices.len()) {
            Choice::Quit => return Ok(0),
            Choice::Pick(index) => match choices[index].1 {
                MenuAction::Check(id) => {
                    let _ = run_check(&opts, id, "").await?;
                }
                MenuAction::UnitedStates => united_states_menu(&opts).await?,
                MenuAction::Country => country_menu(&opts, &loaded).await?,
                MenuAction::Add => add_from_prompt(&opts).await?,
            },
        }
    }
}

async fn united_states_menu(opts: &Opts) -> Result<(), String> {
    let choices = [
        ("Everything in the United States", "us-everything"),
        ("Banks and stock exchanges", "us-banks"),
        ("Tech only", "us-tech"),
        ("Utilities only", "us-utilities"),
        ("Government only", "us-government"),
        ("Education", "us-education"),
        ("Medical", "us-medical"),
        ("Stock exchanges", "us-exchanges"),
        ("Transportation", "us-transport"),
        ("Stores", "us-stores"),
        ("Communications", "us-communications"),
        ("Military", "us-military"),
        ("Shipping", "us-shipping"),
        ("Food", "us-food"),
        ("Weather", "us-weather"),
    ];
    loop {
        println!();
        println!("United States");
        println!();
        for (index, (label, _)) in choices.iter().enumerate() {
            println!("{:2}  {label}", index + 1);
        }
        println!(" 0  Back");
        println!();
        match choose(choices.len()) {
            Choice::Quit => return Ok(()),
            Choice::Pick(index) => {
                let _ = run_check(opts, choices[index].1, "").await?;
            }
        }
    }
}

async fn country_menu(opts: &Opts, loaded: &Loaded) -> Result<(), String> {
    if loaded.countries.is_empty() {
        println!("No countries found in the world government list.");
        return Ok(());
    }
    println!();
    println!("Choose a country");
    println!("The United States opens another menu.");
    println!();
    for (index, name) in loaded.countries.iter().enumerate() {
        println!("{:3}  {name}", index + 1);
    }
    println!("  0  Back");
    println!();
    match choose(loaded.countries.len()) {
        Choice::Quit => Ok(()),
        Choice::Pick(index) => {
            let country = loaded.countries[index].clone();
            if country == "United States" {
                united_states_menu(opts).await
            } else {
                let _ = run_check(opts, "country", &country).await?;
                Ok(())
            }
        }
    }
}

async fn add_from_prompt(opts: &Opts) -> Result<(), String> {
    println!();
    println!("Add a place");
    let Some(name) = ask("Name: ") else {
        return Ok(());
    };
    let name = collapse_ws(&name);
    if name.is_empty() {
        println!("A name is required.");
        return Ok(());
    }
    if name.contains('|') {
        println!("Leave the | character out of the name.");
        return Ok(());
    }
    let Some(raw) = ask("IP or web address: ") else {
        return Ok(());
    };
    add_place(opts, &name, raw.trim()).await.map(|_| ())
}

async fn add_place(opts: &Opts, name: &str, raw_address: &str) -> Result<i32, String> {
    let address = normalize_address(raw_address).ok_or_else(|| {
        "Enter an IP address or a web address, such as 192.168.1.1 or example.com.".to_string()
    })?;
    let (root, loaded) = open_catalog(opts)?;
    let existing = places_for(&loaded, "everything", None);
    if let Some(found) = existing.iter().find(|place| place.address == address) {
        println!("Already on the list as {} ({}).", found.name, found.address);
        return Ok(0);
    }
    let mut place = Place::new(name, address.clone());
    place.kinds = vec!["added".into()];
    place.source = "added".into();
    if opts.lookup {
        println!("Looking up the location...");
        if let Some(ip) = resolve_public_ip(&address).await {
            if let Some(found) = lookup_ipwho(&ip).await {
                place.location = found.location.clone();
                place.city = found.city.clone();
                place.region = found.region.clone();
                place.country = found.country.clone();
                place.lat = Some(found.lat);
                place.lon = Some(found.lon);
                let mut cache = read_cache(&root);
                cache.insert(ip, record_value(&found));
                write_cache(&root, &cache).map_err(|err| err.to_string())?;
            }
        }
    }
    let mut saved = load_saved_places(&root);
    saved.push(place.clone());
    write_saved(&root, &saved).map_err(|err| err.to_string())?;
    println!("Saved. This place will be checked from now on.");
    println!("{}", place.name);
    println!("Address: {}", checked_address(&place.address, ""));
    if place.location.is_empty() {
        println!("Location: not found");
    } else {
        println!("Location: {}", place.location);
    }
    Ok(0)
}

async fn resolve_public_ip(host: &str) -> Option<String> {
    let ips = resolve_v4(host).await;
    first_public_ipv4(&ips).map(str::to_string)
}

async fn run_check(opts: &Opts, id: &str, country: &str) -> Result<i32, String> {
    let (root, loaded) = open_catalog(opts)?;
    let country = country.trim();
    let places = places_for(
        &loaded,
        id,
        if country.is_empty() {
            None
        } else {
            Some(country)
        },
    );
    if places.is_empty() {
        println!("No places to check.");
        return Ok(2);
    }
    let heading = heading_for(&loaded, id, country);
    let total = places.len();
    let added = places
        .iter()
        .filter(|place| place.source == "added")
        .count();
    if !opts.json {
        println!();
        println!("{heading}");
        println!("{total} places");
        if added > 0 {
            let noun = if added == 1 { "place is" } else { "places are" };
            println!("{added} added {noun} included.");
        }
        println!("A place is up when it answers ping. If ping is silent, HTTPS is tried next.");
        println!("Each place is listed as soon as it answers.");
        println!();
    }
    let name_width = places
        .iter()
        .map(|place| place.name.chars().count())
        .max()
        .unwrap_or(0);
    let address_width = places
        .iter()
        .map(|place| place.address.chars().count())
        .max()
        .unwrap_or(0);
    let hosts: Vec<String> = places.iter().map(|place| place.address.clone()).collect();
    let started = Instant::now();
    let mut incoming = check_all(hosts, opts.workers);
    let mut checks = vec![None; places.len()];
    let mut done = 0usize;
    let mut noted_icmp = false;
    while done < places.len() {
        let Some((index, checked)) = incoming.recv().await else {
            break;
        };
        done += 1;
        if !noted_icmp && icmp_mode() == IcmpMode::Unavailable && !opts.json {
            eprintln!("ICMP is not permitted here. Falling back to TCP 443, then TCP 80.");
            noted_icmp = true;
        }
        if !opts.json {
            let report = assemble(&places[index], &checked);
            println!(
                "{done}/{total}  {}",
                place_line(&report, name_width, address_width, opts.color)
            );
            let _ = report;
        }
        checks[index] = Some(checked);
    }
    let check_ms = started.elapsed().as_millis();
    if !opts.json {
        eprintln!("checks finished in {:.2}s", check_ms as f64 / 1000.0);
    }
    let mut reports = Vec::with_capacity(places.len());
    for (place, checked) in places.iter().zip(checks) {
        let checked = checked.ok_or_else(|| format!("missing result for {}", place.address))?;
        reports.push(assemble(place, &checked));
    }
    let mut cache = read_cache(&root);
    for report in &mut reports {
        apply_cached_location(report, &cache);
    }
    if opts.lookup {
        let dirty = lookup_missing(&mut reports, &mut cache).await;
        if dirty {
            write_cache(&root, &cache).map_err(|err| err.to_string())?;
        }
        remember_added(&root, &reports)?;
    }
    for report in &mut reports {
        fill_unknown_location(report);
    }
    let grouped = summarize(&reports);
    if opts.json {
        println!(
            "{}",
            json_summary(&heading, check_ms as u64, &grouped, &reports)
        );
    } else {
        print_summary(&reports, &grouped, name_width, opts.color);
    }
    if opts.fail_on_down && grouped.offline > 0 {
        Ok(1)
    } else {
        Ok(0)
    }
}

fn assemble(place: &Place, checked: &downtime_native::HostCheck) -> Report {
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

fn apply_cached_location(report: &mut Report, cache: &Map<String, Value>) {
    let cached = first_public_ipv4(&report.ips)
        .and_then(|ip| cache.get(ip))
        .and_then(cache_record);
    let located = locate(
        &report.place,
        &report.ips,
        cached.as_ref(),
        LocateMode::CacheOnly,
    );
    stamp_location(report, &located);
}

fn stamp_location(report: &mut Report, located: &downtime_core::Located) {
    if !located.ip.is_empty() {
        report.ip = located.ip.clone();
    }
    if !located.location.is_empty() {
        report.place.location = located.location.clone();
    }
    if !located.city.is_empty() {
        report.place.city = located.city.clone();
    }
    if !located.region.is_empty() {
        report.place.region = located.region.clone();
    }
    if !located.country.is_empty() {
        report.place.country = located.country.clone();
    }
    report.place.lat = located.lat;
    report.place.lon = located.lon;
    report.approx = located.approx;
}

async fn lookup_missing(reports: &mut [Report], cache: &mut Map<String, Value>) -> bool {
    let pending: Vec<(usize, String)> = reports
        .iter()
        .enumerate()
        .filter_map(|(index, report)| {
            if !report.place.location.is_empty() && report.place.lat.is_some() {
                return None;
            }
            let ip = report.ip.clone();
            if ip.is_empty() || !is_public_ipv4(&ip) {
                return None;
            }
            Some((index, ip))
        })
        .collect();
    if pending.is_empty() {
        return false;
    }
    println!("Finding locations for {} places...", pending.len());
    let semaphore = std::sync::Arc::new(Semaphore::new(LOOKUP_WORKERS));
    let mut joins = Vec::new();
    for (index, ip) in pending {
        let permit = semaphore
            .clone()
            .acquire_owned()
            .await
            .expect("lookup semaphore");
        joins.push(tokio::spawn(async move {
            let found = lookup_ipwho(&ip).await;
            drop(permit);
            (index, ip, found)
        }));
    }
    let mut dirty = false;
    for join in joins {
        let Ok((index, ip, found)) = join.await else {
            continue;
        };
        if let Some(found) = found {
            reports[index].place.location = found.location.clone();
            reports[index].place.city = found.city.clone();
            reports[index].place.region = found.region.clone();
            if !found.country.is_empty() {
                reports[index].place.country = found.country.clone();
            }
            reports[index].place.lat = Some(found.lat);
            reports[index].place.lon = Some(found.lon);
            reports[index].approx = false;
            cache.insert(ip, record_value(&found));
            dirty = true;
        }
    }
    dirty
}

fn fill_unknown_location(report: &mut Report) {
    if !report.place.location.is_empty() {
        return;
    }
    if parse_ipv4(&report.place.address).is_some() && !is_public_ipv4(&report.place.address) {
        report.place.location = "Local network".into();
    } else {
        report.place.location = "Location not found".into();
    }
}

fn remember_added(root: &std::path::Path, reports: &[Report]) -> Result<(), String> {
    let mut saved = load_saved_places(root);
    if saved.is_empty() {
        return Ok(());
    }
    let mut changed = false;
    for entry in &mut saved {
        let Some(current) = reports
            .iter()
            .find(|report| report.place.address == entry.address)
        else {
            continue;
        };
        let after = current.place.location.clone();
        if !after.is_empty()
            && after != "Location not found"
            && after != "Local network"
            && entry.location != after
        {
            entry.location = after;
            entry.city = current.place.city.clone();
            entry.region = current.place.region.clone();
            entry.country = current.place.country.clone();
            entry.lat = current.place.lat;
            entry.lon = current.place.lon;
            changed = true;
        }
    }
    if changed {
        write_saved(root, &saved).map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn json_summary(
    heading: &str,
    elapsed_ms: u64,
    grouped: &downtime_core::Grouped,
    reports: &[Report],
) -> String {
    let results: Vec<Value> = reports
        .iter()
        .map(|report| {
            json!({
                "name": report.place.name,
                "address": report.place.address,
                "status": report.status.as_str(),
                "method": report.method.as_str(),
                "ms": report.elapsed_ms,
                "ip": report.ip,
                "ips": report.ips,
                "country": report.place.country,
                "region": report.place.region,
                "city": report.place.city,
                "location": report.place.location,
                "lat": report.place.lat,
                "lon": report.place.lon,
                "approx": report.approx,
                "kinds": report.place.kinds,
                "source": report.place.source,
            })
        })
        .collect();
    json!({
        "heading": heading,
        "checked": grouped.checked,
        "online": grouped.online,
        "offline": grouped.offline,
        "elapsedMs": elapsed_ms,
        "countries": grouped.countries,
        "results": results,
    })
    .to_string()
}

fn print_summary(
    reports: &[Report],
    grouped: &downtime_core::Grouped,
    name_width: usize,
    color: bool,
) {
    let address_width = reports
        .iter()
        .map(|report| {
            checked_address(&report.place.address, &report.ip)
                .chars()
                .count()
        })
        .max()
        .unwrap_or(0);
    let down: Vec<&Report> = reports
        .iter()
        .filter(|report| report.status == Status::Down)
        .collect();
    println!();
    println!("Places that are down");
    println!("--------------------");
    if down.is_empty() {
        println!("None. Every place answered.");
    } else {
        for report in &down {
            println!("{}", place_line(report, name_width, address_width, color));
        }
    }
    println!(
        "{} up, {} down, {} checked.",
        grouped.online, grouped.offline, grouped.checked
    );
    println!();
    println!("Results by country");
    let mut first = true;
    for country in &grouped.by_location {
        if !first {
            println!();
            println!();
        }
        first = false;
        println!();
        print_big(&country.country, color);
        println!();
        for (index, state) in country.states.iter().enumerate() {
            if index > 0 {
                println!();
            }
            if !state.state.is_empty() {
                println!("{}", paint(&state.state, "1", color));
            }
            for report in &state.reports {
                println!("{}", place_line(report, name_width, address_width, color));
            }
        }
    }
    println!();
    println!("This search");
    println!(
        "{} checked, {} online, {} offline",
        grouped.checked, grouped.online, grouped.offline
    );
    println!();
    println!("Countries");
    if grouped.countries.is_empty() {
        println!("  None");
    } else {
        for country in &grouped.countries {
            println!("  {country}");
        }
    }
    println!();
}

fn place_line(report: &Report, name_width: usize, address_width: usize, color: bool) -> String {
    let label = if report.status == Status::Up {
        paint("UP  ", "32", color)
    } else {
        paint("DOWN", "1;31", color)
    };
    let address = checked_address(&report.place.address, &report.ip);
    format!(
        "  {label}  {:<name_width$}    {:<address_width$}    {}",
        report.place.name,
        address,
        report.place.location,
        name_width = name_width,
        address_width = address_width,
    )
}

fn print_big(text: &str, color: bool) {
    let rendered = figlet(text);
    let columns = terminal_columns();
    if let Some(lines) = rendered {
        if lines.iter().all(|line| line.chars().count() <= columns) {
            for line in lines {
                println!("{}", paint(&line, "1;97", color));
            }
            return;
        }
    }
    println!("{}", paint(text, "1;97", color));
}

fn figlet(text: &str) -> Option<Vec<String>> {
    if !text.is_ascii() {
        return None;
    }
    let output = Command::new("figlet")
        .args(["-f", "small", "-w", "400", text])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    let lines: Vec<String> = text
        .lines()
        .map(|line| line.trim_end().to_string())
        .filter(|line| !line.trim().is_empty())
        .collect();
    if lines.is_empty() {
        None
    } else {
        Some(lines)
    }
}

fn terminal_columns() -> usize {
    if let Some(columns) = env::var("COLUMNS")
        .ok()
        .and_then(|value| value.parse().ok())
    {
        return columns;
    }
    120
}

fn paint(text: &str, code: &str, enabled: bool) -> String {
    if !enabled || code.is_empty() {
        text.to_string()
    } else {
        format!("\x1b[{code}m{text}\x1b[0m")
    }
}

fn print_banner(loaded: &Loaded) {
    let world = loaded
        .searches
        .iter()
        .find(|search| search.id == "world")
        .map(|search| search.count)
        .unwrap_or(0);
    let institutions = loaded
        .groups
        .institutions
        .iter()
        .map(|section| section.places.len())
        .sum::<usize>();
    let transport = loaded
        .groups
        .transport
        .iter()
        .map(|section| section.places.len())
        .sum::<usize>();
    let stores = loaded
        .groups
        .stores
        .iter()
        .map(|section| section.places.len())
        .sum::<usize>();
    let communications = loaded
        .groups
        .communications
        .iter()
        .map(|section| section.places.len())
        .sum::<usize>();
    let military = loaded
        .groups
        .military
        .iter()
        .map(|section| section.places.len())
        .sum::<usize>();
    println!();
    println!("Downtime");
    println!("{world} world government sites.");
    println!("{institutions} schools, hospitals, banks, and exchanges.");
    println!("{transport} transportation sites.");
    println!("{stores} stores.");
    println!("{communications} TV, phone, radio, and internet sites.");
    println!("{military} military sites.");
    println!();
}

fn print_searches(loaded: &Loaded) {
    for search in &loaded.searches {
        println!(
            "{:16} {:6} {:>5}  {}",
            search.group, search.id, search.count, search.label
        );
    }
    println!(
        "{} countries in the world government list",
        loaded.countries.len()
    );
}

#[derive(Clone, Copy)]
enum MenuAction {
    Check(&'static str),
    UnitedStates,
    Country,
    Add,
}

fn main_choices() -> &'static [(&'static str, MenuAction)] {
    &[
        ("Search everything", MenuAction::Check("everything")),
        ("World governments", MenuAction::Check("world")),
        ("United States", MenuAction::UnitedStates),
        ("Banks and stock exchanges", MenuAction::Check("banks")),
        ("Tech only", MenuAction::Check("tech")),
        ("Utilities only", MenuAction::Check("utilities")),
        ("Education", MenuAction::Check("education")),
        ("Medical", MenuAction::Check("medical")),
        ("Stock exchanges", MenuAction::Check("exchanges")),
        ("Transportation", MenuAction::Check("transport")),
        ("Stores", MenuAction::Check("stores")),
        ("Communications", MenuAction::Check("communications")),
        ("Military", MenuAction::Check("military")),
        ("Shipping", MenuAction::Check("shipping")),
        ("Food", MenuAction::Check("food")),
        ("Weather", MenuAction::Check("weather")),
        ("Choose a country", MenuAction::Country),
        ("Add a place", MenuAction::Add),
    ]
}

enum Choice {
    Quit,
    Pick(usize),
}

fn choose(highest: usize) -> Choice {
    loop {
        match ask("Choice: ") {
            None => return Choice::Quit,
            Some(raw) => {
                let raw = raw.trim().to_lowercase();
                if raw == "0" || raw == "b" || raw == "back" {
                    return Choice::Quit;
                }
                if let Ok(number) = raw.parse::<usize>() {
                    if (1..=highest).contains(&number) {
                        return Choice::Pick(number - 1);
                    }
                }
                println!("Enter a number from 1 to {highest}, or 0.");
            }
        }
    }
}

fn ask(prompt: &str) -> Option<String> {
    print!("{prompt}");
    let _ = io::stdout().flush();
    let mut line = String::new();
    match io::stdin().read_line(&mut line) {
        Ok(0) | Err(_) => None,
        Ok(_) => Some(line.trim_end_matches(['\n', '\r']).to_string()),
    }
}

fn open_catalog(opts: &Opts) -> Result<(PathBuf, Loaded), String> {
    let root = match &opts.root {
        Some(path) => path.clone(),
        None => find_root(&env::current_dir().unwrap_or_else(|_| PathBuf::from("."))).ok_or_else(
            || {
                "Cannot find the catalog. Pass --root pointing at the directory with places.txt."
                    .to_string()
            },
        )?,
    };
    let loaded = load_catalog_dir(&root).map_err(|err| err.to_string())?;
    Ok((root, loaded))
}

fn heading_for(loaded: &Loaded, id: &str, country: &str) -> String {
    if id == "country" {
        return if country.is_empty() {
            "Country".into()
        } else {
            country.to_string()
        };
    }
    loaded
        .searches
        .iter()
        .find(|search| search.id == id)
        .map(|search| search.label.to_string())
        .unwrap_or_else(|| id.to_string())
}

fn resolve_search(token: &str) -> Result<String, String> {
    let id = match token {
        "1" => "everything",
        "2" => "world",
        "3" => {
            return Err(
                "United States opens a submenu. Use us-everything, us-weather, or another us-* id."
                    .into(),
            )
        }
        "4" => "banks",
        "5" => "tech",
        "6" => "utilities",
        "7" => "education",
        "8" => "medical",
        "9" => "exchanges",
        "10" => "transport",
        "11" => "stores",
        "12" => "communications",
        "13" => "military",
        "14" => "shipping",
        "15" => "food",
        "16" => "weather",
        "17" => return Err("Choose a country with: downtime check country --country NAME".into()),
        "18" => return Err("Add a place with: downtime add --name NAME --address HOST".into()),
        other => other,
    };
    Ok(id.to_string())
}

fn collapse_ws(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse_args() -> Result<Opts, String> {
    let mut args = env::args().skip(1);
    let mut root = None;
    let mut workers = DEFAULT_WORKERS;
    let mut color = std::io::stdout().is_terminal() && env::var_os("NO_COLOR").is_none();
    let mut json = false;
    let mut lookup = true;
    let mut fail_on_down = false;
    let mut positional = Vec::new();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "-h" | "--help" | "help" => {
                return Ok(Opts {
                    root,
                    workers,
                    color,
                    json,
                    lookup,
                    fail_on_down,
                    command: CommandKind::Help,
                })
            }
            "--root" => {
                root = Some(PathBuf::from(
                    args.next().ok_or("--root needs a directory")?,
                ));
            }
            "--workers" => {
                let raw = args.next().ok_or("--workers needs a number")?;
                workers = raw
                    .parse()
                    .map_err(|_| format!("not a worker count: {raw}"))?;
            }
            "--no-color" => color = false,
            "--json" => {
                json = true;
                color = false;
            }
            "--no-lookup" => lookup = false,
            "--fail-on-down" => fail_on_down = true,
            "--" => {
                positional.extend(args);
                break;
            }
            other if other.starts_with('-') => return Err(format!("Unknown flag {other}")),
            other => positional.push(other.to_string()),
        }
    }
    let command = if positional.is_empty() {
        if std::io::stdin().is_terminal() {
            CommandKind::Menu
        } else {
            CommandKind::Help
        }
    } else {
        match positional[0].as_str() {
            "list" => CommandKind::List,
            "layers" => CommandKind::Layers,
            "menu" => CommandKind::Menu,
            "check" => {
                let id = positional
                    .get(1)
                    .cloned()
                    .ok_or("check needs a search id, for example weather")?;
                let mut country = String::new();
                let mut index = 2;
                while index < positional.len() {
                    if positional[index] == "--country" {
                        country = positional
                            .get(index + 1)
                            .cloned()
                            .ok_or("--country needs a name")?;
                        index += 2;
                    } else {
                        return Err(format!("Unexpected argument {}", positional[index]));
                    }
                }
                CommandKind::Check { id, country }
            }
            "add" => {
                let mut name = None;
                let mut address = None;
                let mut index = 1;
                while index < positional.len() {
                    match positional[index].as_str() {
                        "--name" => {
                            name = Some(
                                positional
                                    .get(index + 1)
                                    .cloned()
                                    .ok_or("--name needs a value")?,
                            );
                            index += 2;
                        }
                        "--address" => {
                            address = Some(
                                positional
                                    .get(index + 1)
                                    .cloned()
                                    .ok_or("--address needs a value")?,
                            );
                            index += 2;
                        }
                        other => return Err(format!("Unexpected argument {other}")),
                    }
                }
                CommandKind::Add {
                    name: name.ok_or("add needs --name")?,
                    address: address.ok_or("add needs --address")?,
                }
            }
            other => return Err(format!("Unknown command {other}")),
        }
    };
    Ok(Opts {
        root,
        workers,
        color,
        json,
        lookup,
        fail_on_down,
        command,
    })
}

fn print_help() {
    println!(
        r#"Downtime checker (Rust)

Usage:
  downtime [--root DIR] [--workers N] [--json] [--no-lookup] [--no-color] [--fail-on-down] <command>

Commands:
  menu                         Numbered menu, same searches as the Python CLI
  list                         Show search ids and how many places each one has
  layers                       Show the reachability layer and the stub layers
  check <id> [--country NAME]  Check one search. <id> may be a name or a menu number
  add --name NAME --address HOST
  help

A place is UP when ping answers. If ping is silent, TCP 443 is tried, then TCP 80.
ICMP uses the system ping command. If that is missing or not permitted, TCP still runs.
Browsers cannot do these probes; the WASM build parses catalogs and aggregates results.

Examples:
  downtime --root . check weather --no-lookup
  downtime check 16
  downtime check country --country Japan
  downtime-server --root .
"#
    );
}
