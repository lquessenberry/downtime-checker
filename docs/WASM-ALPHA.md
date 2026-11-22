# WASM globe alpha (no Cesium)

Staging: https://globalstatus-stage.fly.dev/

This cut replaces the PHP Cesium globe on Fly staging with:

- `downtime-wasm` in the browser (`blast_rings_json`, layers, catalog helpers)
- `downtime-server` (tokio) for `/healthz`, `/api/blast`, static files
- Canvas orthographic Earth using the compiled NASA Blue Marble JPEG
- **No CesiumJS, no Cesium ion, no Mapbox**

```bash
fly deploy -c fly.wasm.toml --ha=false -a globalstatus-stage
```

Local:

```bash
# after wasm-bindgen has written globalstatus-wasm/downtime_wasm.js
cargo run -p downtime-server -- --static globalstatus-wasm --bind 127.0.0.1 --port 4181 --no-lookup
```

Alpha limits: software-sampled texture (not wgpu), no live OSM XYZ sampler yet, no phone-footer poller. Native `globe-native` remains the product renderer.

Copilot is out of the review loop until 2026-12-01.
