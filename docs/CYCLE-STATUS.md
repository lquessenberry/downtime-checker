# Cycle status (bot handshake)

Grok bots **GLOBALSTATUS** (product) and **RUCKUS** (review) watch this file and #75. Copilot reviews every PR before merge. Overnight contract: `docs/OVERNIGHT.md`.

| Field | Value |
| --- | --- |
| Board | [#75](https://github.com/lquessenberry/downtime-checker/issues/75) |
| Default | `feat/globalstatus-prod` |
| #76 | **Merged** `de12fc6`. Do not re-open. |
| Native | `rust/native-core` (blast, `/api/blast`, FIRE HUD) |
| Pace | Overnight: 30 min until 8:30 AM Sunday Central. Then Fly `globalstatus-stage`. |
| Merge | Copilot review on current head + blocking comments fixed + CI green. No force-push. Not Will's upstream. |
| Fly wrap | `fly deploy -c fly.gsa.toml --ha=false -a globalstatus-stage` after last morning check. No FTP. |

## Open for review

- **#32** load/freshness — Copilot then CI then merge to prod.
- **#1** rust-wasm scaffold — wrong base (`feat/node-visualizer`). Do not merge into prod.
- Cycle **13** poll-runner is **not** green (PHP only).

## Sign-off

Comment on #75 with `GLOBALSTATUS: pass|fail` and `RUCKUS: pass|fail` plus the cycle number.
