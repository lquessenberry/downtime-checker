# WASM globe alpha (no Cesium)

Staging: https://globalstatus-stage.fly.dev/

Homepage is **QuietEarth**: the same `globe-native` crate as the desktop wgpu
app, built for `wasm32-unknown-unknown` (eframe WebGPU, WebGL2 fallback).

- `downtime-globe-native` wasm (`WebHandle`) is `/`
- `downtime-server` (tokio) for `/healthz`, `/api/blast`, `/api/leaves`, `/api/catalog`, `/api/scan`, `/tiles/{osm,opentopo,gibs}/…`
- OSM / OpenTopo / GIBS stitch via same-origin `/tiles/…` (z=2 mosaic)
- Old canvas HUD kept at `/hud.html` (uses `downtime-wasm` + `globe.js`)
- **No CesiumJS, no Cesium ion, no Mapbox**

```bash
fly deploy -c fly.wasm.toml --ha=false -a globalstatus-stage
```

Local:

```bash
# after wasm-bindgen has written globalstatus-wasm/downtime_wasm.js
cargo run -p downtime-server -- --static globalstatus-wasm --bind 127.0.0.1 --port 4181 --no-lookup
```

Alpha limits: z=2 stitch (not a live quadtree), no phone-footer poller, no terrain. Catalog scans use `--no-lookup` on Fly. Desktop `downtime-globe` remains the native product binary; this is the web cut of the same renderer.

Copilot is out of the review loop until 2026-12-01.
