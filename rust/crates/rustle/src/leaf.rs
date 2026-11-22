use std::collections::BTreeMap;
use std::fmt;

/// Drupal bundle → Rustle leaf kind.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Bundle {
    /// Point on Earth (lat/lon).
    Geolocation,
    /// Bounding box or later a ring.
    Geofence,
    /// Orbit / altitude belt.
    Geoorbital,
    /// Maidenhead / H3 / S2 cell.
    Geocell,
    /// Timezone or epoch window.
    Geotime,
    /// Catalog place (weather.gov, etc.).
    Catalog,
    Other(String),
}

impl Bundle {
    pub fn as_str(&self) -> &str {
        match self {
            Bundle::Geolocation => "geolocation",
            Bundle::Geofence => "geofence",
            Bundle::Geoorbital => "geoorbital",
            Bundle::Geocell => "geocell",
            Bundle::Geotime => "geotime",
            Bundle::Catalog => "catalog",
            Bundle::Other(name) => name,
        }
    }

    pub fn parse(text: &str) -> Self {
        match text.trim().to_ascii_lowercase().as_str() {
            "geolocation" | "location" | "point" => Bundle::Geolocation,
            "geofence" | "fence" | "bbox" => Bundle::Geofence,
            "geoorbital" | "orbital" | "orbit" => Bundle::Geoorbital,
            "geocell" | "cell" | "maidenhead" => Bundle::Geocell,
            "geotime" | "timezone" => Bundle::Geotime,
            "catalog" | "place" => Bundle::Catalog,
            other => Bundle::Other(other.to_string()),
        }
    }
}

impl fmt::Display for Bundle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum FieldValue {
    Text(String),
    Number(f64),
    Bool(bool),
}

impl FieldValue {
    pub fn parse(raw: &str) -> Self {
        let trimmed = raw.trim();
        if trimmed.eq_ignore_ascii_case("true") {
            return FieldValue::Bool(true);
        }
        if trimmed.eq_ignore_ascii_case("false") {
            return FieldValue::Bool(false);
        }
        if let Ok(n) = trimmed.parse::<f64>() {
            if trimmed.chars().any(|c| c.is_ascii_digit()) {
                return FieldValue::Number(n);
            }
        }
        FieldValue::Text(trimmed.to_string())
    }

    pub fn as_f64(&self) -> Option<f64> {
        match self {
            FieldValue::Number(n) => Some(*n),
            FieldValue::Text(t) => t.parse().ok(),
            FieldValue::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        }
    }

    pub fn as_text(&self) -> String {
        match self {
            FieldValue::Text(t) => t.clone(),
            FieldValue::Number(n) => {
                if n.fract() == 0.0 && n.abs() < 1e15 {
                    format!("{}", *n as i64)
                } else {
                    n.to_string()
                }
            }
            FieldValue::Bool(b) => b.to_string(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LinkKind {
    Leaf,
    Layer,
    Asset,
    Catalog,
}

impl LinkKind {
    pub fn as_str(self) -> &'static str {
        match self {
            LinkKind::Leaf => "leaf",
            LinkKind::Layer => "layer",
            LinkKind::Asset => "asset",
            LinkKind::Catalog => "catalog",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "leaf" | "entity" => Some(LinkKind::Leaf),
            "layer" => Some(LinkKind::Layer),
            "asset" | "map" => Some(LinkKind::Asset),
            "catalog" | "place" => Some(LinkKind::Catalog),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Link {
    pub kind: LinkKind,
    pub target: String,
}

/// One published datum. Drupal: node + fields. Rustle: a leaf.
#[derive(Clone, Debug, PartialEq)]
pub struct Leaf {
    pub id: String,
    pub bundle: Bundle,
    pub label: String,
    pub status: String,
    pub fields: BTreeMap<String, FieldValue>,
    pub links: Vec<Link>,
    pub tags: Vec<String>,
}

impl Leaf {
    pub fn new(id: impl Into<String>, bundle: Bundle, label: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            bundle,
            label: label.into(),
            status: "published".into(),
            fields: BTreeMap::new(),
            links: Vec::new(),
            tags: Vec::new(),
        }
    }

    pub fn number(&self, name: &str) -> Option<f64> {
        self.fields.get(name).and_then(FieldValue::as_f64)
    }

    pub fn text(&self, name: &str) -> Option<String> {
        self.fields.get(name).map(FieldValue::as_text)
    }

    pub fn point(&self) -> Option<(f64, f64)> {
        Some((self.number("lat")?, self.number("lon")?))
    }

    /// west, south, east, north
    pub fn bbox(&self) -> Option<[f64; 4]> {
        Some([
            self.number("west")?,
            self.number("south")?,
            self.number("east")?,
            self.number("north")?,
        ])
    }

    pub fn contains(&self, lat: f64, lon: f64) -> bool {
        match self.bbox() {
            Some([west, south, east, north]) => {
                lat >= south && lat <= north && lon >= west && lon <= east
            }
            None => false,
        }
    }

    pub fn json(&self) -> serde_json::Value {
        let fields: serde_json::Map<String, serde_json::Value> = self
            .fields
            .iter()
            .map(|(k, v)| {
                let value = match v {
                    FieldValue::Text(t) => serde_json::Value::String(t.clone()),
                    FieldValue::Number(n) => serde_json::json!(n),
                    FieldValue::Bool(b) => serde_json::Value::Bool(*b),
                };
                (k.clone(), value)
            })
            .collect();
        let links: Vec<serde_json::Value> = self
            .links
            .iter()
            .map(|link| {
                serde_json::json!({
                    "kind": link.kind.as_str(),
                    "target": link.target,
                })
            })
            .collect();
        serde_json::json!({
            "id": self.id,
            "bundle": self.bundle.as_str(),
            "label": self.label,
            "status": self.status,
            "fields": fields,
            "links": links,
            "tags": self.tags,
        })
    }
}

/// Build a leaf from a catalog place row (Name | website | country).
pub fn leaf_from_place(
    id: &str,
    name: &str,
    address: &str,
    country: &str,
    lat: Option<f64>,
    lon: Option<f64>,
) -> Leaf {
    let bundle = if lat.is_some() && lon.is_some() {
        Bundle::Geolocation
    } else {
        Bundle::Catalog
    };
    let mut leaf = Leaf::new(id, bundle, name);
    leaf.fields
        .insert("address".into(), FieldValue::Text(address.into()));
    if !country.is_empty() {
        leaf.fields
            .insert("country".into(), FieldValue::Text(country.into()));
    }
    if let Some(lat) = lat {
        leaf.fields
            .insert("lat".into(), FieldValue::Number(lat));
    }
    if let Some(lon) = lon {
        leaf.fields
            .insert("lon".into(), FieldValue::Number(lon));
    }
    leaf.links.push(Link {
        kind: LinkKind::Catalog,
        target: address.to_string(),
    });
    leaf
}
