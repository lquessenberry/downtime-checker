# Rust native apps

The native wgpu globe is the product renderer. **It has to succeed Cesium in every way** — look, layers, feel, and then go past it (count, offline, phones, no JavaScript main thread).

The Cesium tree (`globalstatus/`, `visualizer/`) stays the live web globe until native matches it. After that, the web target is the same Rust globe (WebGPU / WebGL2), not a second Cesium app.

## Succeed-Cesium bar

Native wins when a visitor (or a phone) can do everything the Cesium globe does, at least as well, without opening a browser.

| Cesium today | Native must |
| --- | --- |
| Street / satellite / Sentinel / Blue Marble / night / OSM / plain | Same basemaps, switchable. Blue Marble is on the sphere now; free XYZ registry in `engine/map_assets.rs` (OSM, OpenTopo, GIBS). |
| Esri terrain | **Refused.** Mapzen Terrarium / SRTM. See `docs/MAP-ASSETS.md`. |
| 3D / 2D / Columbus | Orbit globe plus a flat map that does not tear on Android |
| Power outages, AIR, JAM, AIS, mesh, disease, animal, scanners, AM/FM, hunger, conflict | Real `DataLayer` impls, same sources and credits |
| Country grid + spiderweb | 15-minute saved pass, replayed as arcs from Jonesboro |
| One-user poller (#34) | Same model in-process: one runner, cache, browsers/windows only read |
| Phone footer dots, MENU names, PWA | Native chrome that matches; Android APK is the install |
| Keep CesiumJS 1.134 for the web until this bar is met | Then drop Cesium from production |

Exceed Cesium (the reason we left it):

- 20k aircraft + 20k ships + 10k pins at 60 fps on a laptop and a low-end Android
- Offline packs (PMTiles, DEM, catalogs) with `OFFLINE=1`
- GPU instancing instead of JS entities
- Signed desktop installers and F-Droid
- Optional private nuke-sim behind a feature flag that release builds never enable

## Crate layout (`rust/`)

| Crate | What it does |
| --- | --- |
| `downtime-core` | Catalog parsing, ping → TCP 443 → TCP 80, geo, grouping, `DataLayer` registry. `no_std` + `alloc`. |
| `downtime-native` | tokio DNS/TCP probes, ICMP via `ping`, ipwho.is, catalog files on disk. |
| `downtime-cli` | `downtime` binary, same menus as `downtime.py`. |
| `downtime-server` | SSE `/api/*` compatible with the Node visualizer. Becomes the one-user poller. Tokio multi-thread; this is the PHP replacement (not Rapira). |
| `downtime-wasm` | Browser catalog parsing (wasm-bindgen). Bridge until the globe itself is wasm. |
| `globe-native` | **QuietEarth** (`downtime-globe`): eframe/egui + wgpu Earth, Blue Marble + OSM/GIBS stitch, Rustle leaves, capital pins. |

`globe-native` layout:

- `src/globe_math.rs`: lat/lon → unit sphere, UV sphere mesh, orbit camera. Headless tests.
- `src/globe.wgsl`: Earth albedo + lighting + optional 15° graticule.
- `src/render.rs`: wgpu pipeline, Blue Marble texture (`assets/earth.jpg`).
- `src/engine/`: Cesium-shaped rebuild (WGS84 ellipsoid, cartographic, imagery, quadtree, terrain, primitives, scene). Live draw path is still `render.rs`.
- `src/pins.rs`: catalogs through `downtime-native::load_catalog_dir`, capitals via `downtime_core::capital`.
- `src/lib.rs`: chrome, drag/zoom, hover/click pins; `android_main` for the APK.
- `src/main.rs`: `--root`, `--summary`, `--version`.
- Catalogs and Earth texture are compiled in so the app runs with no data folder.

Cesium → Rust map: [CESIUM_MAP.md](CESIUM_MAP.md) and the inventory in [globe-plan/RUST_PLAN.md](globe-plan/RUST_PLAN.md). CLI: `python3 scripts/globe-re/globe_plan.py`. Apache-2.0 Cesium `Source/` only. Mapbox GL JS is refused. A `Core/` port is a derivative work; `NOTICE-CESIUM` stays at the repo root (Apache-2.0 §4(d)). Binary RE adapters are unimplemented.

Releases: [RELEASING.md](RELEASING.md). PHP→Rust lanes and the speed map: [RUST-ARSENAL.md](RUST-ARSENAL.md). No paid licenses: [NO-PAID-LICENSES.md](NO-PAID-LICENSES.md).

## Run

```bash
cd rust
cargo test --workspace
cargo run -p downtime-globe-native            # window (GPU or software Vulkan/GL)
cargo run -p downtime-globe-native -- --summary
cargo run -p downtime-cli -- --root .. check weather
cargo run -p downtime-server -- --root ..
```

Workspace targets Rust 1.85+ (`eframe` 0.32 / `wgpu` 25). Bump both together.

Between phases: `scripts/gsa-cycle/sigmap.sh` (WASM + Rust + Cesium). Wiki: `docs/architecture/WIKI.md`.

## Phases

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | PR #1 workspace on `feat/globalstatus-prod`; Rust CI; Cesium pin tuning | Workspace and CI done; Cesium tuning skipped (native is the renderer) |
| 1 | Earth on the sphere; renderer bake-off vs Cesium (20k air/ships, GIBS, Terrarium) on a phone and a laptop | QuietEarth: Blue Marble + desktop OSM/OpenTopo/GIBS stitch. Terrain / instancing not started |
| 2 | Core owns the data: port `visualizer/lib/*.mjs` and `router.php` into `DataLayer`; datapack pack → cache → network; one-user poller | Layer names match Cesium. Feeds still stubs |
| 3 | Desktop: XYZ imagery, heightmap, instanced AIR/AIS, 15-minute grid + spiderweb, notifications, signed installers; Rust API replaces Node on Fly | Not started |
| 4 | Android offline (#16): PMTiles + DEM, GPS, WorkManager, BLE mesh (#17) | Globe + pins APK builds; offline/GPS/mesh not started |
| 5 | WebGPU/WebGL2 build of this globe replaces Cesium in production; Meshtastic sitrep; Pi image; `no_std` core | Not started |

## Known gaps vs Cesium

- Desktop OSM/OpenTopo/GIBS stitch at z=2 onto Blue Marble; not a live quadtree yet. Android still baked JPEG.
- No terrain, coastlines as geometry, or 2D mode.
- Pins are CPU egui dots; phase 3 moves them to GPU instances.
- Only reachability runs in the core; every other Cesium layer is a named stub.
- No spiderweb, no live poller in the native process yet.
- Windows ICMP still spawns `ping`.
