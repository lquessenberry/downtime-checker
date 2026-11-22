# Morning cycle (GLOBALSTATUS × RUCKUS)

Bounded to **6 cycles**. Does not FTP. Does not merge `feat/globalstatus-prod`.

| Role | Job |
| --- | --- |
| GLOBALSTATUS | Product owner: layers, pins, NUKEMAP link, staging |
| RUCKUS | Reviewer: tests, licenses, no auto-merge, no SPLC dump in git |

## GitHub Actions

`.github/workflows/gsa-morning-cycle.yml` fires `20 12-17 * * 1-5` (six weekday morning hours, UTC) **once the file exists on the default branch** (`feat/globalstatus-prod`). Each run tests designations when present, PHP, and `cesium.js`, then comments the tracking issue. Pull requests that touch globe or cycle paths also run it.

Set repository variable `GSA_CYCLE_ISSUE` to the tracking issue number.

Laptop Chrome CDP (`127.0.0.1:9222`, profile `~/.chrome-cdp`) is optional via a self-hosted runner labeled `gsa-laptop`. GitHub-hosted VMs cannot see that port. Tailscale host `lees-macbook-pro-4` (`100.113.122.123`) is the machine; CDP stays on localhost unless you proxy it.

## Fly

`fly deploy -c fly.cycle.toml --ha=false` publishes `gsa-agile-cycle` (`GET /healthz`, `GET /cycle`). 256mb, auto-stop.

## Local

```bash
python3 scripts/gsa-cycle/cycle.py
GSA_VERIFY_URL=http://127.0.0.1:4180/ python3 scripts/gsa-cycle/cdp_verify.py
```
