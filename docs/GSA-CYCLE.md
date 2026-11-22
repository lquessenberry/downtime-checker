# Morning cycle (GLOBALSTATUS × RUCKUS)

Cycles **1–6** shipped the designation/claims board. Cycles **7–18** are the next twelve. Does not FTP. Does not merge `feat/globalstatus-prod` until tests are green.

| Role | Job |
| --- | --- |
| GLOBALSTATUS | Product owner: layers, pins, in-globe NUCLEAR, staging |
| RUCKUS | Reviewer: tests, **no paid licenses**, no auto-merge, no SPLC dump in git |

## GitHub Actions

`.github/workflows/gsa-morning-cycle.yml` fires `20 12-17 * * 1-5` (six weekday morning hours, UTC) **once the file exists on the default branch** (`feat/globalstatus-prod`). Each run tests designations when present, PHP, and `cesium.js`, then comments the tracking issue. Pull requests that touch globe or cycle paths also run it.

Set repository variable `GSA_CYCLE_ISSUE` to the tracking issue number.

Laptop Chrome CDP (`127.0.0.1:9222`, profile `~/.chrome-cdp`) is optional via a self-hosted runner labeled `gsa-laptop`. GitHub-hosted VMs cannot see that port. Tailscale host `lees-macbook-pro-4` (`100.113.122.123`) is the machine; CDP stays on localhost unless you proxy it.

## Fly

`fly deploy -c fly.cycle.toml --ha=false` publishes `gsa-agile-cycle` (`GET /healthz`, `GET /cycle`). 256mb, auto-stop.

## Local

```bash
python3 scripts/gsa-cycle/cycle.py
GSA_VERIFY_URL=http://127.0.0.1:4180/ python3 scripts/gsa-cycle/cdp_verify.py
cargo run -p downtime-server -- --root . --static globalstatus --port 4180 --workers 24
```

## Cycles 7–18 (next twelve)

Product rules: **Rust multithreaded runtime**. **No paid licenses** — recreate anything we cannot get for free, then spend later cycles perfecting our version (`docs/NO-PAID-LICENSES.md`). PHP `php -S` and `router.php` are legacy. Blast math is first-party cube-root scaling in `downtime-core` (not NUKEMAP, not NukeSim). DEFCON one-thumb HUD. Free terrain + OSM Buildings. After each cycle: tests green, Chrome CDP on `:9222`, comment on #75 as GLOBALSTATUS / RUCKUS.

Arsenal (see `docs/RUST-ARSENAL.md` on `rust/native-core`): **pure Rust** (`downtime-server` / tokio / wasm / wgpu) is the product. Rapira/Pasir (Zend inside Tokio) is a GoDaddy bridge only. php-rust/rphp stay research — do not run the globe on them.

| Cycle | Goal | Issues | Done when |
| --- | --- | --- | --- |
| 7 | Recreate NUKEMAP: in-globe NUCLEAR + DEFCON HUD (our math) | #39 | Tap globe drops rings. No outbound NUKEMAP/NukeSim. CDP sees `nuke` + `#nuke-hud`. |
| 8 | `downtime-server` replaces PHP on :4180 (tokio multi-thread) | #18 #41 | `curl /healthz` says rust. No PHP required locally. No Rapira unless GoDaddy blocks a cutover. |
| 9 | Perfect blast v1: WASM export + Glasstone table tests (1 kt / 15 kt / 1 Mt) | #18 #39 | wasm and JS radii match Rust. Table fixtures in `downtime-core`. |
| 10 | Native FIRE (one 44px thumb) + DEFCON lamp + rings | #41 #39 | `cargo run -p downtime-globe-native`. FIRE at camera target. |
| 11 | Recreate Esri/ion terrain: Mapzen Terrarium / SRTM default, no Terrain3D | #41 | Elevation on without an Esri or Cesium ion key. Native mesh reads Terrarium. |
| 12 | Recreate ion OSM Buildings: STREETS 3D from OSM Buildings CC BY-SA | #48 | Buildings extrude when the camera is low. Credit OSM. Cap 400/tile. |
| 13 | Poll-runner in Rust (one synthetic user); AIR stays unkeyed + cache | #34 | `/api/scan-state` + cache. No paid ADS-B key required. |
| 14 | Claims API + **free basemap default** (OSM / NASA / EOX 2016 CC BY) | #59 #60 | `/api/claims`. Startup map is not Esri. EOX 2018–2025 NC-SA is not the ad path. |
| 15 | Radiation registry from **public** sensors only | #69 #68 #71 | `radiation_sources.json`. Skip unverified. No paid nuclear-data vendor. |
| 16 | Perfect recreations: blast fallout ellipse + DEM-clamped rings; radiation bands; opt-in NOAA HYSPLIT (free) | #39 #72 #74 | Rings follow terrain. Bands vs background. Plume off by default. |
| 17 | Offline RAG: FTS5 BM25 + public MiniLM/Qwen; no closed model API | #20 | Citations. ONNX optional. No paid LLM key. |
| 18 | Native parity on **only free** tiles: XYZ + Terrarium + NUCLEAR + claims; retire PHP and Esri defaults from docs | #41 #18 | CI `cargo test --workspace` + CDP. RUCKUS checklist: no required paid token. |

### Guardrails for 7–18
- No paid licenses. Recreate the feature. Perfect it in a later cycle (`docs/NO-PAID-LICENSES.md`).
- No GoDaddy FTP until Lee says go-live.
- No copy of NUKEMAP/NukeSim physics or iframe.
- No Cesium ion, Mapbox GL JS v2+, Esri-required defaults, ACLED key, GIDEON REST, AISStream, or closed LLM APIs.
- No SPLC bulk jsonl in git.
- Release workflows still do not enable the empty `nuke-sim` cargo feature (private sim stays private). First-party `downtime-core::blast` is public.
- Chrome CDP stays on this laptop (`127.0.0.1:9222`). Tailscale host `lees-macbook-pro-4`.
- Green CI on the branch before the next cycle starts.
