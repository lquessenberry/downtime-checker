//! Catalog parsing and reachability decisions, with no sockets attached.
//!
//! The default `std` feature is for hosted builds. Disable it (`no_std` + `alloc`)
//! when targeting embedded hardware: [`CheckMachine`] still decides the outcome,
//! and a board-specific driver supplies DNS, ICMP, and TCP answers.
//!
//! A place is UP when ICMP echo succeeds. If ping stays silent, TCP port 443 is
//! tried, then port 80, on at most two resolved IPv4 addresses. The sample IP
//! stored beside a catalog row is never what gets probed.

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

mod blast;
mod catalog;
mod check;
mod geo;
mod group;
mod layer;
mod model;

pub use blast::{card as blast_card, defcon as blast_defcon, rings as blast_rings, Shot as BlastShot, BlastRings, KT_PRESETS};
pub use catalog::{
    catalog_host, load_catalog, normalize_address, places_for, searches, valid_address,
    CATALOG_FILES,
};
pub use check::{classify, CheckMachine, ProbeRequest, CHECK_ORDER, MAX_TCP_TARGETS, TCP_PORTS};
pub use geo::{
    capital, country_from_location, first_public_ipv4, format_location, is_public_ipv4, jitter,
    locate, parse_ipv4, region_from_location, GeoRecord, LocateMode, Located,
};
pub use group::{checked_address, summarize, CountryGroup, Grouped, StateGroup};
pub use layer::{
    builtin_layers, layer_by_id, layer_registry, DataLayer, LayerInfo, LayerKind, Observation,
    ReachabilityLayer,
};
pub use model::{
    Decision, Groups, Loaded, Method, Place, Report, SearchCount, SearchDef, Section, Status,
    DEFAULT_WORKERS, LOOKUP_WORKERS, PING_WAIT_SECS, TCP_WAIT_SECS,
};
