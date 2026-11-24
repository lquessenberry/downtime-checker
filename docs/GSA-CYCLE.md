# Morning cycle (GLOBALSTATUS × RUCKUS)

Cycles **1–6** shipped the designation/claims board. Cycles **7–18** are the feature twelve. Cycles **19–30** are the catch-up twelve (review, perfect, low-bandwidth). Does not FTP. Does not merge `feat/globalstatus-prod` until tests are green.

**Bot pace:** one cycle per GLOBALSTATUS + RUCKUS comment pair. Do not start the next cycle until both have signed the last one. Laptop scheduler is **2 hours**, not 45 minutes.

**Will priority (Lee, 2026-11-22):** anything Will Casey suggests goes to the front of cycles 7–18. Track those issues with the `will-priority` label. Previously planned radiation (#68–#74) and offline RAG work is deferred behind this twelve, not dropped.

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

Default branch is `feat/globalstatus-prod` @ `2e2da14` (docs PR #90 merged). Staging wrap for the overnight sprint is already done: Fly `globalstatus-stage` v7 was built from `37eca1a` (2026-11-22 07:31 CT). Do not deploy again unless Lee says so.

## Local

```bash
python3 scripts/gsa-cycle/cycle.py
GSA_VERIFY_URL=http://127.0.0.1:4180/ python3 scripts/gsa-cycle/cdp_verify.py
cargo run -p downtime-server -- --root . --static globalstatus --port 4180 --workers 24
```

## Cycles 7–18 (feature twelve, Will first)

Product rules: **Rust multithreaded runtime**. **No paid licenses** — build our own version of anything we cannot get for free, then spend later cycles perfecting it (`docs/NO-PAID-LICENSES.md`). PHP `php -S` and `router.php` are legacy. Blast math is first-party cube-root scaling in `downtime-core`, part of the Global Status nuclear simulator built by Will Casey and Lee (inspired by NUKEMAP by Alex Wellerstein; not a port of NUKEMAP or NukeSim). DEFCON one-thumb HUD. Free terrain + OSM Buildings. After each cycle: tests green, Chrome CDP on `:9222`, comment on #75 as GLOBALSTATUS / RUCKUS.

Will's calculator source, Detonate, and the empty `nuke-sim` cargo feature stay out of the public repo until Will explicitly approves. "Put it on our layers" means the first-party blast calculator already in `blast.js`, not a license to publish the private sim.

Arsenal (see `docs/RUST-ARSENAL.md` on `rust/native-core`): **pure Rust** (`downtime-server` / tokio / wasm / wgpu) is the product. Rapira/Pasir (Zend inside Tokio) is a GoDaddy bridge only. php-rust/rphp stay research — do not run the globe on them.

| Cycle | Goal | Issues | Done when |
| --- | --- | --- | --- |
| 7 | Live USGS QUAKES layer (`quakes.js`, same pattern as `blast.js`) | #81 | Toggle shows live M2.5+ day feed, polite poll (5 min or more, cached), USGS credit, no key. Pins update by id. |
| 8 | Mobile pinch-zoom for 3D and 2D; icons scale with zoom; labels under icons | #84 | One-thumb pinch works in Cesium and 2D. Footer dots and `#mobile-pick` do not regress. |
| 9 | Rename downtime section to **Internet Grid Status** | #85 | UI copy is "Internet Grid Status" only. Live weather, outages, AQI, and other feeds stay on #83 (`live-layers-83`). The poller is #34. |
| 10 | Live feeds v1: storms, fires, AQI, fireballs, waves/contrails, outages from public feeds | #83 #8 #7 | Branch `live-layers-83`. Layers toggle, polite cache, pause when the tab is hidden. |
| 11 | Blast calculator on globe layers + death % by distance and altitude (ground vs air burst) | #39 | Rings and an attributed death-% card use first-party math only. Private sim stays private. |
| 12 | UNEXPLAINED UFO/cryptid layer, clearly labeled as reports / folklore | #82 | Toggle with source links. No copied third-party code. |
| 13 | Aviation/ADS-B, ships, traffic cams via one polite proxy (poll-runner continues) | #83 #44 #45 #34 | Browsers hit our cache, not adsb.lol directly. Commercial AIS stays link-only. |
| 14 | Chem/nuclear disasters, volcanoes, military bases, missile sites | #52 #47 | Opt-in, attributed, no street addresses. Volcanoes from USGS / GVP. |
| 15 | Public spending, aid flows, and failed projects | #86 | Country-level, official open data, source on every mark. |
| 16 | Mesh node naming, MQTT live updates when nodes are added, P2P sharing | #42 #17 | Names on pins, MQTT cache, P2P/sitrep without flooding brokers. FCC Part 97: no ham encryption. |
| 17 | Free TV/radio pins, ~28k towers by town, Broadcastify + LiveATC link-outs; desktop maritime watermark | #6 #5 #88 | Towers and free stations pin; Broadcastify/LiveATC are links only; desktop credit does not block the map. |
| 18 | Celestial event pins with comments; offline cache / download-and-run; engine checkpoint (Rust server, terrain, STREETS 3D) | #87 #16 #20 #18 #41 #48 | Event pins attributed. Offline pack or download-and-run tool exists. Rust/terrain/OSM work is not lost. |

### Guardrails for 7–18
- No paid licenses. Recreate the feature. Perfect it in a later cycle (`docs/NO-PAID-LICENSES.md`).
- No GoDaddy FTP until Lee says go-live.
- Do not copy NUKEMAP or NukeSim physics or iframe them. NUKEMAP by Alex Wellerstein is credited as inspiration only, not as the source of our calculations.
- No Cesium ion, Mapbox GL JS v2+, Esri-required defaults, ACLED key, GIDEON REST, AISStream, or closed LLM APIs.
- No SPLC bulk jsonl in git.
- Release workflows still do not enable the empty `nuke-sim` cargo feature (private sim stays private). First-party `downtime-core::blast` is public.
- Chrome CDP stays on this laptop (`127.0.0.1:9222`). Tailscale host `lees-macbook-pro-4`.
- Green CI on the branch before the next cycle starts.
- GLOBALSTATUS and RUCKUS both comment before the next cycle starts (catch-up).
- Officially sanctioned individuals stay named on the designations layer (Lee, 2026-11-22). No race-targeting framing anywhere.

## Cycle 13 review (poll-runner, #34)

**Spec.** One synthetic user in Rust. Visitors only read cache. AIR stays unkeyed (3 min, 500/day). No ADS-B paid key.

**What exists.**
- PHP `globalstatus/poll-runner.php`: `status|once|loop`, TTLs (AIR/JAM 180s, mesh 90s, animal 600s, grid 900s). Still requires `router.php`.
- Rebase onto `feat/globalstatus-prod` in `feat/issue-34-poll-runner-rebased`: `router.php` conflict resolved (AM/FM static files + poll `/api/scan-state`). **Not pushed, not PR, not CDP.**
- `downtime-server` already has tokio `Semaphore` + catalog **host** scans. That is not the layer poller. No `/api/scan-state` for outages/AIR/JAM caches.

**Verdict (RUCKUS).** The old cycle 13 (Rust poller as a standalone cycle) is **not done**. Live-feed cycles 10 and 13 now carry the product-facing slices (quakes already in 7; storms/fires in 10; ADS-B/ships in 13). The Rust job to move TTLs and caches into `downtime-server` workers remains in catch-up 20–22. AIR unkeyed path is already the product rule; keep it. GPS jamming (gpsjam) already shipped as a layer (#27); keep it live through this runner.

## Cycles 19–30 (catch-up twelve)

Queued. Do not execute until cycle 7–12 have GLOBALSTATUS + RUCKUS comments on #75. Same guardrails: no paid licenses, no FTP, no PHP new routes, recreate then perfect.

| Cycle | Goal | Issues | Done when |
| --- | --- | --- | --- |
| 19 | Catch-up audit of 7–12 (quakes, mobile zoom, grid rename, live feeds v1, blast HUD, UNEXPLAINED) | #75 #81 #84 #85 #83 #39 #82 | Both bots comment pass/fail per item. No new features. |
| 20 | Publish poll-runner rebase as reference PR; skeleton Rust layer poller | #34 | PR open. `downtime-server` has a `poll` module that is compile-tested empty jobs. |
| 21 | Rust poll: outages + mesh + disease caches (one user); outbreak simulator follow-on if pins stay stable | #34 #89 | `/api/outages` etc. served from Rust cache files. #89 is opt-in and caveated. |
| 22 | Rust poll: AIR + JAM unkeyed 3 min cache | #34 | 500/day cap encoded. No `ADSB_LOL_API_KEY` required. gpsjam stays live. |
| 23 | Low-bandwidth delta feed (ETag + brotli) | #63 #62 | One `/api/delta` the phone can poll. |
| 24 | Perfect STREETS 3D: multi-tile, drop when camera rises | #48 | More than one OSM Buildings tile. Credit OSM. |
| 25 | Perfect Terrarium on native (no Android tear) | #41 | Heightmap mesh; 2D still intact. |
| 26 | Meshtastic / MeshCore GPS sitrep (free firmware, our packet) | #17 #66 | Packet format documented; no paid mesh SaaS. |
| 27 | Signed offline packs with manifests | #67 #20 | Checksums. No paid CDN. |
| 28 | 160-character SMS status summary | #64 #73 | One line for outages + DEFCON. |
| 29 | Native coastlines (Natural Earth, public domain) | #58 | Coast geometry on the wgpu globe. |
| 30 | Retro: bots happy on 13–29; PHP and Esri defaults still retired | #75 #18 | RUCKUS list: no required paid token. Next twelve (radiation, RAG) only if #75 says so. |

### Catch-up rules
- Scheduler interval **2 hours**.
- If the last #75 comment is not a GLOBALSTATUS/RUCKUS pair, the run **only** re-tests and re-comments. It does not open a new cycle.
- Cycles 19–30 are queued behind 7–18. Cycle 19 is review-only.
