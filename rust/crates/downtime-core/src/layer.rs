//! Plug-in point for data layers drawn on top of the catalogs.
//!
//! Reachability (ICMP, then TCP 443, then TCP 80) is the only layer that runs
//! today. The others are named stubs so a later feed can implement [`DataLayer`]
//! without changing the CLI or the globe protocol.

use alloc::boxed::Box;
use alloc::string::String;
use alloc::vec::Vec;

use crate::model::{Report, Status};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LayerKind {
    /// Checks run and produce observations.
    Active,
    /// Reserved name. `collect` returns nothing.
    Stub,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LayerInfo {
    pub id: &'static str,
    pub title: &'static str,
    pub kind: LayerKind,
    pub summary: &'static str,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Observation {
    pub layer: &'static str,
    pub id: String,
    pub label: String,
    pub status: Status,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub detail: String,
}

const LAYERS: &[LayerInfo] = &[
    LayerInfo {
        id: "reachability",
        title: "Website reachability",
        kind: LayerKind::Active,
        summary: "ICMP echo, then TCP 443, then TCP 80. UP when any of them answers.",
    },
    LayerInfo {
        id: "power",
        title: "Power outages",
        kind: LayerKind::Stub,
        summary: "Same ODIN / UK / Hydro-Québec feed as the Cesium globe.",
    },
    LayerInfo {
        id: "adsb",
        title: "Live air traffic",
        kind: LayerKind::Stub,
        summary: "adsb.lol, one synthetic user, 500 req/day class of cap.",
    },
    LayerInfo {
        id: "gps-jamming",
        title: "Jammed GPS signals",
        kind: LayerKind::Stub,
        summary: "GPSInterference.com, cached like the web globe.",
    },
    LayerInfo {
        id: "ships",
        title: "Maritime traffic",
        kind: LayerKind::Stub,
        summary: "AIS snapshot in-process, not a per-window tile flood.",
    },
    LayerInfo {
        id: "mesh",
        title: "Mesh nodes",
        kind: LayerKind::Stub,
        summary: "meshmap.net, one cached copy.",
    },
    LayerInfo {
        id: "disease",
        title: "Disease outbreak",
        kind: LayerKind::Stub,
        summary: "HealthMap, one cached copy.",
    },
    LayerInfo {
        id: "animal",
        title: "Animal disease outbreak",
        kind: LayerKind::Stub,
        summary: "GIDEON public events, is_animal filter.",
    },
    LayerInfo {
        id: "scanners",
        title: "Scanners",
        kind: LayerKind::Stub,
        summary: "OpenMHz / radio-browser list from the datapack.",
    },
    LayerInfo {
        id: "conflicts",
        title: "Conflict tracker",
        kind: LayerKind::Stub,
        summary: "CFR Global Conflict Tracker.",
    },
    LayerInfo {
        id: "hunger",
        title: "World hunger",
        kind: LayerKind::Stub,
        summary: "FAO 2024 yearly numbers. Not a live timer.",
    },
    LayerInfo {
        id: "amfm",
        title: "AM FM towers",
        kind: LayerKind::Stub,
        summary: "FCC / packed station list from the web globe.",
    },
    LayerInfo {
        id: "grid",
        title: "Country grid",
        kind: LayerKind::Stub,
        summary: "15-minute saved pass plus spiderweb replay.",
    },
    LayerInfo {
        id: "traffic",
        title: "Traffic",
        kind: LayerKind::Stub,
        summary: "Road conditions. Web globe does not have this yet either.",
    },
    LayerInfo {
        id: "cams",
        title: "Live cameras",
        kind: LayerKind::Stub,
        summary: "Reserved. Not on the Cesium globe yet.",
    },
    LayerInfo {
        id: "historical",
        title: "Historical sites",
        kind: LayerKind::Stub,
        summary: "Reserved. Not on the Cesium globe yet.",
    },
];

pub fn builtin_layers() -> &'static [LayerInfo] {
    LAYERS
}

pub fn layer_by_id(id: &str) -> Option<&'static LayerInfo> {
    LAYERS.iter().find(|layer| layer.id == id)
}

/// A source of map observations. Implement this to add a layer.
pub trait DataLayer: Send {
    fn info(&self) -> &'static LayerInfo;
    fn collect(&self, reports: &[Report]) -> Vec<Observation>;
}

pub struct ReachabilityLayer;

impl DataLayer for ReachabilityLayer {
    fn info(&self) -> &'static LayerInfo {
        layer_by_id("reachability").expect("reachability layer is built in")
    }

    fn collect(&self, reports: &[Report]) -> Vec<Observation> {
        reports
            .iter()
            .map(|report| Observation {
                layer: "reachability",
                id: report.place.address.clone(),
                label: report.place.name.clone(),
                status: report.status,
                lat: report.place.lat,
                lon: report.place.lon,
                detail: report.method.as_str().into(),
            })
            .collect()
    }
}

struct StubLayer {
    info: &'static LayerInfo,
}

impl DataLayer for StubLayer {
    fn info(&self) -> &'static LayerInfo {
        self.info
    }

    fn collect(&self, _reports: &[Report]) -> Vec<Observation> {
        Vec::new()
    }
}

/// Active reachability layer, then one stub per planned feed.
pub fn layer_registry() -> Vec<Box<dyn DataLayer>> {
    let mut layers: Vec<Box<dyn DataLayer>> = Vec::new();
    layers.push(Box::new(ReachabilityLayer));
    for info in LAYERS.iter().filter(|info| info.kind == LayerKind::Stub) {
        layers.push(Box::new(StubLayer { info }));
    }
    layers
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Method, Place};

    #[test]
    fn stubs_collect_nothing_and_reachability_keeps_the_verdict() {
        let layers = layer_registry();
        assert_eq!(layers.len(), LAYERS.len());
        assert_eq!(layers[0].info().kind, LayerKind::Active);
        assert!(layers
            .iter()
            .skip(1)
            .all(|layer| layer.collect(&[]).is_empty()));

        let mut place = Place::new("Weather", "weather.gov");
        place.country = "United States".into();
        let reports = alloc::vec![Report {
            place,
            status: Status::Up,
            method: Method::Https,
            elapsed_ms: 12,
            ips: Vec::new(),
            ip: String::new(),
            approx: false,
        }];
        let observations = ReachabilityLayer.collect(&reports);
        assert_eq!(observations.len(), 1);
        assert_eq!(observations[0].status, Status::Up);
        assert_eq!(observations[0].detail, "https");
        assert!(layer_by_id("power").unwrap().kind == LayerKind::Stub);
    }
}
