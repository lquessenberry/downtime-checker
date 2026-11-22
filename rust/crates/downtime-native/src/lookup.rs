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
    let body = https_get_bytes(
        host,
        path,
        "application/json",
        "downtime-checker",
        1_000_000,
        budget,
    )?;
    String::from_utf8(body).map_err(|_| LookupError {
        message: "location response was not utf-8".into(),
    })
}

/// HTTPS GET that returns the raw body. Used by ipwho and the globe tile proxy.
pub fn https_get_bytes(
    host: &str,
    path: &str,
    accept: &str,
    user_agent: &str,
    max_bytes: usize,
    budget: Duration,
) -> Result<Vec<u8>, LookupError> {
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
        "GET {path} HTTP/1.1\r\nHost: {host}\r\nUser-Agent: {user_agent}\r\nAccept: {accept}\r\nConnection: close\r\n\r\n"
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
    if raw.len() > max_bytes.saturating_add(32_768) {
        raw.truncate(max_bytes.saturating_add(32_768));
    }
    let split_at = raw
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| LookupError {
            message: "http response had no header break".into(),
        })?;
    let head = String::from_utf8_lossy(&raw[..split_at]);
    let body_bytes = &raw[split_at + 4..];
    let status = head.lines().next().unwrap_or("");
    if !status.contains(" 200 ") {
        return Err(LookupError {
            message: format!("{host} status {status}"),
        });
    }
    let mut body = if head
        .to_ascii_lowercase()
        .contains("transfer-encoding: chunked")
    {
        decode_chunked_bytes(body_bytes)
    } else {
        body_bytes.to_vec()
    };
    if body.len() > max_bytes {
        body.truncate(max_bytes);
    }
    Ok(body)
}

/// Reassemble chunked transfer encoding before any UTF-8 conversion. A chunk
/// boundary is allowed to split a multibyte character.
fn decode_chunked_bytes(body: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut rest = body;
    while let Some(split) = rest.windows(2).position(|window| window == b"\r\n") {
        let size_line = &rest[..split];
        let next = &rest[split + 2..];
        let size_text = String::from_utf8_lossy(size_line);
        let size_token = size_text.trim().split(';').next().unwrap_or("");
        let Ok(size) = usize::from_str_radix(size_token, 16) else {
            break;
        };
        if size == 0 || next.len() < size {
            break;
        }
        out.extend_from_slice(&next[..size]);
        rest = &next[size..];
        if rest.starts_with(b"\r\n") {
            rest = &rest[2..];
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_boundary_can_split_a_utf8_character() {
        let raw = b"1\r\n\xc3\r\n1\r\n\xa9\r\n0\r\n\r\n";
        let body = decode_chunked_bytes(raw);
        assert_eq!(body, "é".as_bytes());
        assert_eq!(String::from_utf8(body).unwrap(), "é");
    }
}
