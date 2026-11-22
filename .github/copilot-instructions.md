# Copilot review instructions (Global Status)

Review pull requests into `feat/globalstatus-prod` on `lquessenberry/downtime-checker`.
Flag these as blocking:

- Secrets, API keys, FTP credentials, or tokens in code, config, or test fixtures.
- Code copied from NUKEMAP, NukeSim, or Will Casey's private calculator or simulator.
  First-party cube-root blast math in `downtime-core::blast` / `globalstatus/blast.js` is allowed.
  The `nuke-sim` cargo feature must stay off in release builds.
- Paid or non-FOSS dependencies on a default path: Cesium ion, Mapbox GL JS v2+,
  Esri-required defaults, ACLED keys, GIDEON REST, AISStream, closed LLM APIs.
- GADM data in the default web or F-Droid build (non-commercial license).
- SPLC or ADL bulk exports committed to git (manual local exports only).
- Scraping or copying RadioReference / Broadcastify content (link only).
  Sex-offender data: link to NSOPW only.
- Public user layers that could dox: home addresses or individual private people.
- Encryption on amateur-radio paths (FCC Part 97 forbids it; signed-only is fine).
- Unthrottled polling of third-party APIs (respect Nominatim 1 req/s, cache tiles).
- Anything that deploys to FTP or Fly from CI without a manual dispatch.

Also check: Rust `unsafe`, panics on network input, unbounded allocations from
remote data, XSS (use `esc()` before `innerHTML`), and wasm size growth.
