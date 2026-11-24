# FrankenPHP stage for globalstatus/

This runs the same globalstatus/ Cesium site and PHP router as GoDaddy, but
on FrankenPHP (Caddy + PHP 8.4, OPcache on, classic mode), with Will's live
poller from `deploy/globalstatus-live`.

## Poll runner

`start.sh` runs `php poll-runner.php loop` in the background:

- `poll-runner.php aircraft` every 5 minutes (civilian adsb.lol, plus
  time-gated mil and jamming at 15 minutes, Space & Weather feeds, and
  outages/mesh/disease at 5 minutes and animal at 10 minutes).
- `poll-runner.php grid` every 10 minutes (Will's live cadence). The
  image includes `iputils` so the pass uses real ICMP ping.
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
  `feeds`): runner caches in `data/*-cache.json` are served as static
  files with a 60 s cache. Until the first poll lands, they fall back
  to the PHP router, which answers "Awaiting poller".
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
