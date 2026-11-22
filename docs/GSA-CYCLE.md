# Morning cycle (GLOBALSTATUS × RUCKUS)

Cycles **1–6** shipped the designation/claims board. Cycles **7–18** are the next twelve. Does not FTP. Does not merge `feat/globalstatus-prod` until tests are green.

| Role | Job |
| --- | --- |
| GLOBALSTATUS | Product owner: layers, pins, in-globe NUCLEAR, staging |
| RUCKUS | Reviewer: tests, licenses, no auto-merge, no SPLC dump in git |

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

Product rule: **Rust multithreaded runtime**. PHP `php -S` and `router.php` are legacy. Blast math is first-party cube-root scaling in `downtime-core` (not NUKEMAP, not NukeSim). DEFCON one-thumb HUD. Terrain + OSM Buildings. After each cycle: tests green, Chrome CDP on `:9222`, comment on #75 as GLOBALSTATUS / RUCKUS.

Arsenal (see `docs/RUST-ARSENAL.md` on `rust/native-core`): **pure Rust** (`downtime-server` / tokio / wasm / wgpu) is the product. Rapira/Pasir (Zend inside Tokio) is a GoDaddy bridge only. php-rust/rphp stay research — do not run the globe on them.

| Cycle | Goal | Issues | Done when |
| --- | --- | --- | --- |
| 7 | Land in-globe NUCLEAR + DEFCON HUD on the Cesium client, served by Rust | #39 | Tap globe drops rings. No outbound NUKEMAP link. CDP sees `nuke` toggle + `#nuke-hud`. |
| 8 | `downtime-server` replaces PHP on :4180 (tokio multi-thread, `/healthz`, `/api/blast`) | #18 #41 | `curl /healthz` says rust. Scan workers ≥ 8. PHP not required for local globe. |
| 9 | WASM crate exports `blast_rings_json`; page prefers WASM, JS is fallback | #18 | wasm-pack or cargo build `downtime-wasm`. Same 15 kt radii as Rust tests. |
| 10 | Native globe FIRE (one 44px thumb) + DEFCON lamp + rings in egui | #41 #39 | `cargo run -p downtime-globe-native`. FIRE at camera target. |
| 11 | Terrain on by default (ArcGIS elevation already in Cesium; Terrarium on native) | #41 | Elevation selected when NUCLEAR or STREETS 3D arms. Native mesh has height. |
| 12 | STREETS 3D from OSM Buildings (CC BY-SA) when camera is low | #48 | Buildings extrude. Credit OSM. Cap 400 features/tile. |
| 13 | Poll-runner in Rust (rebase #34 logic into `downtime-server` workers, one synthetic user) | #34 | `/api/scan-state` + cache. No PHP poll-runner. |
| 14 | Merge designations/claims (`#60` `#59`) onto a Rust-served API (`/api/claims`) | #59 #60 | Packed JSON from disk, class filter. SPLC dumps stay gitignored. |
| 15 | Radiation registry + ambient layer, Rust fetch with `--skip-unverified` | #69 #68 #71 | `radiation_sources.json`, gold/purple distinction unused here; readings vs background #72 next. |
| 16 | Radiation bands + optional HYSPLIT plume (opt-in) | #72 #74 | Per-source bands. Plume off by default. |
| 17 | Offline RAG slice from the brainstorm file: FTS5 SQLite verbalize + BM25, no CUDA | #20 | `rag/bin/rag_query.py` answers with citations. ONNX optional. |
| 18 | Native globe parity checkpoint: XYZ + terrain + NUCLEAR + claims pins; retire PHP from docs | #41 #18 | `docs/rust-native.md` checklist updated. CI: `cargo test --workspace` + CDP. |

### Guardrails for 7–18
- No GoDaddy FTP until Lee says go-live.
- No copy of NUKEMAP/NukeSim physics or iframe.
- No SPLC bulk jsonl in git.
- Release workflows still do not enable the empty `nuke-sim` cargo feature (private sim stays private). First-party `downtime-core::blast` is public.
- Chrome CDP stays on this laptop (`127.0.0.1:9222`). Tailscale host `lees-macbook-pro-4`.
- Green CI on the branch before the next cycle starts.
