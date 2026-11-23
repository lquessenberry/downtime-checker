# FrankenPHP stage for globalstatus/

This runs the same globalstatus/ Cesium site and PHP router as GoDaddy, but
on FrankenPHP (Caddy + PHP 8.4, OPcache on, classic mode). `router.php`
calls `exit` and keeps per-request globals, so worker mode would need a
rewrite.

## What changes for visitors

- **Plain JSON routes** are served straight from files, precompressed with
  zstd/br/gzip, and cached for 5 minutes. They never touch PHP:
  `/api/catalog`, `streams`, `amfm`, `designations`, `violence`, `conflicts`,
  `hunger`, `websdr`, `gpsjam`, `radio`, `zones`, `claims`.
- **Live layers** (`/api/outages`, `mil`, `mesh`, `disease`, `animal`,
  `feeds`):
  - The poll runner writes them to `data/*-cache.json`, with a `.gz` twin
    written atomically.
  - They are served as static files with a 60 s cache.
  - Until the first poll lands, they fall back to the PHP router.
- **The poll runner** (`poll-runner.php loop`) runs in the background,
  started by `start.sh`.
  - Each source waits at least 5 minutes. Military aircraft waits 15 minutes
    to stay under adsb.lol's daily cap. The grid pass runs every 30 minutes.
  - When the Fly machine is stopped, nothing polls.
- **Blocked routes:**

  | Request | Response |
  |---|---|
  | `*.php`, `data/`, dotfiles, `*.md` | 404 |
  | `/api/events` (retired stream) | 410 |
  | `POST /api/stop` | 403 |

- **Cache headers:**

  | Path | Cache-Control |
  |---|---|
  | `vendor/` | 1 year, immutable. Rename the folder when Cesium is upgraded |
  | Icons, images, sounds | 1 day |
  | Page shell (`index.html` and the page scripts) | `no-cache` |

## Local

```sh
docker build -f deploy/frankenphp/Dockerfile -t globalstatus-franken:local .
docker run --rm -p 8090:8080 globalstatus-franken:local
open http://127.0.0.1:8090/
```

## Fly

`fly.frankenphp.toml` has these settings:
- auto_stop `stop`
- min_machines_running 0
- 512 MB shared-cpu-1x
- no volume

Its app name is a placeholder, so always pass `-a`:

```sh
flyctl deploy -c fly.frankenphp.toml -a globalstatus-stage
```
