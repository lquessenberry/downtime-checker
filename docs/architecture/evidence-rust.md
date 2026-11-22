# Evidence Pack — `globe-native wgpu rust ellipsoid map_assets`

- **Schema:** v2.0
- **Intent:** search
- **Budget:** 1938 / 8000 tokens used (6062 remaining)
- **Grounding:** 21/143 symbols anchored (15%)
- **Hash:** `sha256:733d047817a4e1264d7c0250d2035107b625af5f6433d7a8ad5600a2eb422572`

## `rust/crates/globe-native/src/engine/ellipsoid.rs`  _(source, confidence 1)_
_symbol-name match; exact token match; path match_
Related tests: `scripts/globe-re/tests/fixtures/mini-cesium/Source/Core/Ellipsoid.js`

```
# module: ! WGS84 ellipsoid matching published Cesium Ellipsoid.WGS84 radii. ! Radii are public geodetic constants (meters), not a copy of Ellipsoid.js. ! A later mechanical port of packages/core/Source/Ellipsoid.js stays Apache-2.0. ! ! Cesium ECEF: +X (0°N, 0°E), +Y (0°N, 90°E), +Z north pole. ! Native wgpu: +X (0°N, 0°E), +Y north pole, +Z (0°N, 90°W).
pub struct Ellipsoid
impl Ellipsoid
pub fn equatorial_radius_m(&self) → f64
pub fn polar_radius_m(&self) → f64
pub fn eccentricity_squared(&self) → f64  :28-28  # First eccentricity squared, `(a² − b²) / a²`
pub fn cartographic_to_ecef(&self, lat_deg: f64, lon_deg: f64, height_m: f64) → [f64  :35-35  # Cesium `cartographicToCartesian`
pub fn geodetic_surface_normal(lat_deg: f64, lon_deg: f64) → [f64  :51-51  # Geodetic surface normal in the **native** wgpu frame (Y nort
pub fn cartographic_to_native_unit(&self, lat_deg: f64, lon_deg: f64, height_m: f64) → [f64  :59-59  # ECEF meters → native unit vector (`[x, z, −y]`, then normali
```

## `rust/crates/globe-native/.github/context-src.md`  _(source, confidence 0.9)_
_symbol-name match; exact token match; path match_

```
h1 Code signatures
h2 SigMap commands
h2 dependencies (declared — cargo)
h2 src
h3 src/engine/cartographic.rs
h3 src/engine/ellipsoid.rs
h3 src/engine/geo_facts.rs
h3 src/engine/imagery.rs
h3 src/engine/map_assets.rs
h3 src/engine/primitives.rs
h3 src/engine/quadtree.rs
h3 src/engine/scene.rs
h3 src/engine/terrain.rs
h3 src/globe_math.rs
h3 src/globe.wgsl
h3 src/lib.rs
h3 src/pins.rs
h3 src/render.rs
code-fence plain
```

## `rust/crates/globe-native/src/engine/map_assets.rs`  _(source, confidence 0.79)_
_symbol-name match; exact token match; path match_

```
# module: ! Free map, DEM, and texture sources for the native globe. ! ! No Mapbox, Cesium ion, Esri, or Maxar. Tile bytes stay on disk under ! data/map-assets/ (gitignored). This module is the URL + license registry.
pub struct MapAsset  :11-19  # One catalog row
pub enum AssetKind
pub fn asset(id: &str) → Option<&'static MapAsset>
pub fn xyz_url(template: &str, z: u8, x: u32, y: u32, date: Option<&str>) → String  :447-460  # Slippy / WMTS URL
pub fn xyz_for_basemap(basemap: Basemap, z: u8, x: u32, y: u32) → Option<String>
pub fn xyz_for_terrain(kind: TerrainKind, z: u8, x: u32, y: u32) → Option<String>
pub fn paid_host(url: &str) → bool
```

## `rust/crates/globe-native/src/render.rs`  _(source, confidence 0.72)_
_symbol-name match; exact token match; path match_

```
# module: ! wgpu globe pass drawn inside egui through an eguiwgpu paint callback.
pub struct GlobeResources  :16-23  # GPU objects kept in egui's callback resources for the app's
pub struct GlobeCallback  :191-195  # One frame's globe draw
impl GlobeResources
pub fn install(state: &egui_wgpu::RenderState)
impl GlobeCallback
```

## `scripts/globe-assets/fetch.sh`  _(source, confidence 0.66)_
_symbol-name match; exact token match; path match_

```
# module: Pull small free map assets into data/map-assets/ (gitignored). Does not fetch planet PMTiles, Landsat, or LiDAR.
# Pull small free map assets into data/map-assets/ (gitignored).
function fetch()
```

## `rust/crates/globe-native/src/lib.rs`  _(source, confidence 0.5)_
_symbol-name match; exact token match; path match_

```
# module: ! Global Status native globe (alpha). ! ! A wgpu-rendered globe inside an eframe/egui window, with catalog pins ! taken from downtime-core. This crate is the product renderer: it has to ! succeed Cesium in every way (see docs/rust-native.md). NASA Blue Marble ! is on the sphere today; XYZ imagery, terrain, and live layers follow. ! ! The same code runs on Linux, macOS and Windows (main.rs) and on
impl GlobeApp
impl GlobeApp
pub fn run(data: pins::PinData, mut options: eframe::NativeOptions) → eframe::Result<()>  :41-55  # Open the globe window with already-loaded catalog data
pub fn desktop_options() → eframe::NativeOptions  :58-60  # Desktop defaults
```

## `rust/crates/globe-native/Cargo.toml`  _(config, confidence 0.46)_
_symbol-name match; exact token match; path match_

```
table [package]
table [lib]
table [[bin]]
table [features]
table [dependencies]
table [target.'cfg(not(target_os = "android"))'.dependencies]
table [target.'cfg(all(unix, not(target_os = "android"), not(target_os = "macos")))'.dependencies]
table [target.'cfg(target_os = "android")'.dependencies]
table [dev-dependencies]
table [package.metadata.android]
table [package.metadata.android.sdk]
table [package.metadata.android.application]
table [package.metadata.android.application.activity]
key name
key edition.workspace
key version.workspace
key publish.workspace
key license.workspace
key authors.workspace
key repository.workspace
key homepage.workspace
key rust-version.workspace
key description
key path
key wgpu
```

## `scripts/globe-re/__pycache__/emit_rust.cpython-314.pyc`  _(source, confidence 0.44)_
_symbol-name match; exact token match; path match_

```
fn public_types_construct() {
let _ = Cartographic::new(0.0, 0.0, 0.0);
let _ = Ellipsoid::WGS84;
let _ = Ellipsoid::WGS84.equatorial_radius_m();
let _ = Ellipsoid::WGS84.polar_radius_m();
let _ = Ellipsoid::geodetic_surface_normal(35.0, -95.0);
let _ = ImageryLayer::blue_marble();
let _ = Basemap::BlueMarble;
let _ = PointPrimitive { lat_deg: 0.0, lon_deg: 0.0, color: [255, 0, 0, 255] };
let _ = QuadtreeTile::root();
let _ = SceneMode::Scene3D;
let _ = TerrainKind::Ellipsoid;
let _ = WGS84_RADII_M;
pub fn equatorial_radius_m(&self) -> f64 {
pub fn polar_radius_m(&self) -> f64 {
```

## `rust/crates/globe-native/.github/context-Cargo.toml.md`  _(source, confidence 0.4)_
_symbol-name match; exact token match; path match_

```
h1 Code signatures
h2 SigMap commands
h2 dependencies (declared — cargo)
h2 .
h3 Cargo.toml
code-fence plain
```

## `scripts/globe-re/knowledge.py`  _(source, confidence 0.39)_
_path match_

```
# module: Cesium architecture as published under Apache-2.0. This is not a decompile of minified Cesium.js. It is the module map CesiumGS ships in Source/, translated into the Rust crates we have to build to succeed the web globe. Every row cites a Cesium type and a globe-native destination.
def by_priority() → list[dict]
```

## `scripts/refresh_static_data.mjs`  _(source, confidence 0.34)_
_symbol-name match; exact token match_

```
function expand(raw)
function listLen(data, key)
function copyIfGood(name)
scripts/globe-re/cesium_source.py             +locate  +inventory  +dump_json  +extract_symbol
scripts/globe-re/emit_report.py               +render  +NAME  +write
scripts/globe-re/emit_rust.py                 +write_engine
scripts/globe-re/engines.py                   +Engine  +present  +_which_any  +catalog
scripts/globe-re/globe_plan.py                +log  +sha256  +canonical_engine  +refuse_engine
scripts/globe-re/globe_re.py                  +at  +Ellipsoid  +_die  +cmd_engines
scripts/globe-re/knowledge.py                 +by_priority
scripts/globe-re/mcp_bridge.py                +McpCall  +Session  +record  +as_dict
scripts/globe-re/policy.py                    +refuse_reason
scripts/globe-re/surrounding.py               +SideTool  +present  +catalog
scripts/globe-re/templates/frida_hooks.js     +log
scripts/globe-re/tests/fixtures/mini-cesium/Source/Core/Cartesian3.js +Cartesian3
scripts/globe-re/tests/fixtures/mini-cesium/Source/Core/Ellipsoid.js +Ellipsoid
scripts/globe-re/tests/fixtures/mini-cesium/Source/DataSources/Entity.js +Entity
scripts/globe-re/tests/fixtures/mini-cesium/Source/Renderer/Context.js +Context
scripts/globe-re/tests/fixtures/mini-cesium/Source/Scene/Camera.js +Camera
scripts/globe-re/tests/fixtures/mini-cesium/Source/Scene/Globe.js +Globe
scripts/globe-re/tests/fixtures/mini-cesium/Source/Widgets/Viewer.js +Viewer
scripts/globe-re/tests/fixtures/mini-cesium/Source/Workers/createVerticesFromHeightmap.js +createVerticesFromHeightmap
scripts/globe-re/tests/test_globe_plan.py     +RefuseTests  +test_maplibre_allowed  +test_mapbox_refused  +test_osgearth_lgpl_refused
scripts/globe-re/tests/test_globe_re.py       +PolicyTests  +test_cesium_allowed  +test_maplibre_not_mapbox  +test_google_earth_refused
```

## `rust/crates/downtime-native/.github/context-Cargo.toml.md`  _(source, confidence 0.32)_
_symbol-name match; exact token match; path match_

```
h1 Code signatures
h2 SigMap commands
h2 dependencies (declared — cargo)
h2 .
h3 Cargo.toml
code-fence plain
```

## `rust/crates/downtime-native/.github/context-src.md`  _(source, confidence 0.31)_
_symbol-name match; exact token match; path match_

```
h1 Code signatures
h2 SigMap commands
h2 dependencies (declared — cargo)
h2 src
h3 src/catalog_io.rs
h3 src/check.rs
h3 src/lookup.rs
code-fence plain
```

## `rust/crates/globe-native/src/engine/scene.rs`  _(source, confidence 0.29)_
_path match_

```
# module: ! Scene modes matching Cesium SceneMode.
pub enum SceneMode
impl SceneMode
```

## `scripts/gsa-cycle/sigmap.sh`  _(source, confidence 0.29)_
_symbol-name match; exact token match_

```
# module: Between-phase SigMap: WASM + Rust crates + Cesium globe. Does not commit .context/. Writes docs/architecture/WIKI.md.
# Between-phase SigMap: WASM + Rust crates + Cesium globe.
```

## `rust/crates/globe-native/src/engine/primitives.rs`  _(source, confidence 0.29)_
_path match_

```
# module: ! GPU collections. Cesium Entities are the slow path; BillboardCollection ! / PointPrimitiveCollection are the fast path. Pins today are egui dots.
pub struct PointPrimitive
```

