use std::collections::BTreeMap;
#[cfg(not(target_arch = "wasm32"))]
use std::path::Path;

use crate::leaf::{Bundle, Leaf, LinkKind};
use crate::parse::{parse_leaves, ParseError};

const CORE: &str = include_str!("../leaves/core.leaf.txt");

/// Collection of leaves. Drupal: site. Rustle: grove.
#[derive(Clone, Debug, Default)]
pub struct Grove {
    leaves: BTreeMap<String, Leaf>,
}

#[derive(Clone, Debug)]
pub struct Nearby {
    pub leaf: Leaf,
    pub km: f64,
}

/// Map click → fences that contain it, nearby points, orbitals, live-data links.
#[derive(Clone, Debug)]
pub struct Context {
    pub lat: f64,
    pub lon: f64,
    pub fences: Vec<Leaf>,
    pub nearby: Vec<Nearby>,
    pub orbitals: Vec<Leaf>,
}

impl Grove {
    pub fn new() -> Self {
        Self {
            leaves: BTreeMap::new(),
        }
    }

    pub fn builtin() -> Self {
        Self::from_text(CORE).expect("core.leaf.txt")
    }

    pub fn from_text(text: &str) -> Result<Self, ParseError> {
        let mut grove = Self::new();
        grove.extend_text(text)?;
        Ok(grove)
    }

    pub fn extend_text(&mut self, text: &str) -> Result<(), ParseError> {
        for leaf in parse_leaves(text)? {
            self.insert(leaf);
        }
        Ok(())
    }

    pub fn insert(&mut self, leaf: Leaf) {
        self.leaves.insert(leaf.id.clone(), leaf);
    }

    pub fn len(&self) -> usize {
        self.leaves.len()
    }

    pub fn is_empty(&self) -> bool {
        self.leaves.is_empty()
    }

    pub fn get(&self, id: &str) -> Option<&Leaf> {
        self.leaves.get(id)
    }

    pub fn all(&self) -> impl Iterator<Item = &Leaf> {
        self.leaves.values()
    }

    pub fn by_bundle(&self, bundle: &Bundle) -> Vec<&Leaf> {
        self.leaves
            .values()
            .filter(|leaf| &leaf.bundle == bundle)
            .collect()
    }

    pub fn by_tag(&self, tag: &str) -> Vec<&Leaf> {
        self.leaves
            .values()
            .filter(|leaf| leaf.tags.iter().any(|item| item == tag))
            .collect()
    }

    pub fn linked(&self, kind: LinkKind, target: &str) -> Vec<&Leaf> {
        self.leaves
            .values()
            .filter(|leaf| {
                leaf.links
                    .iter()
                    .any(|link| link.kind == kind && link.target == target)
            })
            .collect()
    }

    pub fn fences_containing(&self, lat: f64, lon: f64) -> Vec<&Leaf> {
        self.leaves
            .values()
            .filter(|leaf| leaf.bundle == Bundle::Geofence && leaf.contains(lat, lon))
            .collect()
    }

    pub fn context(&self, lat: f64, lon: f64) -> Context {
        let fences = self
            .fences_containing(lat, lon)
            .into_iter()
            .cloned()
            .collect();
        let mut nearby: Vec<Nearby> = self
            .leaves
            .values()
            .filter_map(|leaf| {
                let (plat, plon) = leaf.point()?;
                Some(Nearby {
                    leaf: leaf.clone(),
                    km: haversine_km(lat, lon, plat, plon),
                })
            })
            .collect();
        nearby.sort_by(|a, b| a.km.partial_cmp(&b.km).unwrap_or(std::cmp::Ordering::Equal));
        nearby.truncate(8);
        let orbitals = self
            .by_bundle(&Bundle::Geoorbital)
            .into_iter()
            .cloned()
            .collect();
        Context {
            lat,
            lon,
            fences,
            nearby,
            orbitals,
        }
    }

    pub fn json(&self) -> serde_json::Value {
        let leaves: Vec<serde_json::Value> = self.leaves.values().map(Leaf::json).collect();
        serde_json::json!({
            "cms": "rustle",
            "count": self.leaves.len(),
            "leaves": leaves,
        })
    }

    /// Overlay extra `*.leaf.txt` files from a directory (optional, git checkout).
    #[cfg(not(target_arch = "wasm32"))]
    pub fn load_dir(&mut self, dir: &Path) -> Result<usize, String> {
        let entries = std::fs::read_dir(dir).map_err(|err| err.to_string())?;
        let mut added = 0usize;
        let mut names: Vec<_> = entries.filter_map(|entry| entry.ok()).collect();
        names.sort_by_key(|entry| entry.file_name());
        for entry in names {
            let path = entry.path();
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if !name.ends_with(".leaf.txt") {
                continue;
            }
            let text = std::fs::read_to_string(&path).map_err(|err| err.to_string())?;
            let before = self.len();
            self.extend_text(&text).map_err(|err| err.to_string())?;
            added += self.len().saturating_sub(before);
        }
        Ok(added)
    }
}

impl Context {
    pub fn json(&self) -> serde_json::Value {
        serde_json::json!({
            "lat": self.lat,
            "lon": self.lon,
            "fences": self.fences.iter().map(Leaf::json).collect::<Vec<_>>(),
            "nearby": self.nearby.iter().map(|row| {
                serde_json::json!({
                    "km": (row.km * 10.0).round() / 10.0,
                    "leaf": row.leaf.json(),
                })
            }).collect::<Vec<_>>(),
            "orbitals": self.orbitals.iter().map(Leaf::json).collect::<Vec<_>>(),
        })
    }
}

fn haversine_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    const R: f64 = 6371.0;
    let p1 = lat1.to_radians();
    let p2 = lat2.to_radians();
    let dp = (lat2 - lat1).to_radians();
    let dl = (lon2 - lon1).to_radians();
    let a = (dp / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dl / 2.0).sin().powi(2);
    2.0 * R * a.sqrt().asin()
}
