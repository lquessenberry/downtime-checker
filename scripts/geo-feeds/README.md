# geo-feeds

Catalog and fetcher for Global Status map layers.

`fetch_all.py` writes one JSON file per catalog id under `layers/` (gitignored).
Every file uses the shared layer envelope:

- canonical: `id`, `schemaVersion`, `source`, `sourceUrl`, `licence`, `credit`,
  `commercialUse`, `cadenceSeconds`, `fetchedAt` (Unix seconds), `stale`,
  `error`, `count`, `points`
- aliases for the same payload: `license`, `attribution`, `fetched_at`, `ttl`,
  `features` (GeoJSON Feature objects)

API keys are read from the environment only (`WAQI_TOKEN`, `OPENAQ_API_KEY`,
`OCM_API_KEY`). Keys are never written into `sourceUrl`, layer JSON, logs, or
the committed `catalog.json`. Keyed feeds are skipped when the matching env
var is unset. Do not commit `layers/` snapshots from a local run.

```bash
python3 scripts/geo-feeds/fetch_all.py
python3 scripts/geo-feeds/fetch_all.py --ids usgs-eq-all-day --limit 20
python3 -m unittest scripts/geo-feeds/tests/test_fetch_all.py
```
