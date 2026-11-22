# Rust arsenal (Global Status)

Three ways to get PHP off the hot path. **We are not Drupal.** The globe is `router.php` + Node `visualizer/` + Python ingest. Product path is lane 3.

## Lanes

| Lane | Tools | Compatibility | Use here |
| --- | --- | --- | --- |
| 1. Rust hosts Zend | Rapira (RoadRunner), Pasir, RestPHP, FerrumPHP, `ext-php-rs` | Full PHP | **Bridge only** if GoDaddy still needs `router.php` until Lee says FTP. Do not build the product on this. |
| 2. PHP rewritten in Rust | php-rust (phprust.com), rphp, Phargo | High, experimental | **Research only.** WordPress-parity runtimes are slower than Zend today and are not a globe server. |
| 3. Pure Rust | tokio (already), Axum/Hyper later, wasm-bindgen, wgpu | Rewrite | **Default.** `downtime-server` is already Hyper-class: tokio multi-thread, no PHP-FPM. New APIs go here. Native globe is wgpu. Browser math is `downtime-wasm`. |

Laravel-inspired stacks (Larastvel), Daypress, Radical: not this app.

## Why not Rapira/Pasir as the destination

They keep the Zend engine and remove FPM. That helps Drupal. Our bottleneck is not FPM — it is **one PHP process doing curl + JSON on every `/api/outages` hit**, plus **Cesium entity loops on the main thread**, plus **Python XML ingest**. Hosting Zend in Tokio would still run 1754 lines of `router.php` on a single interpreter. Extract the routes into `downtime-server` instead.

Rapira stays in the kit as a **one-sprint fallback**: if production cannot move off PHP before a go-live, wrap `globalstatus/` with Rapira worker mode and keep `/api/*` that we have not ported. Then delete the wrap.

## Speed map (Rust-first replacements)

Hottest first. Network-bound work stays rate-limited even in Rust.

| Rank | Today | Cost | Rust-first | Cycle |
| --- | --- | --- | --- | --- |
| 1 | `globalstatus/router.php` (~1754 lines, curl per request) | Request latency, no threads | `downtime-server` tokio workers, static + JSON + `/api/blast` | 8, 13, 14 |
| 2 | Cesium JS `entities` for AIR/AIS/pins | Main-thread jank at 20k | `globe-native` GPU instances; wasm globe later | 10, 18 |
| 3 | `visualizer/server.mjs` + `lib/*.mjs` fetchers | Node event loop, duplicate of PHP | `DataLayer` impls in `downtime-core` / `downtime-native` | 13–16 |
| 4 | `poll-runner.php` / Node checker | One synthetic user, cache | Same model inside `downtime-server` (`Semaphore` already there) | 13 |
| 5 | `designations.py` UN XML + EU 26MB + UCDP zip | Single-thread parse | `quick-xml` + `rayon` pack in a `downtime-ingest` crate | 14 |
| 6 | `geocode_designations.py` | Nominatim 1.05s is the limit | Rust client + cache; **do not** go faster than 1 req/s | 14 |
| 7 | `downtime.py` CLI | Already ported | Keep `downtime-cli` as the CLI | done |
| 8 | `refresh_static_data.mjs` | Overlay copy | `downtime-server` or a tiny ingest bin | 14 |
| 9 | Offline RAG (brainstorm FTS5 + optional ONNX) | Python is fine for BM25 | `rusqlite` FTS5; ONNX Runtime only if the Pi needs it | 17 |
| 10 | Blast rings | Tiny | **Done:** `downtime-core::blast`, WASM export, `/api/blast` | 7–9 |

## Rules

- New endpoints: Rust. Do not add PHP routes.
- New math: `downtime-core` (no_std where it fits) + WASM bindgen. JS copies are fallbacks.
- New globe draws: wgpu. Cesium stays until native meets the succeed-Cesium bar.
- Do not vendor php-rust. Do not enable `nuke-sim`.
- Rapira/Pasir: document, do not depend, unless a cycle is blocked on GoDaddy PHP.
- Rate-limited feeds (Nominatim, ADS-B caps, one-user poller) stay capped. Rust removes CPU/JSON cost, not the courtesy delay.
