# globe-re

Source inventory and disposition for a Rust globe. This is **not** a
disassembly problem. CesiumJS has source. MapLibre has source. The valuable
automation is: extract the module graph, then decide per module whether to
**port**, **rewrite**, **defer**, or **delete**.

```bash
python3 scripts/globe-re/globe_plan.py --list-engines
python3 scripts/globe-re/globe_plan.py --repo /tmp/cesium-src --engine cesiumjs \
  --out docs/globe-plan --licenses-out licenses.md --install-notices --notice-dest .
python3 -m unittest scripts/globe-re/tests/test_globe_plan.py scripts/globe-re/tests/test_globe_re.py
```

`globe_re.py map --emit-rust` still writes compiling WGS84 stubs. The plan
comes from `globe_plan.py`.

## License gate

Ingest requires a **permissive SPDX**: Apache-2.0, BSD-2/3, MIT, ISC, 0BSD,
CC0, Unlicense.

| id | SPDX | ingest |
| --- | --- | --- |
| cesiumjs | Apache-2.0 | yes |
| cesium-native | Apache-2.0 | yes |
| maplibre-gl | BSD-3-Clause | yes |
| openlayers | BSD-2-Clause | yes |
| deck | MIT | yes |
| three | MIT | yes |
| **mapbox-gl** | proprietary (v2+) | **refused** |
| google-earth, arcgis | proprietary | refused |
| osgearth | LGPL-3.0 | refused (copyleft) |

MapLibre GL JS and Mapbox GL JS are **not** interchangeable. v1 of Mapbox GL
was BSD-3; v2 switched to Mapbox terms. The scanner will not ingest `mapbox-gl`.

A Rust port of Cesium `Core/` is a **derivative work**. Those files stay
Apache-2.0. Apache-2.0 §4(d) requires reproducing NOTICE. This repo carries
`NOTICE-CESIUM` and `LICENSE-CESIUM` at the root, next to `LICENSE-APACHE`.
Dual-license (`MIT OR Apache-2.0`) does not relicense ported Cesium files as MIT.

`licenses.md` lives at the repo root, where a compliance reviewer looks.

## Dispositions

| disposition | meaning |
| --- | --- |
| **port** | Renderer-independent logic. Mechanical translation. Stays upstream SPDX. |
| **rewrite** | Concept survives, plumbing dies. Globe surface, camera, workers, **shaders**. GLSL→WGSL is not mechanical. |
| **defer** | Product call (DataSources/ entities). Cost is flagged; need is not. |
| **delete** | Replaced by wgpu (`Renderer/`) or egui (`Widgets/`). Work avoided. |

LOC ranks estimation. A 200-line transform is easier than a 2,000-line tile
walker. `unmapped.txt` is where the classifier failed.

The **external dependency surface** table is the shopping list (earcut →
triangulator crate; mersenne-twister → drop).

## Binary backends

Declared in `globe_plan.BACKENDS` (`list_functions` / `decompile` / `xrefs`).
**Unimplemented by design.** There is no Cesium binary. Do not build a Ghidra
adapter until a proprietary tile/terrain decoder with no source appears.
`--binary` exits 2.

## Cesium checkout

Do not scan minified `globalstatus/vendor/cesium/Cesium.js`.

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/CesiumGS/cesium.git /tmp/cesium-src
git -C /tmp/cesium-src sparse-checkout set Source packages/engine/Source LICENSE.md NOTICE.md NOTICE package.json
```
