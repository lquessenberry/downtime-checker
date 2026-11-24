# Cycle status (bot handshake)

Grok bots **GLOBALSTATUS** (product) and **RUCKUS** (review) watch this file and #75. Copilot reviews every PR before merge; while Copilot is out of quota, Lee approved the **RUCKUS review fallback for both agents**. Overnight contract: `docs/OVERNIGHT.md`. Full cycle table: `docs/GSA-CYCLE.md`.

| Field | Value |
| --- | --- |
| Board | [#75](https://github.com/lquessenberry/downtime-checker/issues/75) |
| Default | `feat/globalstatus-prod` @ `2e2da14` |
| Staging | Fly `globalstatus-stage` **v7** already live (2026-11-22 07:31 CT). Do not redeploy unless Lee says so. |
| Pace | 2-hour feature cycles. Cycles **7–18** are features; **19–30** are catch-up. |
| Priority | Lee (2026-11-22): anything Will Casey suggests goes to the front of the feature cycles. Label: `will-priority`. |
| Merge | Copilot on current head, or RUCKUS if Copilot `NO_QUOTA_REMAINING`, plus CI green. No force-push. Not Will's upstream. No FTP. |
| Blast source | The Global Status nuclear simulator and calculator (Will Casey and Lee) is first-party (`blast.js` / `downtime-core::blast`). Inspired by NUKEMAP by Alex Wellerstein; not a port of NUKEMAP. Detonate / the `nuke-sim` cargo feature stay out of the public repo until Will explicitly approves. |

## Open for review

- **#1** rust-wasm scaffold — wrong base (`feat/node-visualizer`). Do not merge into prod.
- Cycle-plan docs PR **#90** is merged at `2e2da14`. This handshake follows up so the default SHA and review list match that merge.
- Cycle **13** in the old plan (PHP poll-runner only) is **not** green; the #34 poll-runner branch is being rebased onto `feat/globalstatus-prod` as a reference PR. No new Fly app and no `globalstatus-stage` redeploy. Rust poll work stays in cycles 13 and 20–22.

## Cycles 7–18 (Will's items first)

| Cycle | Goal | Issues |
| --- | --- | --- |
| 7 | Live USGS QUAKES layer | #81 |
| 8 | Mobile pinch-zoom, zoom-scaled icons, labels under icons | #84 |
| 9 | Rename downtime section to Internet Grid Status | #85 |
| 10 | Live feeds v1: storms, fires, AQI, fireballs, waves/contrails, outages (public feeds only; branch `live-layers-83`) | #83 #8 #7 |
| 11 | Blast calculator on globe layers + death % by distance/altitude (public math only) | #39 |
| 12 | UNEXPLAINED UFO/cryptid layer | #82 |
| 13 | Aviation/ADS-B, ships, traffic cams via polite proxy (poll-runner continues) | #83 #44 #45 #34 |
| 14 | Chem/nuclear disasters, volcanoes, military bases, missile sites | #52 #47 |
| 15 | Public spending, aid flows, failed projects | #86 |
| 16 | Mesh node naming, MQTT live updates, P2P sharing | #42 #17 |
| 17 | Free TV/radio pins, towers, Broadcastify + LiveATC links; desktop maritime watermark | #6 #5 #88 |
| 18 | Celestial event pins; offline cache / download-and-run; engine checkpoint (Rust server, terrain, STREETS 3D) | #87 #16 #20 #18 #41 #48 |

Radiation registry (#68–#74) and offline RAG are **deferred** behind this twelve, not dropped. Catch-up 19–30 stays review / poll / low-bandwidth / packs, with outbreak simulator #89 on cycle 21.

## Sign-off

Comment on #75 with `GLOBALSTATUS: pass|fail` and `RUCKUS: pass|fail` plus the cycle number. Do not sign off on the other agent's behalf.
