# Rust native apps

The Cesium web app (`globalstatus/`, `visualizer/`) stays the web target.
Android, Linux, macOS and Windows get native Rust apps that share one core
with the server. Nothing under `globalstatus/`, `visualizer/` or the Python
CLI changes on this branch.

## Crate layout (`rust/`)

| Crate | What it does |
| --- | --- |
| `downtime-core` | Catalog parsing, the ping → TCP 443 → TCP 80 decision, geo, grouping, `DataLayer` registry. `no_std` + `alloc` capable. From PR #1. |
| `downtime-native` | tokio DNS/TCP probes, ICMP via `ping`, ipwho.is lookups, catalog files on disk. From PR #1. |
| `downtime-cli` | `downtime` binary, same menus and search ids as `downtime.py`. From PR #1. |
| `downtime-server` | SSE server with the same `/api/*` routes as `visualizer/server.mjs`. From PR #1. |
| `downtime-wasm` | Browser-side catalog parsing and aggregation (wasm-bindgen). From PR #1. |
| `globe-native` | **New.** `downtime-globe` binary: eframe/egui window, wgpu globe drawn through an `egui_wgpu` paint callback, capital pins and search counts from `downtime-core`. |

`globe-native` layout:

- `src/globe_math.rs`: lat/lon → unit sphere, UV sphere mesh, orbit camera, projection. Pure math, unit-tested headless.
- `src/globe.wgsl`: sphere shader (lighting, 15° graticule, equator).
- `src/render.rs`: wgpu pipeline and buffers stored in egui's callback resources.
- `src/pins.rs`: loads catalogs through `downtime-native::load_catalog_dir` and places capital pins with `downtime_core::capital`.
- `src/lib.rs`: app state, side panel, drag to rotate, scroll to zoom, hover/click pins; `android_main` for the APK.
- `src/main.rs`: desktop entry point (`--root`, `--summary`, `--version`).
- Catalogs are compiled in (`pins::EMBEDDED`) so the app runs without a data folder.

Releases: [RELEASING.md](RELEASING.md).

## Run

```bash
cd rust
cargo test --workspace
cargo run -p downtime-globe-native            # opens the window (needs a GPU or a software Vulkan/GL driver)
cargo run -p downtime-globe-native -- --summary   # headless: prints catalog counts
cargo run -p downtime-cli -- --root .. check weather
cargo run -p downtime-server -- --root ..
```

The workspace targets Rust 1.85+ (`rust-version`, resolver 3 picks compatible
dependency versions). `eframe` is pinned to 0.32 / `wgpu` 25 for that reason;
bump both together when the minimum Rust version moves.

## Phases

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Bring PR #1's workspace onto `feat/globalstatus-prod` without touching the web app; Rust CI; tune Cesium pins (Entities → primitive collections) | Workspace and CI on this branch; Cesium tuning not started |
| 1 | Renderer bake-off: same scene (20k aircraft, 20k ships, 10k pins, GIBS imagery, Terrarium terrain) in the wgpu globe, Bevy + big_space, tuned CesiumJS, MapLibre GL + deck.gl; measure on a low-end Android phone and a laptop | Skeleton globe started |
| 2 | Core owns the data: port `visualizer/lib/*.mjs` feeds and `router.php` layers to `DataLayer` impls; datapack (pack → cache → network, `OFFLINE=1`); SQLite history | Not started |
| 3 | Desktop apps: imagery tiles, heightmap terrain, instanced aircraft/ship layers, scheduled checks, notifications, signed installers; Rust API replaces Node on Fly staging | Not started |
| 4 | Android offline (#16): same binary via `android-activity` (cargo-apk today), PMTiles + DEM offline, GPS, WorkManager and BLE mesh shim (#17) | Globe + pins APK builds (`android_main` in `globe-native`); offline, GPS and mesh not started |
| 5 | Optional WebGPU/WebGL2 build of the Rust globe, Meshtastic sitrep, Raspberry Pi image, `no_std` core on a microcontroller | Not started |

## Known gaps

- The globe is a shaded sphere with a graticule; no imagery, terrain or coastlines yet.
- Pins are drawn by egui on the CPU; phase 3 moves them to instanced GPU draws.
- Only reachability runs in the Rust core; every other layer is a stub.
- Windows ICMP still spawns `ping`; phase 2 switches to `IcmpSendEcho2`.
