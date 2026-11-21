use alloc::string::{String, ToString};
use alloc::vec::Vec;

use crate::catalog::looks_like_ipv4;
use crate::model::{Decision, Method, Status};

/// Human-readable probe order shared by the CLI, the server, and WASM.
pub const CHECK_ORDER: &str = "ping, then tcp/443, then tcp/80";
pub const TCP_PORTS: [u16; 2] = [443, 80];
pub const MAX_TCP_TARGETS: usize = 2;

/// The next fact the driver has to supply.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProbeRequest {
    ResolveV4,
    Ping,
    Tcp { ip: String, port: u16 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Resolve,
    Ping,
    Tcp,
    Done,
}

/// Walks ping, then TCP 443, then TCP 80. The driver performs the I/O.
///
/// Resolving first matches the Node checker and does not change the verdict:
/// ping still uses the website name, and TCP runs only after ping stays silent.
pub struct CheckMachine {
    host: String,
    ips: Vec<String>,
    targets: Vec<String>,
    index: usize,
    port: u16,
    phase: Phase,
    decision: Option<Decision>,
}

impl CheckMachine {
    pub fn new(host: impl Into<String>) -> Self {
        Self {
            host: host.into(),
            ips: Vec::new(),
            targets: Vec::new(),
            index: 0,
            port: TCP_PORTS[0],
            phase: Phase::Resolve,
            decision: None,
        }
    }

    pub fn request(&self) -> Option<ProbeRequest> {
        match self.phase {
            Phase::Resolve => Some(ProbeRequest::ResolveV4),
            Phase::Ping => Some(ProbeRequest::Ping),
            Phase::Tcp => Some(ProbeRequest::Tcp {
                ip: self.targets.get(self.index).cloned().unwrap_or_default(),
                port: self.port,
            }),
            Phase::Done => None,
        }
    }

    pub fn resolved(&mut self, ips: Vec<String>) {
        if self.phase != Phase::Resolve {
            return;
        }
        self.ips = ips;
        self.targets = targets_for(&self.host, &self.ips);
        self.phase = Phase::Ping;
    }

    /// `None` means another probe is required. `Some` is the final verdict.
    pub fn pinged(&mut self, ok: bool) -> Option<Decision> {
        if self.phase != Phase::Ping {
            return self.decision;
        }
        if ok {
            return Some(self.finish(Status::Up, Method::Ping));
        }
        if self.targets.is_empty() {
            return Some(self.finish(Status::Down, Method::None));
        }
        self.index = 0;
        self.port = TCP_PORTS[0];
        self.phase = Phase::Tcp;
        None
    }

    pub fn tcp(&mut self, ok: bool) -> Option<Decision> {
        if self.phase != Phase::Tcp {
            return self.decision;
        }
        if ok {
            let method = if self.port == 443 {
                Method::Https
            } else {
                Method::Http
            };
            return Some(self.finish(Status::Up, method));
        }
        if self.port == 443 {
            self.port = 80;
            return None;
        }
        self.index += 1;
        if self.index >= self.targets.len() {
            return Some(self.finish(Status::Down, Method::None));
        }
        self.port = 443;
        None
    }

    pub fn ips(&self) -> &[String] {
        &self.ips
    }

    pub fn decision(&self) -> Option<Decision> {
        self.decision
    }

    fn finish(&mut self, status: Status, method: Method) -> Decision {
        let decision = Decision { status, method };
        self.decision = Some(decision);
        self.phase = Phase::Done;
        decision
    }
}

fn targets_for(host: &str, ips: &[String]) -> Vec<String> {
    if !ips.is_empty() {
        ips.iter().take(MAX_TCP_TARGETS).cloned().collect()
    } else if looks_like_ipv4(host) {
        alloc::vec![host.to_string()]
    } else {
        Vec::new()
    }
}

/// Drive [`CheckMachine`] from answers that are already known.
///
/// `port_open(ip, port)` reports whether that TCP port accepted a connection.
/// WASM uses this because a browser cannot open the socket itself.
pub fn classify(
    host: &str,
    ping_ok: bool,
    ips: &[String],
    mut port_open: impl FnMut(&str, u16) -> bool,
) -> Decision {
    let mut machine = CheckMachine::new(host);
    let _ = machine.request();
    machine.resolved(ips.to_vec());
    let _ = machine.request();
    if let Some(decision) = machine.pinged(ping_ok) {
        return decision;
    }
    loop {
        match machine.request() {
            Some(ProbeRequest::Tcp { ip, port }) => {
                let open = port_open(&ip, port);
                if let Some(decision) = machine.tcp(open) {
                    return decision;
                }
            }
            _ => {
                return machine.decision().unwrap_or(Decision {
                    status: Status::Down,
                    method: Method::None,
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    fn drive_to_ping(host: &str, ips: Vec<String>) -> CheckMachine {
        let mut machine = CheckMachine::new(host);
        assert!(matches!(machine.request(), Some(ProbeRequest::ResolveV4)));
        machine.resolved(ips);
        assert!(matches!(machine.request(), Some(ProbeRequest::Ping)));
        machine
    }

    #[test]
    fn ping_success_skips_tcp() {
        let mut machine = drive_to_ping("example.com", vec!["1.1.1.1".into()]);
        let decision = machine.pinged(true).unwrap();
        assert_eq!(
            decision,
            Decision {
                status: Status::Up,
                method: Method::Ping
            }
        );
        assert!(machine.request().is_none());
    }

    #[test]
    fn silent_ping_tries_443_then_80_on_two_addresses() {
        let mut machine = drive_to_ping(
            "example.com",
            vec!["1.2.3.4".into(), "5.6.7.8".into(), "9.9.9.9".into()],
        );
        assert!(machine.pinged(false).is_none());
        let mut seen = Vec::new();
        loop {
            match machine.request() {
                Some(ProbeRequest::Tcp { ip, port }) => {
                    seen.push((ip, port));
                    if machine.tcp(false).is_some() {
                        break;
                    }
                }
                other => panic!("unexpected {other:?}"),
            }
        }
        assert_eq!(
            seen,
            vec![
                ("1.2.3.4".into(), 443),
                ("1.2.3.4".into(), 80),
                ("5.6.7.8".into(), 443),
                ("5.6.7.8".into(), 80),
            ]
        );
        assert_eq!(
            machine.decision(),
            Some(Decision {
                status: Status::Down,
                method: Method::None
            })
        );
    }

    #[test]
    fn https_wins_before_http() {
        let decision = classify("example.com", false, &["9.9.9.9".into()], |_, port| {
            port == 443
        });
        assert_eq!(decision.method, Method::Https);
        assert_eq!(decision.status, Status::Up);
    }

    #[test]
    fn http_used_when_443_is_closed() {
        let decision = classify("example.com", false, &["9.9.9.9".into()], |_, port| {
            port == 80
        });
        assert_eq!(decision.method, Method::Http);
    }

    #[test]
    fn ipv4_literal_is_a_tcp_target_when_dns_is_empty() {
        let mut machine = drive_to_ping("203.0.113.9", Vec::new());
        assert!(machine.pinged(false).is_none());
        match machine.request() {
            Some(ProbeRequest::Tcp { ip, port }) => {
                assert_eq!(ip, "203.0.113.9");
                assert_eq!(port, 443);
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn hostname_with_no_addresses_is_down_after_ping() {
        let mut machine = drive_to_ping("missing.test", Vec::new());
        let decision = machine.pinged(false).unwrap();
        assert_eq!(decision.method, Method::None);
        assert_eq!(decision.status, Status::Down);
    }
}
