# Evidence Pack — `downtime-wasm wasm_bindgen blast`

- **Schema:** v2.0
- **Intent:** search
- **Budget:** 906 / 6000 tokens used (5094 remaining)
- **Grounding:** 10/76 symbols anchored (13%)
- **Hash:** `sha256:a6de59e7230535602f4ae82688c826a0d6c387fd15910bb518bf3d7c5269015c`

## `rust/crates/downtime-wasm/Cargo.toml`  _(config, confidence 1)_
_symbol-name match; exact token match; path match_

```
table [package]
table [lib]
table [dependencies]
key name
key edition.workspace
key version.workspace
key publish.workspace
key license.workspace
key authors.workspace
key repository.workspace
key homepage.workspace
key description
key path
key serde_json
key wasm-bindgen
```

## `rust/crates/downtime-wasm/src/lib.rs`  _(source, confidence 0.71)_
_symbol-name match; exact token match; path match_

```
# module: ! Catalog parsing and result aggregation for the browser. ! ! A page can fetch the .txt catalogs and pass them to [parsecatalog] / ! [places]. It can also fold a list of UP/DOWN rows with [aggregate]. ! ! What does not run here: ICMP and raw TCP. Browser sockets cannot send an ! echo request or open port 443 on an arbitrary host. Those probes stay in ! downtime and downtime-server. Point the
pub fn blast_rings_json(yield_kt: f64, airburst: u8) → String  :25-39  # First-party blast rings
pub fn blast_card_text(lat: f64, lon: f64, yield_kt: f64, airburst: u8) → String
pub fn blast_defcon_level(count: u32, max_kt: f64) → u8
pub fn runtime_note() → String
pub fn layer_catalog() → String
pub fn parse_catalog(files_json: &str) → Result<String, JsValue>  :92-96  # `files_json` is an object whose keys are catalog filenames (
pub fn places(files_json: &str, search_id: &str, country: &str) → Result<String, JsValue>  :100-111  # Places for one search
pub fn aggregate(results_json: &str) → Result<String, JsValue>  :116-154  # Group finished checks by country and state
pub fn classify_answers(host: &str, ping_ok: bool, ips_json: &str, open_json: &str,) → Result<String, JsValue>  :161-188  # Decide UP or DOWN from answers the page already has
```

## `rust/crates/downtime-core/src/blast.rs`  _(source, confidence 0.62)_
_symbol-name match; exact token match; path match_

```
# module: ! First-party nuclear blast rings for the Global Status globe. ! ! Cube-root scaling from public 1 kt airburst radii (Glasstone & Dolan ! order of magnitude). This is not NUKEMAP, not NukeSim, and not their code. ! Casualty counts are out of scope until a population layer exists.
pub struct BlastRings
pub struct Shot
pub fn rings(yield_kt: f64, airburst: bool) → BlastRings
pub fn defcon(shots: &[Shot]) → u8  :61-78  # DEFCON 5 (idle) through 1 (many or very large shots)
pub fn card(shot: Shot) → String
```

## `rust/crates/downtime-wasm/.github/context-src.md`  _(source, confidence 0.44)_
_path match_

```
h1 Code signatures
h2 SigMap commands
h2 dependencies (declared — cargo)
h2 src
h3 src/lib.rs
code-fence plain
```

## `rust/crates/downtime-wasm/.github/context-Cargo.toml.md`  _(source, confidence 0.44)_
_path match_

```
h1 Code signatures
h2 SigMap commands
h2 dependencies (declared — cargo)
h2 .
h3 Cargo.toml
code-fence plain
```

## `rust/crates/downtime-core/.github/context-src.md`  _(source, confidence 0.38)_
_symbol-name match; exact token match; path match_

```
h1 Code signatures
h2 SigMap commands
h2 dependencies (declared — cargo)
h2 src
h3 src/blast.rs
h3 src/catalog.rs
h3 src/check.rs
h3 src/geo.rs
h3 src/group.rs
h3 src/layer.rs
h3 src/model.rs
code-fence plain
```

## `scripts/gsa-cycle/sigmap.sh`  _(source, confidence 0.3)_
_symbol-name match; exact token match_

```
# module: Between-phase SigMap: WASM + Rust crates + Cesium globe. Does not commit .context/. Writes docs/architecture/WIKI.md.
# Between-phase SigMap: WASM + Rust crates + Cesium globe.
```

## `scripts/globe-re/templates/frida_hooks.js`  _(source, confidence 0.13)_
_symbol-name match; exact token match_

```
# module: Frida on a globe we own (downtime-globe). Never attach to Google Earth. frida -n downtime-globe -l scripts/globe-re/templates/fridahooks.js Answers what the process does: outbound sockets (tile CDNs, AIS, ADS-B).
function log(msg)  :9-11  # Frida on a globe we own (downtime-globe)
```

## `scripts/deploy-staging-fly.sh`  _(source, confidence 0.13)_
_symbol-name match; exact token match_

```
# module: Staging: Node Cesium globe on Fly (downtime-globe). Production is GoDaddy FTP (globalstatus.app). See scripts/ftpprod.py.
# Staging: Node Cesium globe on Fly (downtime-globe).
```

## `rust/crates/downtime-native/src/lookup.rs`  _(source, confidence 0.13)_
_path match_

```
# module: ! HTTPS GET against ipwho.is. Failure leaves the cache and capital fallback in place.
pub struct LookupError
pub async fn lookup_ipwho(ip: &str) → Option<GeoRecord>
```

## `rust/crates/downtime-server/.github/context-src.md`  _(source, confidence 0.12)_
_path match_

```
h1 Code signatures
h2 SigMap commands
h2 dependencies (declared — cargo)
h2 src
h3 src/lib.rs
code-fence plain
```

## `rust/crates/downtime-cli/.github/context-Cargo.toml.md`  _(source, confidence 0.12)_
_path match_

```
h1 Code signatures
h2 SigMap commands
h2 dependencies (declared — cargo)
h2 .
h3 Cargo.toml
code-fence plain
```

