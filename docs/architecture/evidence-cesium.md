# Evidence Pack — `cesium globe engine cesium.js`

- **Schema:** v2.0
- **Intent:** search
- **Budget:** 2188 / 8000 tokens used (5812 remaining)
- **Grounding:** 78/147 symbols anchored (53%)
- **Hash:** `sha256:bcdb9a6365cc179b97424bc992ee58b04c39ac2eb3419492ce2a9673b51a0c02`

## `scripts/refresh_static_data.mjs`  _(source, confidence 1)_
_symbol-name match; exact token match; prefix match_

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

## `scripts/globe-re/emit_report.py`  _(source, confidence 0.56)_
_symbol-name match; exact token match; path match_

```
# module: Write docs/CESIUMMAP.md — the living rebuild plan. from future import annotations from pathlib import Path from engines import Engine from knowledge import GSALAYERS, MODULES, WGS84RADIIM, bypriority from policy import ALLOWEDTARGETS def render( , engine: Engine, mcpsummary: str, cesiuminv: dict | None, rustfiles: list[str], ) -> str: rows = [] for mod in bypriority(): rows.append( f"|
def render(*, engine: Engine, mcp_summary: str, cesium_inv: dict | None, rust_files: list[str]) → str
def write(path: Path, **kwargs) → Path
```

## `rust/crates/globe-native/src/engine/ellipsoid.rs`  _(source, confidence 0.56)_
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

## `scripts/globe-re/emit_rust.py`  _(source, confidence 0.5)_
_symbol-name match; exact token match; path match_

```
# module: Write compiling Rust engine stubs that match the Cesium module map. Existing globemath.rs / render.rs stay the live path. New files live under src/engine/ and can be filled in one Cesium type at a time.
def write_engine(crate_src: Path) → list[str]
```

## `rust/crates/globe-native/.github/context-src.md`  _(source, confidence 0.48)_
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

## `rust/crates/globe-native/src/engine/scene.rs`  _(source, confidence 0.45)_
_path match_

```
# module: ! Scene modes matching Cesium SceneMode.
pub enum SceneMode
impl SceneMode
```

## `rust/crates/globe-native/src/engine/primitives.rs`  _(source, confidence 0.44)_
_path match_

```
# module: ! GPU collections. Cesium Entities are the slow path; BillboardCollection ! / PointPrimitiveCollection are the fast path. Pins today are egui dots.
pub struct PointPrimitive
```

## `visualizer/public/cesium.js`  _(source, confidence 0.44)_
_symbol-name match; exact token match; path match_

```
function esc(value)
async function boot()
async function showDataMode()
function imageryProvider(id)
function labelProvider()
function applyBasemap()
function makeTerrariumTerrain()
function setTerrain(on)
async function startGlobe()
function renderSearches(catalog)
function fillCountries(list)
function hookUi()
async function startScan(id, country)
function connectEvents()
function applySnapshot(snap)
function clearPoints()
function ensureOrigin()
function arcPositions(lat, lon)
function upsertArc(result)
function upsertPoint(result)
function visibleResults()
function prependFeed(result)
function renderFeed()
function rowEl(result)
function focusResult(result)
```

## `globalstatus/cesium.js`  _(source, confidence 0.43)_
_symbol-name match; exact token match; path match_

```
function esc(value)
async function boot()
function phoneLayout()
function tuneQuality(basemapId)
async function imageryProvider(id)
async function applyBasemap(id)
async function applyTerrain(id)
function setSceneMode(mode)
function setViewOpen(open)
function setPanel(which)
async function startGlobe()
function renderSearches(catalog)
function fillUsTests(tests)
function syncUsTests()
function fillCountries(list)
function hookUi()
async function startScan(id, country)
function connectEvents()
function applySnapshot(snap)
function clearPoints()
function ensureOrigin()
function arcPositions(lat, lon)
function arcMaterial(color)
function upsertArc(result)
function upsertPoint(result)
```

## `rust/crates/globe-native/src/engine/quadtree.rs`  _(source, confidence 0.43)_
_path match_

```
# module: ! Globe surface quadtree. Cesium QuadtreeTile splits when projected ! geometric error exceeds a pixel budget. Not wired to the mesh yet.
pub struct QuadtreeTile
impl QuadtreeTile
pub fn root() → Self
```

## `scripts/globe-re/templates/frida_hooks.js`  _(source, confidence 0.43)_
_symbol-name match; exact token match; path match_

```
# module: Frida on a globe we own (downtime-globe). Never attach to Google Earth. frida -n downtime-globe -l scripts/globe-re/templates/fridahooks.js Answers what the process does: outbound sockets (tile CDNs, AIS, ADS-B).
function log(msg)  :9-11  # Frida on a globe we own (downtime-globe)
```

## `rust/crates/globe-native/src/engine/cartographic.rs`  _(source, confidence 0.43)_
_path match_

```
# module: ! Geodetic position. Cesium Cartographic is radians; we keep degrees at the ! UI edge and convert here.
pub struct Cartographic
impl Cartographic
pub fn new(lat_deg: f64, lon_deg: f64, height_m: f64) → Self
```

## `rust/crates/globe-native/src/engine/terrain.rs`  _(source, confidence 0.42)_
_path match_

```
# module: ! Terrain providers. Web Cesium still has Esri WorldElevation3D; native ! refuses it. Terrarium PNG (AWS Open Data) is the free height source.
pub enum TerrainKind
impl TerrainKind
pub fn label(self) → &'static str
```

## `scripts/globe-re/engines.py`  _(source, confidence 0.42)_
_symbol-name match; exact token match; path match_

```
# module: Analysis engines the LLM agent can drive, one tool call at a time. Pick order (2026): Ghidra — default, free, headless, GhidraMCP IDA Pro — paid, cleanest decompiler, official MCP on 9.4+ Binary Ninja — automation-first, headless on Commercial radare2 / Rizin — shell and scripts Hopper — macOS ObjC/Swift x64dbg — Windows debug Frida — live process (what the code does) jadx — Android Java/Kotlin
@dataclass Engine(id, title, cost, binaries, mcp, when, found?)
def present() → bool
def catalog() → list[Engine]
def pick(preference: str=...) → Engine
```

## `visualizer/.github/context-public.md`  _(source, confidence 0.42)_
_symbol-name match; exact token match_

```
h1 Code signatures
h2 SigMap commands
h2 public
h3 public/app.js
h3 public/cesium.css
h3 public/cesium.html
h3 public/cesium.js
h3 public/index.html
h3 public/styles.css
code-fence plain
```

## `scripts/globe-re/cesium_source.py`  _(source, confidence 0.4)_
_symbol-name match; exact token match; path match_

```
# module: Walk a CesiumGS/cesium checkout if the operator has one. Minified globalstatus/vendor/cesium/Cesium.js is the wrong tree: no symbols, no Source/ layout. Prefer a git clone of github.com/CesiumGS/cesium.
def locate(explicit: str | None, repo_root: Path) → Path | None
def inventory(source: Path, limit: int=...) → dict
def dump_json(payload: dict, dest: Path) → None
def extract_symbol(source: Path, name: str, max_chars: int=...) → dict  :74-95  # Pull one constructor / function from Source/ — the source-ma
def clone_sparse(dest: Path) → Path  :98-133  # Shallow-sparse clone of CesiumGS/cesium Source/ + LICENSE. N
```

