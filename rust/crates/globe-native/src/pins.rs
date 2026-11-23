//! Catalog data for the globe, loaded through `downtime-core`/`downtime-native`.

use std::collections::BTreeMap;
#[cfg(all(not(target_os = "android"), not(target_arch = "wasm32")))]
use std::path::Path;

use downtime_core::{capital, load_catalog, Loaded, CATALOG_FILES};
use glam::Vec3;

use crate::globe_math::lat_lon_to_unit;

pub struct Pin {
    pub label: String,
    pub lat: f64,
    pub lon: f64,
}

impl Pin {
    pub fn unit(&self) -> Vec3 {
        // Lift pins a hair above the surface.
        lat_lon_to_unit(self.lat, self.lon) * 1.002
    }
}

pub struct SearchRow {
    pub label: String,
    pub count: usize,
}

pub struct PinData {
    pub pins: Vec<Pin>,
    pub searches: Vec<SearchRow>,
    pub status: String,
}

impl PinData {
    pub fn summary(&self) -> String {
        let mut out = format!("{}\n{} capital pins\n", self.status, self.pins.len());
        for s in &self.searches {
            out.push_str(&format!("{:>6}  {}\n", s.count, s.label));
        }
        out
    }
}

/// Catalog files compiled into the binary, so the app works with no folder
/// next to it (Android, a macOS .app, a bare download). Same list as
/// `downtime_core::CATALOG_FILES`; `added-places.txt` is optional and empty here.
pub const EMBEDDED: &[(&str, &str)] = &[
    ("places.txt", include_str!("../../../../places.txt")),
    ("world-governments.txt", include_str!("../../../../world-governments.txt")),
    ("institutions.txt", include_str!("../../../../institutions.txt")),
    ("world-exchanges.txt", include_str!("../../../../world-exchanges.txt")),
    ("service-sites.txt", include_str!("../../../../service-sites.txt")),
    ("transportation.txt", include_str!("../../../../transportation.txt")),
    ("stores.txt", include_str!("../../../../stores.txt")),
    ("communications.txt", include_str!("../../../../communications.txt")),
    ("military.txt", include_str!("../../../../military.txt")),
    ("shipping.txt", include_str!("../../../../shipping.txt")),
    ("food.txt", include_str!("../../../../food.txt")),
    ("weather.txt", include_str!("../../../../weather.txt")),
    ("banks-national.txt", include_str!("../../../../banks-national.txt")),
    ("utilities-national.txt", include_str!("../../../../utilities-national.txt")),
    ("government-extra.txt", include_str!("../../../../government-extra.txt")),
];

/// Catalogs built into the app.
pub fn load_embedded() -> PinData {
    let mut files = BTreeMap::new();
    for name in CATALOG_FILES {
        let text = EMBEDDED.iter().find(|(n, _)| n == name).map(|(_, t)| *t).unwrap_or("");
        files.insert((*name).to_string(), text.to_string());
    }
    from_loaded(&load_catalog(&files), "built-in catalogs")
}

/// Load catalogs from `root`, else search upward from the current directory
/// and from the executable, else fall back to the built-in catalogs.
#[cfg(any(target_os = "android", target_arch = "wasm32"))]
pub fn load(_root: Option<&std::path::Path>) -> PinData {
    load_embedded()
}

#[cfg(all(not(target_os = "android"), not(target_arch = "wasm32")))]
pub fn load(root: Option<&Path>) -> PinData {
    let root = match root {
        Some(r) => Some(r.to_path_buf()),
        None => std::env::current_dir()
            .ok()
            .and_then(|d| downtime_native::find_root(&d))
            .or_else(|| std::env::current_exe().ok().and_then(|exe| downtime_native::find_root(&exe))),
    };
    let Some(root) = root else {
        return load_embedded();
    };
    match downtime_native::load_catalog_dir(&root) {
        Ok(loaded) => from_loaded(&loaded, &root.display().to_string()),
        Err(e) => PinData { pins: Vec::new(), searches: Vec::new(), status: format!("Catalog error: {e:?}") },
    }
}

pub fn from_loaded(loaded: &Loaded, source: &str) -> PinData {
    let pins = loaded
        .countries
        .iter()
        .filter_map(|c| capital(c).map(|(lat, lon)| Pin { label: c.clone(), lat, lon }))
        .collect::<Vec<_>>();
    let searches = loaded
        .searches
        .iter()
        .map(|s| SearchRow { label: s.label.to_string(), count: s.count })
        .collect();
    PinData {
        status: format!("{} countries from {}", loaded.countries.len(), source),
        pins,
        searches,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repo_catalogs_produce_capital_pins() {
        let here = Path::new(env!("CARGO_MANIFEST_DIR"));
        let root = downtime_native::find_root(here).expect("repo root with catalogs");
        let data = load(Some(&root));
        assert!(data.pins.len() > 20, "{}", data.summary());
        assert!(data.searches.iter().any(|s| s.count > 0));
        for p in &data.pins {
            assert!((-90.0..=90.0).contains(&p.lat) && (-180.0..=180.0).contains(&p.lon));
        }
    }

    #[test]
    fn embedded_catalogs_match_the_repo_files() {
        let here = Path::new(env!("CARGO_MANIFEST_DIR"));
        let root = downtime_native::find_root(here).expect("repo root with catalogs");
        let from_disk = load(Some(&root));
        let built_in = load_embedded();
        assert_eq!(from_disk.pins.len(), built_in.pins.len());
        assert_eq!(from_disk.searches.len(), built_in.searches.len());
    }
}
