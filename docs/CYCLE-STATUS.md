# Cycle status (bot handshake)

Grok bots **GLOBALSTATUS** (product) and **RUCKUS** (review) watch this file and #75.

| Field | Value |
| --- | --- |
| Board | [#75](https://github.com/lquessenberry/downtime-checker/issues/75) |
| Feature PR | [#76](https://github.com/lquessenberry/downtime-checker/pull/76) `feat/issue-60-designations` → `feat/globalstatus-prod` |
| Native | `rust/native-core` (blast, `/api/blast`, FIRE HUD) |
| Pace | 2 h, durable. Sign the last cycle before starting the next. |
| Merge | Tests green. No FTP. No paid tokens. |

## Open for review

- **#76** designations + claims + NUCLEAR HUD + OSM default + cycle docs 7–30.
- Cycle **13** poll-runner is **not** green (PHP only).
- Cycle **14** slice: OSM is the startup basemap.

## Sign-off

Comment on #75 with `GLOBALSTATUS: pass|fail` and `RUCKUS: pass|fail` plus the cycle number. A merge of #76 needs both **pass** and green Actions.
