# Stack snapshot (between phases)

Generated with SigMap **v8.88.0** on `feat/rustle-leaves` (QuietEarth wasm + Rustle + Cesium leftover).

| Layer | Where | Engine / runtime |
| --- | --- | --- |
| QuietEarth web | `globalstatus-wasm/index.html`, `globe-native` wasm | eframe 0.32 / wgpu 25, WebGPU + WebGL2. Staging homepage. |
| Canvas HUD | `globalstatus-wasm/hud.html`, `globe.js` | Lightweight WebGL sphere; `/hud.html` |
| Cesium web globe | `globalstatus/cesium.js`, `router.php` | Live leftover. Vendored minified Cesium **not** indexed. |
| Visualizer | `visualizer/lib/*.mjs`, `server.mjs` | Node datapack / poller (being replaced by `downtime-server`) |
| Rust core | `rust/crates/downtime-core` | Catalog, blast, layers, geo. `no_std` + alloc |
| Rustle | `rust/crates/rustle` | Git-text leaves (Drupal analog) |
| Rust native I/O | `downtime-native`, `downtime-server`, `downtime-cli` | tokio multi-thread HTTP + probes |
| WebAssembly helpers | `rust/crates/downtime-wasm` | wasm-bindgen bridge (`blast_rings_json`, catalog, rustle json) |
| Native globe | `rust/crates/globe-native` | QuietEarth desktop + wasm `WebHandle` |

## This SigMap run

Full numbers: [COVERAGE.md](./COVERAGE.md). Wiki: [WIKI.md](./WIKI.md).

| Metric | Value |
| --- | --- |
| Files scanned | 126 |
| Symbols | 1,202 |
| Indexed files (wiki) | 131 · 7 modules |
| `--ci` coverage | 59% vs 80% target / 50% gate (markdown/docs pull it down) |
| Health | 100/100 A |
| Source-root coverage | 93% (86/92) |

```bash
scripts/gsa-cycle/sigmap.sh
```

