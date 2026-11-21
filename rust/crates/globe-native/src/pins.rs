//! Catalog data for the globe, loaded through `downtime-core`/`downtime-native`.

use std::path::Path;

use downtime_core::{capital, Loaded};
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

/// Load catalogs from `root`, or search upward from the current directory.
pub fn load(root: Option<&Path>) -> PinData {
    let root = match root {
        Some(r) => Some(r.to_path_buf()),
        None => std::env::current_dir().ok().and_then(|d| downtime_native::find_root(&d)),
    };
    let Some(root) = root else {
        return PinData { pins: Vec::new(), searches: Vec::new(), status: "Catalog folder not found (pass --root)".into() };
    };
    match downtime_native::load_catalog_dir(&root) {
        Ok(loaded) => from_loaded(&loaded, &root),
        Err(e) => PinData { pins: Vec::new(), searches: Vec::new(), status: format!("Catalog error: {e:?}") },
    }
}

pub fn from_loaded(loaded: &Loaded, root: &Path) -> PinData {
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
        status: format!("{} countries from {}", loaded.countries.len(), root.display()),
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
}
