# Data pack

Local clients keep overlay JSON, Uniden pins, and optional map tiles here so the globe can boot with no network.

Load order for every dataset:

1. This directory (`DATA_DIR` if set)
2. `~/.cache/downtime` (or `/tmp/downtime-cache` on Fly)
3. Live fetch, skipped when `OFFLINE=1`

```bash
cd visualizer
node lib/datapack.mjs snapshot websdr gpsjam conflicts
node lib/datapack.mjs vendor-cesium # Cesium 1.128 next to the app
OFFLINE=1 node server.mjs
```

From the repo root, `node scripts/refresh_static_data.mjs overlays` also copies the pack into `globalstatus/api/` for production PHP. GitHub Actions cron does that on a schedule. See [docs/DATA-SOURCES.md](../../docs/DATA-SOURCES.md).

Live aircraft, ships, and GPSInterference jamming stay in `feeds.json` as the last snapshot and are not cron-committed. SAT tiles that the proxy has already served live under the cache `tiles/eox/` tree.
