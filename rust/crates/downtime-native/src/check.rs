use std::sync::atomic::{AtomicU8, Ordering};
use std::time::{Duration, Instant};

use downtime_core::{
    CheckMachine, Decision, Method, ProbeRequest, Status, PING_WAIT_SECS, TCP_WAIT_SECS,
};
use tokio::io::AsyncReadExt;
use tokio::net::TcpStream;
use tokio::process::Command;
use tokio::sync::{mpsc, Semaphore};
use tokio::time::timeout;

static ICMP_MODE: AtomicU8 = AtomicU8::new(0);

const ICMP_ALLOWED: u8 = 1;
const ICMP_UNAVAILABLE: u8 = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IcmpMode {
    Unknown,
    Allowed,
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HostCheck {
    pub status: Status,
    pub method: Method,
    pub elapsed_ms: u64,
    pub ips: Vec<String>,
}

/// Resolve (with a timeout), ping the website name, then TCP 443 and TCP 80.
pub async fn check_host(host: &str) -> HostCheck {
    let started = Instant::now();
    let mut machine = CheckMachine::new(host);
    let decision = loop {
        match machine.request() {
            None => {
                break machine.decision().unwrap_or(Decision {
                    status: Status::Down,
                    method: Method::None,
                })
            }
            Some(ProbeRequest::ResolveV4) => {
                let ips = resolve_v4(host).await;
                machine.resolved(ips);
            }
            Some(ProbeRequest::Ping) => {
                let ok = ping_host(host).await;
                if let Some(decision) = machine.pinged(ok) {
                    break decision;
                }
            }
            Some(ProbeRequest::Tcp { ip, port }) => {
                let ok = tcp_open(&ip, port, Duration::from_secs(TCP_WAIT_SECS)).await;
                if let Some(decision) = machine.tcp(ok) {
                    break decision;
                }
            }
        }
    };
    HostCheck {
        status: decision.status,
        method: decision.method,
        elapsed_ms: started.elapsed().as_millis() as u64,
        ips: machine.ips().to_vec(),
    }
}

/// Run `places` with at most `workers` checks in flight. Results arrive as each host finishes.
pub fn check_all(
    hosts: Vec<String>,
    workers: usize,
) -> mpsc::UnboundedReceiver<(usize, HostCheck)> {
    let (tx, rx) = mpsc::unbounded_channel();
    let workers = workers.max(1);
    tokio::spawn(async move {
        let semaphore = std::sync::Arc::new(Semaphore::new(workers));
        let mut joins = Vec::with_capacity(hosts.len());
        for (index, host) in hosts.into_iter().enumerate() {
            let permit = match semaphore.clone().acquire_owned().await {
                Ok(permit) => permit,
                Err(_) => break,
            };
            let tx = tx.clone();
            joins.push(tokio::spawn(async move {
                let result = check_host(&host).await;
                let _ = tx.send((index, result));
                drop(permit);
            }));
        }
        drop(tx);
        for join in joins {
            let _ = join.await;
        }
    });
    rx
}

pub async fn resolve_v4(host: &str) -> Vec<String> {
    if downtime_core::valid_address(host) && is_ipv4_literal(host) {
        return vec![host.to_string()];
    }
    let host_owned = host.to_string();
    let looked_up = timeout(Duration::from_secs(TCP_WAIT_SECS), async move {
        let mut ips = Vec::new();
        if let Ok(addresses) = tokio::net::lookup_host((host_owned, 0)).await {
            for address in addresses {
                if let std::net::SocketAddr::V4(socket) = address {
                    let ip = socket.ip().to_string();
                    if !ips.contains(&ip) {
                        ips.push(ip);
                    }
                }
            }
        }
        ips
    })
    .await;
    looked_up.unwrap_or_default()
}

fn is_ipv4_literal(host: &str) -> bool {
    downtime_core::parse_ipv4(host).is_some() || looks_like_loose_ipv4(host)
}

fn looks_like_loose_ipv4(host: &str) -> bool {
    let parts: Vec<&str> = host.split('.').collect();
    parts.len() == 4
        && parts.iter().all(|part| {
            !part.is_empty() && part.len() <= 3 && part.bytes().all(|byte| byte.is_ascii_digit())
        })
}

pub async fn tcp_open(ip: &str, port: u16, budget: Duration) -> bool {
    let address = format!("{ip}:{port}");
    match timeout(budget, TcpStream::connect(address)).await {
        Ok(Ok(stream)) => {
            drop(stream);
            true
        }
        _ => false,
    }
}

pub fn icmp_mode() -> IcmpMode {
    match ICMP_MODE.load(Ordering::Relaxed) {
        ICMP_ALLOWED => IcmpMode::Allowed,
        ICMP_UNAVAILABLE => IcmpMode::Unavailable,
        _ => IcmpMode::Unknown,
    }
}

async fn ping_host(host: &str) -> bool {
    if ICMP_MODE.load(Ordering::Relaxed) == ICMP_UNAVAILABLE {
        return false;
    }
    if !cfg!(unix) {
        ICMP_MODE.store(ICMP_UNAVAILABLE, Ordering::Relaxed);
        return false;
    }
    let (program, args) = ping_command(host);
    let mut command = Command::new(&program);
    command
        .args(&args)
        .kill_on_drop(true)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(_) => {
            ICMP_MODE.store(ICMP_UNAVAILABLE, Ordering::Relaxed);
            return false;
        }
    };
    let budget = Duration::from_secs(PING_WAIT_SECS + 3);
    let waited = timeout(budget, child.wait()).await;
    let stderr = match child.stderr.take() {
        Some(mut pipe) => {
            let mut buf = Vec::new();
            let _ = timeout(Duration::from_millis(200), pipe.read_to_end(&mut buf)).await;
            String::from_utf8_lossy(&buf).to_string()
        }
        None => String::new(),
    };
    match waited {
        Ok(Ok(status)) if status.success() => {
            ICMP_MODE.store(ICMP_ALLOWED, Ordering::Relaxed);
            true
        }
        Ok(Ok(status)) => {
            if icmp_denied(status.code(), &stderr) {
                ICMP_MODE.store(ICMP_UNAVAILABLE, Ordering::Relaxed);
            } else {
                ICMP_MODE.store(ICMP_ALLOWED, Ordering::Relaxed);
            }
            false
        }
        _ => {
            let _ = child.kill().await;
            false
        }
    }
}

fn icmp_denied(code: Option<i32>, stderr: &str) -> bool {
    let text = stderr.to_lowercase();
    text.contains("not permitted")
        || text.contains("operation not permitted")
        || text.contains("permission denied")
        || (code == Some(2) && text.contains("socket"))
}

fn ping_command(host: &str) -> (String, Vec<String>) {
    let ipv6 = host.contains(':');
    if cfg!(target_os = "macos") {
        let wait = (PING_WAIT_SECS * 1000).to_string();
        let program = if ipv6 { "ping6" } else { "ping" };
        (
            program.to_string(),
            vec![
                "-n".into(),
                "-c".into(),
                "1".into(),
                "-W".into(),
                wait,
                host.to_string(),
            ],
        )
    } else {
        let family = if ipv6 { "-6" } else { "-4" };
        (
            "ping".into(),
            vec![
                family.into(),
                "-n".into(),
                "-c".into(),
                "1".into(),
                "-W".into(),
                PING_WAIT_SECS.to_string(),
                host.to_string(),
            ],
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn tcp_open_reaches_a_local_listener() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                if listener.accept().await.is_err() {
                    break;
                }
            }
        });
        assert!(tcp_open("127.0.0.1", port, Duration::from_secs(2)).await);
        assert!(!tcp_open("127.0.0.1", 1, Duration::from_millis(400)).await);
    }

    #[tokio::test]
    async fn loopback_answers_ping_or_falls_back_without_panicking() {
        let result = check_host("127.0.0.1").await;
        assert_eq!(result.status, Status::Up);
        assert!(matches!(
            result.method,
            Method::Ping | Method::Https | Method::Http
        ));
        assert!(!result.ips.is_empty());
    }
}
