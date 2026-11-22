//! Catalog parsing and result aggregation for the browser.
//!
//! A page can fetch the `.txt` catalogs and pass them to [`parse_catalog`] /
//! [`places`]. It can also fold a list of UP/DOWN rows with [`aggregate`].
//!
//! What does **not** run here: ICMP and raw TCP. Browser sockets cannot send an
//! echo request or open port 443 on an arbitrary host. Those probes stay in
//! `downtime` and `downtime-server`. Point the existing globe at the Rust (or
//! Node) server; the server streams the same SSE events either way.
//!
//! [`classify_answers`] is the shared decision function with the probes already
//! filled in, so the page can show why a host would be UP or DOWN.

use std::collections::BTreeMap;

use downtime_core::{
    blast_card, blast_defcon, blast_rings, builtin_layers, classify, load_catalog, places_for,
    summarize, BlastShot, LayerKind, Loaded, Method, Place, Report, Status, KT_PRESETS,
};
use rustle::builtin_grove;
use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

/// First-party blast rings. `airburst` is 1 for air, 0 for ground.
#[wasm_bindgen]
pub fn blast_rings_json(yield_kt: f64, airburst: u8) -> String {
    let r = blast_rings(yield_kt, airburst != 0);
    serde_json::to_string(&json!({
        "yieldKt": r.yield_kt,
        "airburst": r.airburst,
        "fireballM": r.fireball_m,
        "heavyM": r.heavy_m,
        "mediumM": r.medium_m,
        "lightM": r.light_m,
        "thermalM": r.thermal_m,
        "falloutM": r.fallout_m,
        "presets": KT_PRESETS,
    }))
    .unwrap_or_else(|_| "{}".to_string())
}

#[wasm_bindgen]
pub fn blast_card_text(lat: f64, lon: f64, yield_kt: f64, airburst: u8) -> String {
    blast_card(BlastShot {
        lat,
        lon,
        yield_kt,
        airburst: airburst != 0,
    })
}

#[wasm_bindgen]
pub fn blast_defcon_level(count: u32, max_kt: f64) -> u8 {
    let shots: Vec<BlastShot> = (0..count)
        .map(|_| BlastShot {
            lat: 0.0,
            lon: 0.0,
            yield_kt: max_kt,
            airburst: true,
        })
        .collect();
    blast_defcon(&shots)
}

#[wasm_bindgen]
pub fn runtime_note() -> String {
    "Rustle grove + catalog in WASM. Click the globe for leaf context \
     (geofence / nearby / orbital). CHECK GRID runs ICMP/443/80 on the server. \
     Drag to spin, wheel to zoom, FIRE for first-party blast rings."
        .to_string()
}

#[wasm_bindgen]
pub fn rustle_grove_json() -> String {
    builtin_grove().json().to_string()
}

#[wasm_bindgen]
pub fn rustle_context_json(lat: f64, lon: f64) -> String {
    builtin_grove().context(lat, lon).json().to_string()
}

#[wasm_bindgen]
pub fn rustle_leaf_json(id: &str) -> String {
    match builtin_grove().get(id) {
        Some(leaf) => leaf.json().to_string(),
        None => "{}".into(),
    }
}

#[wasm_bindgen]
pub fn layer_catalog() -> String {
    let layers: Vec<Value> = builtin_layers()
        .iter()
        .map(|layer| {
            json!({
                "id": layer.id,
                "title": layer.title,
                "kind": kind_name(layer.kind),
                "summary": layer.summary,
            })
        })
        .collect();
    serde_json::to_string(&layers).unwrap_or_else(|_| "[]".to_string())
}

/// `files_json` is an object whose keys are catalog filenames (`weather.txt`, ...).
/// Returns searches (with counts) and the world-government country list.
#[wasm_bindgen]
pub fn parse_catalog(files_json: &str) -> Result<String, JsValue> {
    let files = files_from_json(files_json)?;
    let loaded = load_catalog(&files);
    Ok(summary_json(&loaded).to_string())
}

/// Places for one search. Pass an empty `country` unless `search_id` is `country`.
#[wasm_bindgen]
pub fn places(files_json: &str, search_id: &str, country: &str) -> Result<String, JsValue> {
    let files = files_from_json(files_json)?;
    let loaded = load_catalog(&files);
    let country = if country.is_empty() {
        None
    } else {
        Some(country)
    };
    let rows = places_for(&loaded, search_id, country);
    let json_rows: Vec<Value> = rows.iter().map(place_json).collect();
    serde_json::to_string(&json_rows).map_err(|err| JsValue::from_str(&err.to_string()))
}

/// Group finished checks by country and state. Each row needs `name`, `address`,
/// and `status` (`up` or `down`). `country`, `region`, and `location` are optional.
#[wasm_bindgen]
pub fn aggregate(results_json: &str) -> Result<String, JsValue> {
    let value: Value =
        serde_json::from_str(results_json).map_err(|err| JsValue::from_str(&err.to_string()))?;
    let rows = value
        .as_array()
        .ok_or_else(|| JsValue::from_str("expected a JSON array"))?;
    let mut reports = Vec::new();
    for row in rows {
        reports.push(report_from_json(row)?);
    }
    let grouped = summarize(&reports);
    let by_location: Vec<Value> = grouped
        .by_location
        .iter()
        .map(|country| {
            json!({
                "country": country.country,
                "states": country.states.iter().map(|state| {
                    json!({
                        "state": state.state,
                        "places": state.reports.iter().map(|report| json!({
                            "name": report.place.name,
                            "address": report.place.address,
                            "status": report.status.as_str(),
                        })).collect::<Vec<_>>(),
                    })
                }).collect::<Vec<_>>(),
            })
        })
        .collect();
    Ok(json!({
        "checked": grouped.checked,
        "online": grouped.online,
        "offline": grouped.offline,
        "countries": grouped.countries,
        "byLocation": by_location,
    })
    .to_string())
}

/// Decide UP or DOWN from answers the page already has.
///
/// `ips_json` is a JSON array of IPv4 strings. `open_json` maps `"ip:port"` to a
/// boolean, for example `{"1.2.3.4:443": true}`.
#[wasm_bindgen]
pub fn classify_answers(
    host: &str,
    ping_ok: bool,
    ips_json: &str,
    open_json: &str,
) -> Result<String, JsValue> {
    let ips_value: Value =
        serde_json::from_str(ips_json).map_err(|err| JsValue::from_str(&err.to_string()))?;
    let open_value: Value =
        serde_json::from_str(open_json).map_err(|err| JsValue::from_str(&err.to_string()))?;
    let ips = ips_value
        .as_array()
        .ok_or_else(|| JsValue::from_str("ips must be an array"))?
        .iter()
        .filter_map(|value| value.as_str().map(str::to_string))
        .collect::<Vec<_>>();
    let decision = classify(host, ping_ok, &ips, |ip, port| {
        open_value
            .get(format!("{ip}:{port}"))
            .and_then(Value::as_bool)
            .unwrap_or(false)
    });
    Ok(json!({
        "status": decision.status.as_str(),
        "method": decision.method.as_str(),
    })
    .to_string())
}

fn kind_name(kind: LayerKind) -> &'static str {
    match kind {
        LayerKind::Active => "active",
        LayerKind::Stub => "stub",
    }
}

fn files_from_json(text: &str) -> Result<BTreeMap<String, String>, JsValue> {
    let value: Value =
        serde_json::from_str(text).map_err(|err| JsValue::from_str(&err.to_string()))?;
    let object = value
        .as_object()
        .ok_or_else(|| JsValue::from_str("files must be a JSON object"))?;
    let mut files = BTreeMap::new();
    for (key, item) in object {
        if let Some(text) = item.as_str() {
            files.insert(key.clone(), text.to_string());
        }
    }
    Ok(files)
}

fn summary_json(loaded: &Loaded) -> Value {
    json!({
        "countries": loaded.countries,
        "searches": loaded.searches.iter().map(|search| json!({
            "id": search.id,
            "label": search.label,
            "group": search.group,
            "count": search.count,
        })).collect::<Vec<_>>(),
        "runtime": "wasm",
    })
}

fn place_json(place: &Place) -> Value {
    json!({
        "name": place.name,
        "address": place.address,
        "country": place.country,
        "kinds": place.kinds,
        "source": place.source,
        "location": place.location,
        "lat": place.lat,
        "lon": place.lon,
    })
}

fn report_from_json(row: &Value) -> Result<Report, JsValue> {
    let name = row
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let address = row
        .get("address")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if name.is_empty() || address.is_empty() {
        return Err(JsValue::from_str("each result needs name and address"));
    }
    let status = row
        .get("status")
        .and_then(Value::as_str)
        .and_then(Status::parse)
        .ok_or_else(|| JsValue::from_str("status must be up or down"))?;
    let method = match row.get("method").and_then(Value::as_str).unwrap_or("none") {
        "ping" => Method::Ping,
        "https" => Method::Https,
        "http" => Method::Http,
        _ => Method::None,
    };
    let mut place = Place::new(name, address);
    place.country = row
        .get("country")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    place.region = row
        .get("region")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    place.city = row
        .get("city")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    place.location = row
        .get("location")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    Ok(Report {
        place,
        status,
        method,
        elapsed_ms: row.get("ms").and_then(Value::as_u64).unwrap_or(0),
        ips: Vec::new(),
        ip: row
            .get("ip")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        approx: row.get("approx").and_then(Value::as_bool).unwrap_or(false),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn note_mentions_the_split_between_wasm_and_native() {
        let note = runtime_note();
        assert!(note.contains("CHECK GRID"));
        assert!(note.contains("Rustle"));
    }

    #[test]
    fn rustle_grove_exports_core_leaves() {
        let grove: Value = serde_json::from_str(&rustle_grove_json()).unwrap();
        assert!(grove["count"].as_u64().unwrap() >= 8);
        let ctx: Value =
            serde_json::from_str(&rustle_context_json(-30.0, -20.0)).unwrap();
        assert!(ctx["fences"]
            .as_array()
            .unwrap()
            .iter()
            .any(|leaf| leaf["id"] == "saa"));
    }

    #[test]
    fn parses_a_weather_catalog_and_classifies_without_sockets() {
        let files = r#"{"weather.txt":"National Weather Service | weather.gov | United States | 23.192.220.19\n"}"#;
        let summary: Value = serde_json::from_str(&parse_catalog(files).unwrap()).unwrap();
        let weather = summary["searches"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["id"] == "weather")
            .unwrap();
        assert_eq!(weather["count"], 1);
        let rows: Value = serde_json::from_str(&places(files, "weather", "").unwrap()).unwrap();
        assert_eq!(rows[0]["address"], "weather.gov");
        assert_ne!(rows[0]["address"], "23.192.220.19");

        let up = classify_answers("weather.gov", true, "[]", "{}").unwrap();
        assert!(up.contains("\"status\":\"up\""));
        assert!(up.contains("\"method\":\"ping\""));
        let https = classify_answers(
            "weather.gov",
            false,
            "[\"1.2.3.4\"]",
            "{\"1.2.3.4:443\":true}",
        )
        .unwrap();
        assert!(https.contains("\"method\":\"https\""));
        let down = classify_answers("weather.gov", false, "[\"1.2.3.4\"]", "{}").unwrap();
        assert!(down.contains("\"method\":\"none\""));
    }

    #[test]
    fn aggregate_counts_and_groups() {
        let raw = r#"[{
            "name":"National Weather Service",
            "address":"weather.gov",
            "country":"United States",
            "region":"Maryland",
            "location":"Silver Spring, Maryland 20910, United States",
            "status":"up"
        }]"#;
        let grouped: Value = serde_json::from_str(&aggregate(raw).unwrap()).unwrap();
        assert_eq!(grouped["online"], 1);
        assert_eq!(grouped["countries"][0], "United States");
        assert_eq!(grouped["byLocation"][0]["states"][0]["state"], "Maryland");
    }
}
