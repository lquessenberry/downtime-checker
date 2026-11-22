//! Free map, DEM, and texture sources for the native globe.
//!
//! No Mapbox, Cesium ion, Esri, or Maxar. Tile bytes stay on disk under
//! `data/map-assets/` (gitignored). This module is the URL + license registry.

use super::imagery::Basemap;
use super::terrain::TerrainKind;

/// One catalog row. `xyz` uses `{z} {x} {y}` and optional `{s}` (a/b/c).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MapAsset {
    pub id: &'static str,
    pub title: &'static str,
    pub kind: AssetKind,
    pub license: &'static str,
    pub homepage: &'static str,
    pub xyz: Option<&'static str>,
    pub credit: &'static str,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AssetKind {
    Basemap,
    Topo,
    Dem,
    Satellite,
    VectorArchive,
    Texture,
    Portal,
}

pub const CATALOG: &[MapAsset] = &[
    MapAsset {
        id: "osm",
        title: "OpenStreetMap raster",
        kind: AssetKind::Basemap,
        license: "ODbL",
        homepage: "https://www.openstreetmap.org/copyright",
        xyz: Some("https://tile.openstreetmap.org/{z}/{x}/{y}.png"),
        credit: "© OpenStreetMap contributors",
    },
    MapAsset {
        id: "opentopo",
        title: "OpenTopoMap",
        kind: AssetKind::Topo,
        license: "CC BY-SA + ODbL + SRTM",
        homepage: "https://opentopomap.org/",
        xyz: Some("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"),
        credit: "OpenTopoMap (CC-BY-SA) · OSM · SRTM",
    },
    MapAsset {
        id: "nasa-bluemarble",
        title: "NASA Blue Marble",
        kind: AssetKind::Satellite,
        license: "public domain (NASA)",
        homepage: "https://visibleearth.nasa.gov/",
        xyz: Some(
            "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg",
        ),
        credit: "NASA Visible Earth / GIBS",
    },
    MapAsset {
        id: "nasa-modis",
        title: "NASA GIBS MODIS true color",
        kind: AssetKind::Satellite,
        license: "public domain (NASA)",
        homepage: "https://worldview.earthdata.nasa.gov/",
        xyz: Some(
            "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/{date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg",
        ),
        credit: "NASA GIBS / Worldview",
    },
    MapAsset {
        id: "terrarium",
        title: "Mapzen Terrarium DEM",
        kind: AssetKind::Dem,
        license: "AWS Open Data (elevation-tiles-prod)",
        homepage: "https://github.com/tilezen/joerd",
        xyz: Some("https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"),
        credit: "Mapzen Terrarium / AWS Open Data",
    },
    MapAsset {
        id: "naturalearth",
        title: "Natural Earth 110m",
        kind: AssetKind::VectorArchive,
        license: "public domain",
        homepage: "https://www.naturalearthdata.com/",
        xyz: None,
        credit: "Natural Earth",
    },
    MapAsset {
        id: "openfreemap",
        title: "OpenFreeMap",
        kind: AssetKind::VectorArchive,
        license: "ODbL (OSM) · styles BSD",
        homepage: "https://openfreemap.org/",
        xyz: Some("https://tiles.openfreemap.org/planet/20240101/{z}/{x}/{y}.pbf"),
        credit: "OpenFreeMap · OSM",
    },
    MapAsset {
        id: "protomaps",
        title: "Protomaps PMTiles",
        kind: AssetKind::VectorArchive,
        license: "ODbL (OSM extract)",
        homepage: "https://protomaps.com/",
        xyz: None,
        credit: "Protomaps · OSM",
    },
    MapAsset {
        id: "geofabrik",
        title: "Geofabrik OSM extracts",
        kind: AssetKind::VectorArchive,
        license: "ODbL",
        homepage: "https://download.geofabrik.de/",
        xyz: None,
        credit: "Geofabrik · OSM",
    },
    MapAsset {
        id: "usgs-topo",
        title: "USGS The National Map / US Topo",
        kind: AssetKind::Portal,
        license: "US government public domain",
        homepage: "https://www.usgs.gov/programs/national-geospatial-program/national-map",
        xyz: None,
        credit: "USGS",
    },
    MapAsset {
        id: "copernicus",
        title: "Copernicus Sentinel",
        kind: AssetKind::Portal,
        license: "Copernicus open access (with attribution)",
        homepage: "https://dataspace.copernicus.eu/",
        xyz: None,
        credit: "Copernicus Sentinel data",
    },
    MapAsset {
        id: "polyhaven-ground",
        title: "Poly Haven terrain PBR",
        kind: AssetKind::Texture,
        license: "CC0",
        homepage: "https://polyhaven.com/textures/terrain",
        xyz: None,
        credit: "Poly Haven (CC0)",
    },
    MapAsset {
        id: "ambientcg",
        title: "ambientCG PBR",
        kind: AssetKind::Texture,
        license: "CC0",
        homepage: "https://ambientcg.com/",
        xyz: None,
        credit: "ambientCG (CC0)",
    },
];

pub fn asset(id: &str) -> Option<&'static MapAsset> {
    CATALOG.iter().find(|a| a.id == id)
}

/// Slippy / WMTS URL. `{s}` rotates a/b/c from `x+y`. `{date}` is `2024-01-01` unless given.
pub fn xyz_url(template: &str, z: u8, x: u32, y: u32, date: Option<&str>) -> String {
    let subdomain = match (x + y) % 3 {
        0 => "a",
        1 => "b",
        _ => "c",
    };
    let day = date.unwrap_or("2024-01-01");
    template
        .replace("{s}", subdomain)
        .replace("{z}", &format!("{z}"))
        .replace("{x}", &format!("{x}"))
        .replace("{y}", &format!("{y}"))
        .replace("{date}", day)
}

pub fn xyz_for_basemap(basemap: Basemap, z: u8, x: u32, y: u32) -> Option<String> {
    let id = match basemap {
        Basemap::BlueMarble | Basemap::Satellite => "nasa-bluemarble",
        Basemap::Osm | Basemap::Streets => "osm",
        Basemap::Sentinel => "nasa-modis",
        Basemap::OpenTopo => "opentopo",
        Basemap::Night | Basemap::Plain => return None,
    };
    Some(xyz_url(asset(id)?.xyz?, z, x, y, None))
}

pub fn xyz_for_terrain(kind: TerrainKind, z: u8, x: u32, y: u32) -> Option<String> {
    match kind {
        TerrainKind::Terrarium => {
            Some(xyz_url(asset("terrarium")?.xyz?, z, x, y, None))
        }
        TerrainKind::Ellipsoid | TerrainKind::Heightmap | TerrainKind::QuantizedMesh => None,
    }
}

pub fn paid_host(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.contains("mapbox.com")
        || lower.contains("cesium.com")
        || lower.contains("arcgisonline.com")
        || lower.contains("tiles.mapbox")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_has_the_first_batch() {
        assert!(CATALOG.len() >= 12);
        assert!(asset("osm").is_some());
        assert!(asset("opentopo").is_some());
        assert!(asset("terrarium").is_some());
        assert!(asset("naturalearth").is_some());
        assert!(asset("openfreemap").is_some());
        assert!(asset("protomaps").is_some());
    }

    #[test]
    fn osm_and_terrarium_urls_are_free() {
        let osm = xyz_for_basemap(Basemap::Osm, 3, 2, 3).unwrap();
        assert!(osm.contains("tile.openstreetmap.org/3/2/3.png"));
        assert!(!paid_host(&osm));
        let topo = xyz_for_basemap(Basemap::OpenTopo, 4, 1, 2).unwrap();
        assert!(topo.contains("tile.opentopomap.org/4/1/2.png"));
        let dem = xyz_for_terrain(TerrainKind::Terrarium, 1, 0, 0).unwrap();
        assert!(dem.contains("elevation-tiles-prod/terrarium/1/0/0.png"));
        assert!(!paid_host(&dem));
    }

    #[test]
    fn refuses_paid_hosts() {
        assert!(paid_host("https://api.mapbox.com/v4/mapbox.satellite/1/0/0.png"));
        assert!(paid_host("https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer"));
        assert!(!paid_host("https://tile.openstreetmap.org/1/0/0.png"));
    }
}
