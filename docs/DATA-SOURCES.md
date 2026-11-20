# Datapoint sources

Inventory of globe overlays and how they refresh. Static packs are written by
`node scripts/refresh_static_data.mjs` and GitHub Actions cron. Live layers stay
on the running app and are not committed.

Production PHP (`globalstatus/api/*.json`) is a copy of the Node data pack
(`visualizer/data`). Cron commits both. A live FTP push is still a separate
manual workflow.

## Static packs (GitHub Actions)

| Dataset | Pins / payload | Upstream | Cadence | Notes |
| --- | --- | --- | --- | --- |
| `catalog` | Host searches | In-repo `*.txt` catalogs | With overlays | Regenerated from `visualizer/lib/catalogs.mjs`. No network. |
| `websdr` | SDR receivers | `http://websdr.ewi.utwente.nl/~~websdrlistk?v=1&fmt=2&chseq=0` (map: [websdr.org](http://websdr.org/)) | Twice daily | ~6 h cache in the Node loader. |
| `gpsjam` | GPS interference hexes | Daily H3 CSV at [gpsjam.org/data](https://gpsjam.org/data) | Twice daily | John Wiseman; aircraft reports from ADS-B Exchange / airplanes.live. |
| `conflicts` | War theaters | [CFR Global Conflict Tracker](https://www.cfr.org/global-conflict-tracker) | Twice daily | Page scrape + bundled theater coordinates. |
| `streams` | Scanner listen pins | Broadcastify state/county pages, radio-browser.info, OpenMHz if it answers | Daily | 250 ms delay between pages. OpenMHz is often Cloudflare 403. |
| `radio` | Uniden sites | Public BT885 FTP `ftp.uniden.com/BT885` (`BT885ftp2` installer login in `hpdb-ftp.mjs`) | Weekly (Monday) | Derived overlay only. Do not commit `MasterHpdb_*.gz`. |
| `hunger` | FAO undernourishment | [FAO Hunger Map](https://www.fao.org/interactive/hunger-map/en/) | Annual / manual | SOFI 3-year average. No stable public bulk API in-tree. |
| `county-centroids.json` | County points | Bundled with production | Never | Reference geometry. |
| `place-centroids.json` | Place points | Bundled with production | Never | Reference geometry. |
| `icao_aircraft_types.json` | ICAO types | Bundled with production | Rare / manual | Lookup table for AIR cards. |

Run locally:

```bash
node scripts/refresh_static_data.mjs overlays   # catalog, websdr, gpsjam, conflicts
node scripts/refresh_static_data.mjs streams
node scripts/refresh_static_data.mjs radio
node scripts/refresh_static_data.mjs all
```

Actions: **Refresh static data** (`workflow_dispatch` + cron). Cron only fires from
the repository **default branch**. Keep this workflow on fork `main`, or set the
fork default to `feat/globalstatus-prod`.

## Live (do not cron into git)

| Layer | Upstream | Poll | Why not git |
| --- | --- | --- | --- |
| AIR | [adsb.lol](https://api.adsb.lol) v2 (`/v2/mil`, hubs, LADD, PIA, 7700). Fallback [OpenSky](https://opensky-network.org/api/states/all). Optional `ADS_B_FEEDER_URL`. | 3 min unkeyed / 45 s with `ADSB_LOL_API_KEY` | 500 req/day unkeyed. Positions go stale in minutes. |
| AIS | Finnish Digitraffic `https://meri.digitraffic.fi/api/ais/v1/locations`. Optional `wss://stream.aisstream.io` with `AISSTREAM_API_KEY`. | 20 s REST | Live ship tracks. |
| JAM | `https://api.gpsinterference.com/v1/interference/latest` | 20 min | Live dots. gpsjam.org hexes are the static pack above. |
| Outages | DOE/ORNL ODIN `https://odin.ornl.gov/odi?format=JSON&view=county`; UKPN / NPG / NGED open data; Hydro-Québec markers | PHP cache in `globalstatus/data/outages-cache.json` | Runtime on GoDaddy. |
| MIL | `https://api.adsb.lol/v2/mil` via `router.php` | PHP cache `globalstatus/data/mil-cache.json` | Same 500/day budget. |
| Scan / geo | Catalog hosts + `https://ipwho.is/{ip}` | On CHECK GRID | `locations.json` is a local cache. Do not PR it. |
| SAT tiles | EOX Sentinel-2 via `/tiles/eox/...` | On pan/zoom | Disk cache only. |

`feeds.json` is a last-known live snapshot. Do not schedule it; a 4-second boot
sample hammers nothing useful and the file is large.

## Production vs staging

| Surface | How data is served |
| --- | --- |
| https://globalstatus.app | `router.php` reads `globalstatus/api/*.json`. Outages/MIL are fetched by PHP. |
| Fly `downtime-globe` | Node `visualizer/server.mjs` uses pack → cache → network (`datapack.mjs`). |
| Local `:4173` / `:4174` | Same Node path. `OFFLINE=1` stops at pack/cache. |

## Credit / license reminders

- gpsjam.org: credit John Wiseman; underlying aircraft from ADS-B Exchange and airplanes.live.
- CFR: conflict tracker page, theater markers, not ACLED dots.
- FAO Hunger Map / SOFI: undernourishment prevalence.
- EOX 2018–2025 mosaics are CC BY-NC-SA; ads need a commercial license or the 2016 CC BY mosaic.
- Uniden HPDB is the public BT885 Update Manager dump.
- Do not use ADS-B Exchange as a bulk API. Do not store church FTP logins.
