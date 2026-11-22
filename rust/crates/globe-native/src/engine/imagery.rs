//! Imagery providers. Cesium splits `ImageryProvider` / `ImageryLayer`.
//! Native: Blue Marble is compiled in. XYZ URLs for OSM / OpenTopo / GIBS
//! live in `map_assets` (no Mapbox, ion, or Esri).

#![allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Basemap {
    BlueMarble,
    Streets,
    Satellite,
    Sentinel,
    Osm,
    OpenTopo,
    Night,
    Plain,
}

impl Basemap {
    pub const ALL: [Basemap; 8] = [
        Basemap::BlueMarble,
        Basemap::Osm,
        Basemap::OpenTopo,
        Basemap::Streets,
        Basemap::Satellite,
        Basemap::Sentinel,
        Basemap::Night,
        Basemap::Plain,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Basemap::BlueMarble => "NASA Blue Marble",
            Basemap::Osm | Basemap::Streets => "OpenStreetMap",
            Basemap::OpenTopo => "OpenTopoMap",
            Basemap::Satellite => "NASA GIBS Blue Marble tiles",
            Basemap::Sentinel => "NASA GIBS MODIS",
            Basemap::Night => "NASA Black Marble",
            Basemap::Plain => "Plain ellipsoid",
        }
    }
}

pub struct ImageryLayer {
    pub basemap: Basemap,
    pub credit: &'static str,
}

impl ImageryLayer {
    pub fn blue_marble() -> Self {
        Self::for_basemap(Basemap::BlueMarble)
    }

    pub fn for_basemap(basemap: Basemap) -> Self {
        let credit = match basemap {
            Basemap::BlueMarble | Basemap::Satellite => "NASA Visible Earth / GIBS",
            Basemap::Osm | Basemap::Streets => "© OpenStreetMap contributors",
            Basemap::OpenTopo => "OpenTopoMap (CC-BY-SA) · OSM · SRTM",
            Basemap::Sentinel => "NASA GIBS / Worldview",
            Basemap::Night => "NASA Black Marble / GIBS",
            Basemap::Plain => "ellipsoid",
        };
        Self { basemap, credit }
    }
}
