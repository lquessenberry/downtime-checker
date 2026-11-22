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
    OfflineTool,
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
    MapAsset {
        id: "openseamap",
        title: "OpenSeaMap seamarks",
        kind: AssetKind::Basemap,
        license: "ODbL",
        homepage: "https://www.openseamap.org/",
        xyz: Some("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"),
        credit: "OpenSeaMap · OSM",
    },
    MapAsset {
        id: "openrailwaymap",
        title: "OpenRailwayMap",
        kind: AssetKind::Basemap,
        license: "ODbL",
        homepage: "https://www.openrailwaymap.org/",
        xyz: Some("https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png"),
        credit: "OpenRailwayMap · OSM",
    },
    MapAsset {
        id: "ourairports",
        title: "OurAirports",
        kind: AssetKind::Portal,
        license: "public domain dedication",
        homepage: "https://ourairports.com/data/",
        xyz: None,
        credit: "OurAirports",
    },
    MapAsset {
        id: "noaa-enc",
        title: "NOAA ENC electronic charts",
        kind: AssetKind::Portal,
        license: "US government public domain",
        homepage: "https://www.charts.noaa.gov/ENCs/ENCs.shtml",
        xyz: None,
        credit: "NOAA OCS",
    },
    MapAsset {
        id: "faa-vfr",
        title: "FAA VFR sectional charts",
        kind: AssetKind::Portal,
        license: "US government public domain",
        homepage: "https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/vfr/",
        xyz: None,
        credit: "FAA",
    },
    MapAsset {
        id: "celestrak-gp-iss",
        title: "CelesTrak GP ISS",
        kind: AssetKind::Orbital,
        license: "CelesTrak terms",
        homepage: "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle",
        xyz: None,
        credit: "CelesTrak",
    },
    MapAsset {
        id: "celestrak-gnss",
        title: "CelesTrak GP GNSS",
        kind: AssetKind::Orbital,
        license: "CelesTrak terms",
        homepage: "https://celestrak.org/NORAD/elements/gp.php?GROUP=gnss&FORMAT=json",
        xyz: None,
        credit: "CelesTrak",
    },
    MapAsset {
        id: "vsop87",
        title: "VSOP87 planetary theory",
        kind: AssetKind::Celestial,
        license: "public scientific data",
        homepage: "ftp://ftp.imcce.fr/pub/ephem/planets/vsop87/",
        xyz: None,
        credit: "IMCCE VSOP87",
    },
    MapAsset {
        id: "gebco-wms",
        title: "GEBCO WMS / COG portal",
        kind: AssetKind::Bathymetry,
        license: "GEBCO attribution",
        homepage: "https://www.gebco.net/data_and_products/gebco_web_services/web_map_service/",
        xyz: None,
        credit: "GEBCO",
    },
    MapAsset {
        id: "earth-search",
        title: "Element84 Earth Search STAC (Sentinel COG)",
        kind: AssetKind::Portal,
        license: "Sentinel open + AWS Open Data",
        homepage: "https://earth-search.aws.element84.com/v1",
        xyz: None,
        credit: "Element84 Earth Search · Copernicus",
    },
    MapAsset {
        id: "overture-geoparquet",
        title: "Overture Maps GeoParquet",
        kind: AssetKind::VectorArchive,
        license: "ODbL / CDLA per theme",
        homepage: "https://overturemaps.org/download/",
        xyz: None,
        credit: "Overture Maps Foundation",
    },
    MapAsset {
        id: "protomaps-builds",
        title: "Protomaps daily PMTiles builds",
        kind: AssetKind::VectorArchive,
        license: "ODbL",
        homepage: "https://docs.protomaps.com/basemaps/downloads",
        xyz: None,
        credit: "Protomaps · OSM",
    },
    MapAsset {
        id: "stac-spec",
        title: "STAC / COG cloud-native raster",
        kind: AssetKind::Portal,
        license: "Apache-2.0 spec",
        homepage: "https://stacspec.org/",
        xyz: None,
        credit: "STAC",
    },
    MapAsset {
        id: "pmtiles-spec",
        title: "PMTiles spec + crate",
        kind: AssetKind::Portal,
        license: "BSD (spec/impl)",
        homepage: "https://docs.protomaps.com/pmtiles/",
        xyz: None,
        credit: "Protomaps PMTiles",
    },
    MapAsset {
        id: "openaerialmap",
        title: "OpenAerialMap",
        kind: AssetKind::Satellite,
        license: "CC BY / public per scene",
        homepage: "https://map.openaerialmap.org/",
        xyz: None,
        credit: "OpenAerialMap",
    },
    MapAsset {
        id: "usgs-3dep",
        title: "USGS 3DEP lidar / DEM",
        kind: AssetKind::Dem,
        license: "US government public domain",
        homepage: "https://www.usgs.gov/3d-elevation-program",
        xyz: None,
        credit: "USGS 3DEP",
    },
    MapAsset {
        id: "noaa-digital-coast",
        title: "NOAA Digital Coast lidar",
        kind: AssetKind::Dem,
        license: "US government public domain",
        homepage: "https://coast.noaa.gov/dataviewer/",
        xyz: None,
        credit: "NOAA Digital Coast",
    },
    MapAsset {
        id: "opentopography",
        title: "OpenTopography",
        kind: AssetKind::Dem,
        license: "per dataset (mostly open)",
        homepage: "https://portal.opentopography.org/dataCatalog",
        xyz: None,
        credit: "OpenTopography",
    },
    MapAsset {
        id: "polyhaven-hdri",
        title: "Poly Haven HDRIs",
        kind: AssetKind::Texture,
        license: "CC0",
        homepage: "https://polyhaven.com/hdris",
        xyz: None,
        credit: "Poly Haven (CC0)",
    },
    MapAsset {
        id: "kenney-terrain",
        title: "Kenney terrain / nature kits",
        kind: AssetKind::Texture,
        license: "CC0",
        homepage: "https://kenney.nl/assets",
        xyz: None,
        credit: "Kenney (CC0)",
    },
    MapAsset {
        id: "opengameart-height",
        title: "OpenGameArt height / terrain",
        kind: AssetKind::Texture,
        license: "CC0 / CC-BY per file",
        homepage: "https://opengameart.org/",
        xyz: None,
        credit: "OpenGameArt authors",
    },
    MapAsset {
        id: "nasa-svs",
        title: "NASA SVS stills / animations",
        kind: AssetKind::Satellite,
        license: "public domain (NASA)",
        homepage: "https://svs.gsfc.nasa.gov/",
        xyz: None,
        credit: "NASA SVS",
    },
    MapAsset {
        id: "texture-ninja",
        title: "Texture Ninja CC0 surfaces",
        kind: AssetKind::Texture,
        license: "CC0",
        homepage: "https://texture.ninja/",
        xyz: None,
        credit: "Texture Ninja (CC0)",
    },
    MapAsset {
        id: "3dtexel-height",
        title: "3DTexel landscape heightmaps",
        kind: AssetKind::Dem,
        license: "CC0",
        homepage: "https://3dtexel.com/",
        xyz: None,
        credit: "3DTexel (CC0)",
    },
    MapAsset {
        id: "polyhaven-models",
        title: "Poly Haven CC0 3D models",
        kind: AssetKind::Texture,
        license: "CC0",
        homepage: "https://polyhaven.com/models",
        xyz: None,
        credit: "Poly Haven (CC0)",
    },
    MapAsset {
        id: "nasa-3d-resources",
        title: "NASA 3D resources",
        kind: AssetKind::Portal,
        license: "NASA media (public unless noted)",
        homepage: "https://nasa3d.arc.nasa.gov/",
        xyz: None,
        credit: "NASA",
    },
    MapAsset {
        id: "cesium-ion-rejected",
        title: "Cesium ion 3D Tiles (rejected)",
        kind: AssetKind::Portal,
        license: "paid / ion token — do not use",
        homepage: "https://cesium.com/ion/",
        xyz: None,
        credit: "REJECTED — no ion",
    },
    MapAsset {
        id: "qgis",
        title: "QGIS desktop GIS",
        kind: AssetKind::OfflineTool,
        license: "GPL-2.0-or-later",
        homepage: "https://qgis.org/",
        xyz: None,
        credit: "QGIS.org",
    },
    MapAsset {
        id: "qgis-quickmapservices",
        title: "QGIS QuickMapServices (OSM/GIBS)",
        kind: AssetKind::OfflineTool,
        license: "GPL-2.0-or-later",
        homepage: "https://plugins.qgis.org/plugins/quick_map_services/",
        xyz: None,
        credit: "NextGIS QuickMapServices",
    },
    MapAsset {
        id: "kde-marble",
        title: "KDE Marble virtual globe",
        kind: AssetKind::OfflineTool,
        license: "LGPL-2.1-or-later",
        homepage: "https://marble.kde.org/",
        xyz: None,
        credit: "KDE Marble",
    },
    MapAsset {
        id: "pmtiles-cli",
        title: "protomaps go-pmtiles CLI",
        kind: AssetKind::OfflineTool,
        license: "BSD-3-Clause",
        homepage: "https://github.com/protomaps/go-pmtiles",
        xyz: None,
        credit: "Protomaps",
    },
    MapAsset {
        id: "tippecanoe",
        title: "tippecanoe (Felt) vector tiles",
        kind: AssetKind::OfflineTool,
        license: "BSD-2-Clause",
        homepage: "https://github.com/felt/tippecanoe",
        xyz: None,
        credit: "Felt / Mapbox tippecanoe",
    },
    MapAsset {
        id: "mbtiles-spec",
        title: "MBTiles spec",
        kind: AssetKind::Portal,
        license: "CC0 (spec)",
        homepage: "https://github.com/mapbox/mbtiles-spec",
        xyz: None,
        credit: "MBTiles spec",
    },
    MapAsset {
        id: "gdal",
        title: "GDAL/OGR",
        kind: AssetKind::OfflineTool,
        license: "MIT (X/MIT)",
        homepage: "https://gdal.org/",
        xyz: None,
        credit: "OSGeo GDAL",
    },
    MapAsset {
        id: "atak-civ",
        title: "ATAK-CIV local MBTiles (no TAK server)",
        kind: AssetKind::OfflineTool,
        license: "ATAK-CIV (DoD OSS); local tiles only",
        homepage: "https://github.com/deptofdefense/AndroidTacticalAssaultKit-CIV",
        xyz: None,
        credit: "ATAK-CIV",
    },
    MapAsset {
        id: "tak-server-rejected",
        title: "TAK Server (rejected as required)",
        kind: AssetKind::Portal,
        license: "paid / TAK Server license — do not require",
        homepage: "https://tak.gov/",
        xyz: None,
        credit: "REJECTED — no TAK Server",
    },
    MapAsset {
        id: "organic-maps",
        title: "Organic Maps (viewer, not vendored)",
        kind: AssetKind::OfflineTool,
        license: "Apache-2.0",
        homepage: "https://organicmaps.app/",
        xyz: None,
        credit: "Organic Maps · OSM",
    },
    MapAsset {
        id: "osmand",
        title: "OsmAnd (viewer, not vendored)",
        kind: AssetKind::OfflineTool,
        license: "GPL-3.0-or-later",
        homepage: "https://osmand.net/",
        xyz: None,
        credit: "OsmAnd · OSM",
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
        || lower.contains("ion.cesium.com")
        || lower.contains("photorealistic")
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
        assert!(asset("openseamap").is_some());
        assert!(asset("earth-search").is_some());
        assert!(asset("overture-geoparquet").is_some());
        assert!(asset("protomaps-builds").is_some());
        assert!(asset("celestrak-gp-iss").is_some());
        assert!(CATALOG.len() >= 50);
        assert!(asset("polyhaven-hdri").is_some());
        assert!(asset("kenney-terrain").is_some());
        assert!(asset("nasa-svs").is_some());
        assert!(asset("cesium-ion-rejected").unwrap().license.contains("do not use"));
        assert!(CATALOG.len() >= 60);
        assert!(asset("qgis").is_some());
        assert!(asset("qgis-quickmapservices").is_some());
        assert!(asset("kde-marble").is_some());
        assert!(asset("pmtiles-cli").is_some());
        assert!(asset("tippecanoe").is_some());
        assert!(asset("atak-civ").is_some());
        assert!(asset("tak-server-rejected")
            .unwrap()
            .license
            .contains("do not require"));
        assert_eq!(asset("qgis").unwrap().kind, AssetKind::OfflineTool);
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
    fn openseamap_xyz_is_free() {
        let url = xyz_url(asset("openseamap").unwrap().xyz.unwrap(), 6, 32, 21, None);
        assert!(url.contains("tiles.openseamap.org/seamark/6/32/21.png"));
        assert!(!paid_host(&url));
    }

    #[test]
    fn utc_timezone_fixture_is_tiny() {
        let raw = include_str!("fixtures/timezone-utc-sample.geojson");
        assert!(raw.contains("Etc/UTC"));
        assert!(raw.len() < 1024);
    }

    #[test]
    fn refuses_paid_hosts() {
        assert!(paid_host("https://api.mapbox.com/v4/mapbox.satellite/1/0/0.png"));
        assert!(paid_host("https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer"));
        assert!(paid_host("https://api.ion.cesium.com/v1/assets"));
        assert!(paid_host("https://tile.googleapis.com/v1/3dtiles/photorealistic"));
        assert!(!paid_host("https://tile.openstreetmap.org/1/0/0.png"));
        assert!(paid_host(asset("cesium-ion-rejected").unwrap().homepage));
    }
}
