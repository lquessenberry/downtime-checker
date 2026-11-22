# Architecture map (SigMap)

Between phases (cycle bands 1–6 / 7–18 / 19–30, and after each map-asset batch) run:

```bash
scripts/gsa-cycle/sigmap.sh
```

That indexes **WebAssembly** (`rust/crates/downtime-wasm`), **Rust** (`downtime-core`, `downtime-server`, `globe-native`, …), and the **Cesium** globe (`globalstatus/cesium.js` plus the vendored CesiumJS engine). Live site historically loaded CesiumJS **1.128** from cesium.com; `docs/rust-native.md` tracks **1.134** as the keep-until-native-succeeds pin.

Outputs:

- `docs/architecture/WIKI.md` — committed wiki (regenerate, do not hand-edit)
- `.github/copilot-instructions.md` — local/adapter (often gitignored by SigMap)
- `.context/` — local index only, never commit

Config: `gen-context.config.json`, `.contextignore`.
