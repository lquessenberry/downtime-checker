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
| `guns-usa` | 50 states + D.C. | [World Population Review, gun ownership by state](https://worldpopulationreview.com/state-rankings/gun-ownership-by-state) (Pew / CBS News, 2022) | Manual snapshot | Saved static layer, not a live feed. One pin at each state centroid from `county-centroids.json`. D.C. has licenses only. |
| `guns-world` | One pin per country | [World Population Review, gun ownership by country](https://worldpopulationreview.com/country-rankings/gun-ownership-by-country) (Small Arms Survey 2017) | Manual snapshot | Saved static layer, not a live feed. One pin for the entire United States. Indonesia and Taiwan have no per-person rate. |
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
the repository **default branch**. The fork default is `feat/globalstatus-prod`.

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
| DISEASE OUTBREAK | [HealthMap](https://www.healthmap.org/en/) `GET https://www.healthmap.org/getAlerts.php` with `category[]=1` (New & Ongoing Outbreaks), `2` (Warnings), `29` (International Significance), `time_interval=1 week`. Boston Children's Hospital Computational Epidemiology Group. Same AJAX the public map uses. No published bulk API. Click credit: healthmap.org. Cache `globalstatus/data/disease-cache.json` 180s. | On layer on | News + official alerts, not case-line lists. Marker links on HealthMap are `javascript:b(alertId)`, so we credit the map, not a deep-link. |
| ANIMAL DISEASE OUTBREAK | [GIDEON](https://app.gideononline.com/updates/outbreaks) public feed `GET https://app.gideononline.com/api/public/diseases/events?return=simple`, rows with `is_animal`. That JSON is what the public outbreaks page loads (~11k events, ~8.5k animal). The **licensed** REST API at [api-doc.gideononline.com](https://api-doc.gideononline.com/) needs an institutional key (`kristina@gideononline.com`). Cache `globalstatus/data/animal-cache.json` 600s. | On layer on | Historical + current; we keep GIDEON's `is_animal` filter. Official animal records also live at [WOAH WAHIS](https://wahis.woah.org/#/home) (no simple public JSON). |

`feeds.json` is a last-known live snapshot. Do not schedule it; a 4-second boot
sample hammers nothing useful and the file is large.

## Production vs staging

| Surface | How data is served |
| --- | --- |
| https://globalstatus.app | `router.php` reads `globalstatus/api/*.json`. Outages/MIL are fetched by PHP. |
| Fly `downtime-globe` | Node `visualizer/server.mjs` uses pack → cache → network (`datapack.mjs`). |
| Local `:4173` / `:4174` | Same Node path. `OFFLINE=1` stops at pack/cache. |

## Designation claims

Issue [#60](https://github.com/lquessenberry/downtime-checker/issues/60).
Ingest: `python3 scripts/designations/designations.py --ingest un` (people included).
Geocode: `python3 scripts/designations/geocode_designations.py --contact you@example.com`.
Globe: `GET /api/designations`, `GET /api/violence`. Layers default off.

| Source | Kind | Access | Notes |
| --- | --- | --- | --- |
| UN Security Council consolidated list | government | XML feed | Entities and individuals. Street/city/country stay on the record. |
| US State FTO | government | HTML table (Chrome UA) | Name + date; no published address. |
| UK Home Office proscribed | government | accessible HTML | Name + proscription date. |
| EU FSF | government | XML bulk | Street/city when the file has them. EU persons stay in jsonl; globe pack is entities unless `--eu-people`. |
| SPLC Hate Map | ngo | public `/wp-json/splc/v1/hatemap` | Local jsonl only. No bulk redistribution. |
| UCDP GED | violence | CSV zip with lat/lon | Separate layer. Cap 8000, year >= 2020. |
| ACLED | violence | API key / local CSV | Same violence layer if a file or key is present. |

Shared schema is `claims.jsonl` (#59): `claimant`, `basis`, `asserted_date`, `status`, `geometry` or `location.county_fips`, `class` in `designation` | `violence` | `zone`. Filter with `--filter`. CFR theaters ingest as `class=zone`; CONFLICT TRACKER remains the zone renderer. `GET /api/claims` is the class index.

Do not cron designation dumps into git. Source addresses stay on the claim. NUCLEAR is a first-party cube-root blast layer on the globe (#39). Math lives in `downtime-core` and `globalstatus/blast.js`. The multithreaded server is `downtime-server` (tokio). PHP is legacy.

## Credit / license reminders

- gpsjam.org: credit John Wiseman; underlying aircraft from ADS-B Exchange and airplanes.live.
- CFR: conflict tracker page, theater markers, not ACLED dots.
- FAO Hunger Map / SOFI: undernourishment prevalence.
- EOX 2018–2025 mosaics are CC BY-NC-SA; ads need a commercial license or the 2016 CC BY mosaic. We do not buy the commercial license; the shipped SAT path is NASA GIBS / EOX 2016 CC BY / OSM.
- Esri World Imagery, Street Map, and Terrain3D are not required defaults (cycles 11 and 14). Terrarium + OSM replace them.
- No Cesium ion key. No Mapbox GL JS v2+. See `docs/NO-PAID-LICENSES.md`.
- Uniden HPDB is the public BT885 Update Manager dump.
- HealthMap: credit Boston Children's Hospital / healthmap.org. Aggregates news, ProMED, WHO, etc.
- GIDEON: credit gideononline.com. Public events feed is free to view; bulk licensed API is not. Do not scrape the paid app UI.
- Do not use ADS-B Exchange as a bulk API. Do not store church FTP logins.
