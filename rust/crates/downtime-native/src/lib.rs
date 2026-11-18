//! Native probes for the downtime checker.
//!
//! ICMP is the system `ping` binary (macOS flags differ from Linux, same as the
//! Python and Node checkers). When that binary is missing or not permitted to
//! open a raw socket, the probe is treated as silent and TCP 443 then TCP 80
//! still run. Browsers cannot do either; see `downtime-wasm`.

#![deny(unsafe_code)]

mod catalog_io;
mod check;
mod lookup;

pub use catalog_io::{
    cache_record, find_root, load_catalog_dir, load_saved_places, read_cache, record_value,
    saved_line, write_cache, write_saved, CatalogError,
};
pub use check::{check_all, check_host, icmp_mode, resolve_v4, tcp_open, HostCheck, IcmpMode};
pub use lookup::{lookup_ipwho, LookupError};
