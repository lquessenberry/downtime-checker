# Rustle

Drupal's job, in Rust: **leaves** (entities + fields) that describe the globe.

A leaf is one normalized datum in small git text. Bundles:

| Bundle | Drupal analog | Example |
| --- | --- | --- |
| `geolocation` | node + geofield point | Null Island, weather.gov HQ |
| `geofence` | geofield polygon / bbox | South Atlantic Anomaly |
| `geoorbital` | custom fields | ISS, GPS MEO, Clarke belt, Kármán |
| `geocell` | geofield + grid | Maidenhead JJ |
| `geotime` | datetime | (reserved) |
| `catalog` | taxonomy / place | catalog row without a point yet |

Fields are `field.lat`, `field.norad`, `field.west` / `south` / `east` / `north`. Links are `link.layer`, `link.asset`, `link.catalog`, `link.leaf`. Tags are repeatable `tag:` lines.

Stanzas live in `rust/crates/rustle/leaves/*.leaf.txt`. Blank line starts a new leaf. The core grove is compiled in with `include_str!` so WASM and the server share the same facts. Drop extra `*.leaf.txt` files in the catalog `leaves/` directory to overlay.

## Why not Drupal / PHP

PHP shared-nothing is one interpreter per request. Drupal stores this graph in MySQL + Field API. Rustle is a grove in memory, queried on tokio workers and in the browser WASM module. Product path is still lane 3 in `docs/RUST-ARSENAL.md`. Rapira is not this.

## Query

```bash
cargo run -p rustle -- list
cargo run -p rustle -- get iss
cargo run -p rustle -- context -30 -20
```

HTTP (downtime-server):

- `GET /api/leaves`
- `GET /api/leaves?bundle=geofence`
- `GET /api/leaves?tag=orbit`
- `GET /api/leaves/iss`
- `GET /api/leaves/context?lat=-30&lon=-20`

WASM: `rustle_grove_json()`, `rustle_context_json(lat, lon)`.

Clicking the globe joins that point to fences that contain it, nearby geolocations, and orbital leaves — the context layer between entities and live pins.
