//! HTTPS GET against ipwho.is. Failure leaves the cache and capital fallback in place.

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use downtime_core::{format_location, GeoRecord};
use rustls::pki_types::ServerName;
use rustls::{ClientConfig, ClientConnection, RootCertStore, StreamOwned};
use serde_json::Value;

#[derive(Debug)]
pub struct LookupError {
    pub message: String,
}

pub async fn lookup_ipwho(ip: &str) -> Option<GeoRecord> {
    let ip = ip.to_string();
    tokio::task::spawn_blocking(move || lookup_ipwho_blocking(&ip))
        .await
        .ok()
        .flatten()
}

fn lookup_ipwho_blocking(ip: &str) -> Option<GeoRecord> {
    let path = format!("/{ip}");
    let body = https_get("ipwho.is", &path, Duration::from_secs(8)).ok()?;
    let data: Value = serde_json::from_str(&body).ok()?;
    if data.get("success").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    let lat = data.get("latitude").and_then(Value::as_f64)?;
    let lon = data.get("longitude").and_then(Value::as_f64)?;
    if !lat.is_finite() || !lon.is_finite() {
        return None;
    }
    let city = json_str(&data, "city");
    let region = json_str(&data, "region");
    let postal = json_str(&data, "postal");
    let country = json_str(&data, "country");
    let location = format_location(&city, &region, &postal, &country);
    if location.is_empty() {
        return None;
    }
    Some(GeoRecord {
        location,
        city,
        region,
        country,
        lat,
        lon,
    })
}

fn json_str(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string()
}

fn tls_config() -> Arc<ClientConfig> {
    static CONFIG: OnceLock<Arc<ClientConfig>> = OnceLock::new();
    CONFIG
        .get_or_init(|| {
            let mut roots = RootCertStore::empty();
            roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
            let provider = Arc::new(rustls::crypto::ring::default_provider());
            let config = ClientConfig::builder_with_provider(provider)
                .with_safe_default_protocol_versions()
                .expect("rustls default protocol versions")
                .with_root_certificates(roots)
                .with_no_client_auth();
            Arc::new(config)
        })
        .clone()
}

fn https_get(host: &str, path: &str, budget: Duration) -> Result<String, LookupError> {
    let address = (host, 443u16)
        .to_socket_addrs()
        .map_err(|err| LookupError {
            message: err.to_string(),
        })?
        .next()
        .ok_or_else(|| LookupError {
            message: format!("no address for {host}"),
        })?;
    let socket = TcpStream::connect_timeout(&address, budget).map_err(|err| LookupError {
        message: err.to_string(),
    })?;
    socket.set_read_timeout(Some(budget)).ok();
    socket.set_write_timeout(Some(budget)).ok();
    let server_name = ServerName::try_from(host.to_string()).map_err(|err| LookupError {
        message: err.to_string(),
    })?;
    let connection =
        ClientConnection::new(tls_config(), server_name).map_err(|err| LookupError {
            message: err.to_string(),
        })?;
    let mut tls = StreamOwned::new(connection, socket);
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {host}\r\nUser-Agent: downtime-checker\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    );
    tls.write_all(request.as_bytes())
        .map_err(|err| LookupError {
            message: err.to_string(),
        })?;
    let mut raw = Vec::new();
    match tls.read_to_end(&mut raw) {
        Ok(_) => {}
        Err(err) if err.kind() == std::io::ErrorKind::UnexpectedEof && !raw.is_empty() => {}
        Err(err) => {
            return Err(LookupError {
                message: err.to_string(),
            })
        }
    }
    if raw.len() > 1_000_000 {
        raw.truncate(1_000_000);
    }
    let text = String::from_utf8_lossy(&raw);
    let (head, body) = text.split_once("\r\n\r\n").ok_or_else(|| LookupError {
        message: "http response had no header break".into(),
    })?;
    let status = head.lines().next().unwrap_or("");
    if !status.contains(" 200 ") {
        return Err(LookupError {
            message: format!("ipwho.is status {status}"),
        });
    }
    let body = if head
        .to_ascii_lowercase()
        .contains("transfer-encoding: chunked")
    {
        decode_chunked(body)
    } else {
        body.to_string()
    };
    Ok(body)
}

fn decode_chunked(body: &str) -> String {
    let mut out = String::new();
    let mut rest = body;
    while let Some((size_line, next)) = rest.split_once("\r\n") {
        let size_token = size_line.trim().split(';').next().unwrap_or("");
        let Ok(size) = usize::from_str_radix(size_token, 16) else {
            break;
        };
        if size == 0 || next.len() < size {
            break;
        }
        out.push_str(&next[..size]);
        rest = &next[size..];
        if let Some(stripped) = rest.strip_prefix("\r\n") {
            rest = stripped;
        }
    }
    out
}
