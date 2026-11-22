# WASM globe alpha (no Cesium)

Staging: https://globalstatus-stage.fly.dev/

This cut replaces the PHP Cesium globe on Fly staging with:

- `downtime-wasm` in the browser (blast, **Rustle grove**, catalog helpers)
- `downtime-server` (tokio) for `/healthz`, `/api/blast`, `/api/leaves`, `/api/catalog`, `/api/scan`
- WebGL orthographic Earth (NASA Blue Marble JPEG), drag / pitch / wheel zoom
- Click a point for Rustle context (geofence, nearby leaves, orbitals)
- CHECK GRID against the catalog (weather default)
- **No CesiumJS, no Cesium ion, no Mapbox**

```bash
fly deploy -c fly.wasm.toml --ha=false -a globalstatus-stage
```

Local:

```bash
# after wasm-bindgen has written globalstatus-wasm/downtime_wasm.js
cargo run -p downtime-server -- --static globalstatus-wasm --bind 127.0.0.1 --port 4181 --no-lookup
```

Alpha limits: WebGL sphere (not wgpu globe-native), no live OSM XYZ sampler yet, no phone-footer poller. Catalog scans use `--no-lookup` on Fly so pins join through Rustle addresses when the catalog row has no lat/lon. Native `globe-native` remains the product renderer.

Copilot is out of the review loop until 2026-12-01.
