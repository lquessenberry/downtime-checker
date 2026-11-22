# Stack snapshot (between phases)

Generated with SigMap **v8.85.1** on the `feat/map-assets-batch3` tree (Rust native + WASM + Cesium web globe).

| Layer | Where | Engine / runtime |
| --- | --- | --- |
| Cesium web globe | `globalstatus/cesium.js`, `router.php` | CesiumJS **1.128** was what live `cesium.com` served; docs pin **1.134** until native succeeds. Vendored minified `globalstatus/vendor/cesium` is **not** indexed (no symbols). Apache-2.0 `Source/` only for RE. |
| Visualizer | `visualizer/lib/*.mjs`, `server.mjs` | Node datapack / poller (being replaced by `downtime-server`) |
| Rust core | `rust/crates/downtime-core` | Catalog, blast, layers, geo. `no_std` + alloc |
| Rust native I/O | `downtime-native`, `downtime-server`, `downtime-cli` | tokio multi-thread HTTP + probes |
| WebAssembly | `rust/crates/downtime-wasm` | wasm-bindgen bridge (`blast_rings_json`, catalog) |
| Native globe | `rust/crates/globe-native` | eframe 0.32 / wgpu 25, WGS84 ellipsoid, map_assets |

## This SigMap run

| Metric | Value |
| --- | --- |
| Files scanned | 112 |
| Files with symbols | 112 (100% of scanned) |
| Symbols | 980 |
| Indexed files (wiki) | 117 |
| Modules | rust 43 · scripts 29 · visualizer 21 · globalstatus 6 · docs 13 |
| Token reduction | 219,013 → 409 (~100% in overview) |
| `--ci` coverage | 56% vs 80% target (markdown/docs pull it down; not a product fail) |

Regenerate between phase bands and after each map-asset batch:

```bash
scripts/gsa-cycle/sigmap.sh
```
