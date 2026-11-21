use alloc::string::String;
use alloc::vec::Vec;

/// How many hosts the Python CLI and the Node visualizer check at once.
pub const DEFAULT_WORKERS: usize = 24;
/// Parallel ipwho.is lookups used by the Python CLI and the Node server.
pub const LOOKUP_WORKERS: usize = 8;
/// Ping `-W` wait, in seconds. macOS ping takes the same wait in milliseconds.
pub const PING_WAIT_SECS: u64 = 2;
/// TCP connect timeout, in seconds. Also the DNS budget.
pub const TCP_WAIT_SECS: u64 = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Up,
    Down,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Up => "up",
            Status::Down => "down",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "up" | "UP" => Some(Status::Up),
            "down" | "DOWN" => Some(Status::Down),
            _ => None,
        }
    }
}

/// Which probe produced the verdict. Names match `visualizer/lib/checker.mjs`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Method {
    Ping,
    Https,
    Http,
    None,
}

impl Method {
    pub fn as_str(self) -> &'static str {
        match self {
            Method::Ping => "ping",
            Method::Https => "https",
            Method::Http => "http",
            Method::None => "none",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Decision {
    pub status: Status,
    pub method: Method,
}

/// One catalog row. `address` is the website name that gets probed.
#[derive(Clone, Debug, PartialEq)]
pub struct Place {
    pub name: String,
    pub address: String,
    pub country: String,
    pub city: String,
    pub region: String,
    pub location: String,
    pub kinds: Vec<String>,
    pub source: String,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
}

impl Place {
    pub fn new(name: impl Into<String>, address: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            address: address.into(),
            country: String::new(),
            city: String::new(),
            region: String::new(),
            location: String::new(),
            kinds: Vec::new(),
            source: String::new(),
            lat: None,
            lon: None,
        }
    }
}

/// A place plus the verdict from a check.
#[derive(Clone, Debug, PartialEq)]
pub struct Report {
    pub place: Place,
    pub status: Status,
    pub method: Method,
    pub elapsed_ms: u64,
    pub ips: Vec<String>,
    pub ip: String,
    pub approx: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Section {
    pub title: String,
    pub places: Vec<Place>,
}

#[derive(Clone, Debug, Default)]
pub struct Groups {
    pub home: Vec<Section>,
    pub world: Vec<Section>,
    pub institutions: Vec<Section>,
    pub services: Vec<Section>,
    pub transport: Vec<Section>,
    pub stores: Vec<Section>,
    pub communications: Vec<Section>,
    pub military: Vec<Section>,
    pub shipping: Vec<Section>,
    pub food: Vec<Section>,
    pub weather: Vec<Section>,
    pub extra_banks: Vec<Section>,
    pub extra_utilities: Vec<Section>,
    pub extra_government: Vec<Section>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SearchDef {
    pub id: &'static str,
    pub label: &'static str,
    pub group: &'static str,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SearchCount {
    pub id: &'static str,
    pub label: &'static str,
    pub group: &'static str,
    pub count: usize,
}

#[derive(Clone, Debug)]
pub struct Loaded {
    pub groups: Groups,
    pub countries: Vec<String>,
    pub searches: Vec<SearchCount>,
}
