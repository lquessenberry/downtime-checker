use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use downtime_core::{load_catalog, GeoRecord, Loaded, Place, CATALOG_FILES};
use serde_json::{Map, Value};

#[derive(Debug)]
pub struct CatalogError {
    pub message: String,
}

impl std::fmt::Display for CatalogError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for CatalogError {}

/// Walk upward from `start` until both `places.txt` and `world-governments.txt` exist.
pub fn find_root(start: &Path) -> Option<PathBuf> {
    let mut current = if start.is_file() {
        start.parent()?.to_path_buf()
    } else {
        start.to_path_buf()
    };
    loop {
        if current.join("places.txt").is_file() && current.join("world-governments.txt").is_file() {
            return Some(current);
        }
        if !current.pop() {
            return None;
        }
    }
}

pub fn load_catalog_dir(root: &Path) -> Result<Loaded, CatalogError> {
    if !root.is_dir() {
        return Err(CatalogError {
            message: format!("Catalog directory does not exist: {}", root.display()),
        });
    }
    let mut files = BTreeMap::new();
    for name in CATALOG_FILES {
        let path = root.join(name);
        let text = match fs::read(&path) {
            Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
            Err(_) => String::new(),
        };
        files.insert((*name).to_string(), text);
    }
    Ok(load_catalog(&files))
}

pub fn read_cache(root: &Path) -> Map<String, Value> {
    let path = root.join("locations.json");
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(_) => return Map::new(),
    };
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(map)) => map,
        _ => Map::new(),
    }
}

pub fn write_cache(root: &Path, cache: &Map<String, Value>) -> Result<(), CatalogError> {
    let path = root.join("locations.json");
    let body = serde_json::to_string_pretty(cache).map_err(|err| CatalogError {
        message: err.to_string(),
    })?;
    fs::write(path, body + "\n").map_err(|err| CatalogError {
        message: err.to_string(),
    })
}

pub fn cache_record(value: &Value) -> Option<GeoRecord> {
    let location = value
        .get("location")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if location.is_empty() {
        return None;
    }
    let lat = value.get("lat").and_then(Value::as_f64)?;
    let lon = value.get("lon").and_then(Value::as_f64)?;
    if !lat.is_finite() || !lon.is_finite() {
        return None;
    }
    Some(GeoRecord {
        location,
        city: value
            .get("city")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string(),
        region: value
            .get("region")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string(),
        country: value
            .get("country")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string(),
        lat,
        lon,
    })
}

pub fn record_value(record: &GeoRecord) -> Value {
    serde_json::json!({
        "location": record.location,
        "city": record.city,
        "region": record.region,
        "country": record.country,
        "lat": record.lat,
        "lon": record.lon,
    })
}

/// Rewrite `added-places.txt` in the Python menu format.
pub fn write_saved(root: &Path, places: &[Place]) -> Result<(), CatalogError> {
    let mut lines = vec![
        "# Places added from the Downtime menu.".to_string(),
        "# Name | address | location | latitude | longitude".to_string(),
    ];
    for place in places {
        lines.push(saved_line(place));
    }
    let path = root.join("added-places.txt");
    fs::write(path, lines.join("\n") + "\n").map_err(|err| CatalogError {
        message: err.to_string(),
    })
}

pub fn saved_line(place: &Place) -> String {
    let mut parts = vec![place.name.clone(), place.address.clone()];
    let has_coords = place.lat.is_some() && place.lon.is_some();
    if !place.location.is_empty() || has_coords {
        parts.push(place.location.clone());
    }
    if let (Some(lat), Some(lon)) = (place.lat, place.lon) {
        parts.push(lat.to_string());
        parts.push(lon.to_string());
    }
    parts.join(" | ")
}

pub fn load_saved_places(root: &Path) -> Vec<Place> {
    load_catalog_dir(root)
        .ok()
        .and_then(|loaded| {
            loaded
                .groups
                .home
                .into_iter()
                .find(|section| section.title == "ADDED PLACES")
                .map(|section| section.places)
        })
        .unwrap_or_default()
}
