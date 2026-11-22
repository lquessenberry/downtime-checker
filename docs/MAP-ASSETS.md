# Free map assets for the Rust globe

No Mapbox, Cesium ion, Esri, or Maxar. Registry: `rust/crates/globe-native/src/engine/map_assets.rs`. Bytes go in `data/map-assets/` (gitignored). Do not commit planet PMTiles, Landsat scenes, or LiDAR.

Fetch:

```bash
scripts/globe-assets/fetch.sh --ne110
```

Native HUD: Basemap combo (Blue Marble / OSM / OpenTopo / GIBS) and Terrain (ellipsoid / Terrarium). The sphere still draws compiled Blue Marble until the XYZ sampler lands; the combo records the free source we will sample.

## Batch 1 (this PR)

| Category | Source | License | How we use it |
| --- | --- | --- | --- |
| GPS / topo | OpenStreetMap raster | ODbL | Default streets XYZ |
| GPS / topo | OpenTopoMap | CC BY-SA + OSM + SRTM | Contour/hillshade XYZ |
| GPS / topo | Organic Maps, OsmAnd | open source apps | Not vendored; same OSM data |
| GPS / topo | USGS National Map, TopoView, PCL UT Austin | US / library public | Portal only; US Topo GeoPDF on demand |
| DEM | Mapzen Terrarium on AWS | Open Data | Height PNG, cycle 11 |
| DEM | OpenDEM, SRTM, NASADEM, ALOS, ETOPO1, MERIT | various open | Directory; Terrarium is the runtime |
| Sat | NASA GIBS Blue Marble + MODIS | public domain | XYZ / WMTS |
| Sat | USGS EarthExplorer, Earthdata, Landsat Collection 2 | US gov | Portal; no bulk in git |
| Sat | Copernicus Data Space | Copernicus open | Sentinel portal; EOX 2016 CC BY if we need a mosaic |
| Vector | OpenFreeMap, Protomaps PMTiles, OpenMapTiles, VersaTiles, Geofabrik | ODbL | Offline packs (cycle 18 / #16) |
| Vector | Natural Earth 110m / 50m / 10m | public domain | Coastlines (cycle 29) |
| PBR | Poly Haven, ambientCG, Texture Ninja, 3DTexel | CC0 | Ground albedo later; not required to spin the globe |
| Portals | GIS Geography, Free GIS Data, Blue Marble Geo directory | indexes | Bookmark file in this doc |

Organic Maps and OsmAnd are **viewers**, not tile hosts. We do not ship their APKs. We use the same OSM extracts they do (Geofabrik / OpenFreeMap).

## Next batches toward 100

**Batch 2 — nautical / aviation (free charts)**  
NOAA ENC + RNC, OpenSeaMap, FAA VFR sectional (US gov), OpenAIP, OurAirports, OpenRailwayMap.

**Batch 3 — country LiDAR / high-res DEM**  
USGS 3DEP, NOAA Digital Coast, OpenTopography, UK Environment Agency LiDAR, LINZ, NRCan HRDEM, EUCOP DEM.

**Batch 4 — more CC0 PBR / 3D**  
Poly Haven HDRIs, Kenney terrain, OpenGameArt height, NASA SVS stills, Cesium ion **rejected**.

**Batch 5 — offline desktop/mobile**  
QGIS + QuickMapServices (OSM/GIBS), Marble, `pmtiles` CLI, `tippecanoe`, ATAK with local MBTiles (no TAK server license).

## Batch 2 — orbital, bathymetry, borders, factoids

| Category | Source | Use |
| --- | --- | --- |
| Orbits | CelesTrak TLE/OMM | Offline tracks via `sgp4` crate later. Do not vendor Space-Track dumps. |
| Orbits | JPL Horizons / SPICE | Terminator, Moon, planets (`anise` / kernels in `data/map-assets/`) |
| Sky | Hipparcos / Yale BSC (VizieR) | Tiny star table for skybox |
| Night | NASA Black Marble GIBS | `Basemap::Night` XYZ |
| Bathymetry | GEBCO, GMRT | Ocean trenches; not in git |
| Mag / geoid | WMM `.COF`, EGM2008 | Spherical harmonics + orthometric height |
| Quakes | USGS GeoJSON feeds | Tectonic overlay |
| Borders | Natural Earth TZ, Who's On First, geoBoundaries | Point-in-polygon local time |
| Grids | Maidenhead (in `geo_facts.rs`), later `h3o` / S2 | No download |

Factoids in `engine/geo_facts.rs`: WGS84 bulge, Kármán vs ISS on a 10 cm globe, GEO Clarke belt, GPS MEO, Null Island, antipodes, SAA bbox.

Space-Track needs a free account and is **not** bulk-redistributable. CelesTrak is the default TLE source.

## Rust crates (not all added yet)

Tile/raster: `pmtiles`, `geotiff`, `flatgeobuf`, `geoparquet`.  
Geodesy: `proj4rs`, `geographiclib-rs`, `h3o`.  
Orbits: `sgp4`, `anise`, `vsop87`. Add a crate only when a cycle draws that layer.

## Batch 3 — nautical, more orbits, STAC/COG/PMTiles/GeoParquet

| id | What | Git |
| --- | --- | --- |
| openseamap, openrailwaymap | XYZ overlays | URLs only |
| ourairports, noaa-enc, faa-vfr | US/gov + PD airports/charts | portals |
| celestrak-gp-iss / gnss | Small TLE/JSON | `fetch.sh --iss-tle` |
| vsop87 | Planetary theory | portal / `anise` later |
| gebco-wms | Bathymetry WMS | **no grid in git** |
| earth-search | Sentinel COG via STAC | query, don't vendor scenes |
| overture-geoparquet | Buildings/places | download to cache |
| protomaps-builds, pmtiles-spec, stac-spec | Cloud-native formats | crates later |
| openaerialmap | CC BY scenes | portal |
| usgs-3dep, noaa-digital-coast, opentopography | LiDAR/DEM | portals |

```bash
scripts/globe-assets/fetch.sh --ne110 --wmm --tz --iss-tle
```

`--tz` copies the **UTC sample polygon** fixture, not Who's On First world. `--wmm` tries NOAA `.COF` mirrors into `data/map-assets/` (gitignored).

## Batch 4 — CC0 PBR / 3D (no Cesium ion)

| id | What | Git |
| --- | --- | --- |
| polyhaven-hdri / models / ground | CC0 HDRI, glTF, terrain albedo | URLs in `pbr-manifest.json` |
| kenney-terrain | CC0 kits | URL |
| opengameart-height | per-file CC | portal |
| nasa-svs, nasa-3d-resources | NASA stills / models | public |
| texture-ninja, 3dtexel-height | CC0 surfaces / 16-bit height | URL |
| cesium-ion-rejected | **do not use** | `paid_host()` also flags `ion.cesium.com` |

```bash
scripts/globe-assets/fetch.sh --pbr-manifest
```

Does not download 8K textures. Copilot is out of the review loop until 2026-12-01.

Open a new PR per batch. Each PR only adds registry rows + a fetch script target. Never a multi-GB blob.

## Paid hosts (RUCKUS fail)

`mapbox.com`, `cesium.com` ion, `arcgisonline.com`, Google Photorealistic 3D Tiles, Maxar. `paid_host()` in `map_assets.rs` flags them.
