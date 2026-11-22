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
    Orbital,
    Celestial,
    Bathymetry,
    Geophysical,
    Boundaries,
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
    MapAsset {
        id: "celestrak-tle",
        title: "CelesTrak TLE / OMM",
        kind: AssetKind::Orbital,
        license: "CelesTrak terms (free catalog)",
        homepage: "https://celestrak.org/NORAD/elements/",
        xyz: None,
        credit: "CelesTrak",
    },
    MapAsset {
        id: "space-track",
        title: "Space-Track.org USSF catalog",
        kind: AssetKind::Orbital,
        license: "free account; not bulk-redistributable",
        homepage: "https://www.space-track.org/",
        xyz: None,
        credit: "18 SDS / Space-Track",
    },
    MapAsset {
        id: "jpl-horizons",
        title: "NASA JPL Horizons / SPICE",
        kind: AssetKind::Orbital,
        license: "public domain (NASA/JPL)",
        homepage: "https://ssd.jpl.nasa.gov/horizons/",
        xyz: None,
        credit: "NASA JPL",
    },
    MapAsset {
        id: "hipparcos",
        title: "Hipparcos / Yale Bright Star (VizieR)",
        kind: AssetKind::Celestial,
        license: "public catalogs (ESA / Yale)",
        homepage: "https://vizier.cds.unistra.fr/",
        xyz: None,
        credit: "ESA Hipparcos · Yale BSC · CDS",
    },
    MapAsset {
        id: "black-marble",
        title: "NASA Black Marble night lights",
        kind: AssetKind::Satellite,
        license: "public domain (NASA)",
        homepage: "https://blackmarble.gsfc.nasa.gov/",
        xyz: Some(
            "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/{date}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png",
        ),
        credit: "NASA Black Marble / GIBS",
    },
    MapAsset {
        id: "gebco",
        title: "GEBCO bathymetry",
        kind: AssetKind::Bathymetry,
        license: "GEBCO (attribution)",
        homepage: "https://www.gebco.net/",
        xyz: None,
        credit: "GEBCO",
    },
    MapAsset {
        id: "gmrt",
        title: "GMRT multibeam topography",
        kind: AssetKind::Bathymetry,
        license: "GMRT data use terms",
        homepage: "https://www.gmrt.org/",
        xyz: None,
        credit: "GMRT / LDEO",
    },
    MapAsset {
        id: "wmm",
        title: "NOAA World Magnetic Model",
        kind: AssetKind::Geophysical,
        license: "US government public domain",
        homepage: "https://www.ncei.noaa.gov/products/world-magnetic-model",
        xyz: None,
        credit: "NOAA NCEI WMM",
    },
    MapAsset {
        id: "egm2008",
        title: "EGM2008 geoid (NGA / PROJ)",
        kind: AssetKind::Geophysical,
        license: "NGA public",
        homepage: "https://earth-info.nga.mil/",
        xyz: None,
        credit: "NGA EGM2008",
    },
    MapAsset {
        id: "usgs-earthquakes",
        title: "USGS earthquake / volcano archives",
        kind: AssetKind::Geophysical,
        license: "US government public domain",
        homepage: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php",
        xyz: None,
        credit: "USGS",
    },
    MapAsset {
        id: "ne-timezones",
        title: "Natural Earth timezones",
        kind: AssetKind::Boundaries,
        license: "public domain",
        homepage: "https://www.naturalearthdata.com/downloads/10m-cultural-vectors/timezones/",
        xyz: None,
        credit: "Natural Earth",
    },
    MapAsset {
        id: "whosonfirst-tz",
        title: "Who's On First timezone boundaries",
        kind: AssetKind::Boundaries,
        license: "CC0 / CC-BY (per file)",
        homepage: "https://github.com/whosonfirst-data/whosonfirst-data-timezone",
        xyz: None,
        credit: "Who's On First",
    },
    MapAsset {
        id: "geoboundaries",
        title: "geoBoundaries ADM0–ADM4",
        kind: AssetKind::Boundaries,
        license: "CC BY 4.0",
        homepage: "https://www.geoboundaries.org/",
        xyz: None,
        credit: "geoBoundaries",
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
        Basemap::Night => "black-marble",
        Basemap::Plain => return None,
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
        assert!(asset("celestrak-tle").is_some());
        assert!(asset("gebco").is_some());
        assert!(asset("wmm").is_some());
        assert!(asset("geoboundaries").is_some());
        assert!(asset("black-marble").is_some());
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
