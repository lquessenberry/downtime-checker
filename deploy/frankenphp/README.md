# FrankenPHP stage for globalstatus/

This runs the same globalstatus/ Cesium site and PHP router as GoDaddy, but
on FrankenPHP (Caddy + PHP 8.4, OPcache on, classic mode), with Will's live
poller from `deploy/globalstatus-live`.

## Poll runner

`start.sh` runs `php poll-runner.php loop` in the background:

- Due HTTP sources (aircraft, jamming, Space & Weather, outages, mesh,
  disease, animal) run as parallel `--solo` child processes, at most
  three at a time, each with its own lock and cadence.
- Adaptive cadence slows a source after several unchanged payload
  hashes, but never faster than its set limit (5 min most, 15 min
  mil/jamming, 3 h wildfires). 5-minute sources stretch to at most
  10 minutes so visitors are never more than about 10 minutes stale.
- Snapshots are hashed (xxh128, else sha1) and written atomically only
  when the normalized payload changes. A small `/api/manifest` lists
  each layer's hash and timestamp so the client fetches only what changed.
- `poll-runner.php grid` every 10 minutes, exclusive of the HTTP wave.
  The image includes `iputils` so the pass uses real ICMP ping.
- Last-poll timestamps and caches live on a 1 GB Fly volume mounted at
  `/app/public/data`, so a restart does not immediately re-poll.
- The machine is always on (`auto_stop` off, `min_machines_running` 1).
- HTTP visitors only read caches. They never hit upstream.

## What changes for visitors

- **Plain JSON routes** are served straight from files, precompressed with
  zstd/br/gzip, and cached for 5 minutes. They never touch PHP:
  `/api/catalog`, `streams`, `amfm`, `designations`, `violence`, `conflicts`,
  `hunger`, `websdr`, `gpsjam`, `radio`, `zones`, `claims`.
- **Live layers** (`/api/outages`, `mil`, `mesh`, `disease`, `animal`,
  `jamming`, `aircraft`, plus `/api/space/*` and `/api/poll-status`):
  runner snapshots are served by Caddy `file_server` with hash-stable
  ETags (write-only-on-change), zstd/gzip precompression, and
  `Cache-Control: public, max-age=60, stale-while-revalidate=600`
  (`max-age=15` on the manifest and poll-status). Until the first poll
  lands, they fall back to the PHP router, which answers "Awaiting poller".
- **`/api/manifest`**: tiny layer → hash, ts index. The client skips
  unchanged layers (mesh and the old `/api/feeds` jamming poll were the
  main waste).
- **Blocked routes:**

  | Request | Response |
  |---|---|
  | `*.php`, `data/`, dotfiles, `*.md` | 404 |
  | `/api/events` (retired stream) | 410 |
  | `POST /api/stop` | 403 |

## Local

```sh
docker build -f deploy/frankenphp/Dockerfile -t globalstatus-franken:local .
docker run --rm -p 8090:8080 globalstatus-franken:local
```

## Fly (staging only)

```sh
flyctl volumes create gsa_data --region dfw --size 1 -a globalstatus-stage --yes
flyctl deploy -c fly.frankenphp.toml -a globalstatus-stage --ha=false
```

`fly.frankenphp.toml`: auto_stop off, min_machines_running 1, 512 MB
shared-cpu-1x, 1 GB volume `gsa_data` at `/app/public/data`. Always
pass `-a globalstatus-stage` and `--ha=false` (no second machine).
