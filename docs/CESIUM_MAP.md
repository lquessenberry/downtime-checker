# Cesium → globe-native map

This is a **source inventory**, not a disassembly. The living plan is
[globe-plan/RUST_PLAN.md](globe-plan/RUST_PLAN.md), produced by:

```bash
python3 scripts/globe-re/globe_plan.py --repo /tmp/cesium-src --engine cesiumjs \
  --out docs/globe-plan --licenses-out licenses.md
```

CesiumJS is Apache-2.0. A port of `packages/core` / `Core/` is a derivative
work: those files stay Apache-2.0, [LICENSE-CESIUM](../LICENSE-CESIUM) is in
the repo root, and [NOTICE-CESIUM](../NOTICE-CESIUM) records §4(d). Mapbox GL
JS is refused; MapLibre is BSD-3-Clause.

Binary backends (Ghidra, IDA, Binja, r2, Frida) are **unimplemented**. There
is no Cesium binary.

## Disposition of the scanned Cesium tree

See the table in [globe-plan/RUST_PLAN.md](globe-plan/RUST_PLAN.md). Shape:

| disposition | what |
| --- | --- |
| **port** | `packages/core` math/geodesy/geometry, 3D Tiles decode. Stays Apache-2.0. glam covers Cartesian/Matrix/Quat. |
| **rewrite** | Globe surface, camera, scene, workers, **shaders** (GLSL→WGSL is not mechanical). |
| **defer** | DataSources entities, glTF. Product call. |
| **delete** | `Renderer/` (wgpu) and `packages/widgets` (egui). |

Shaders are rewrite. LOC ranks estimation, not sequence.

## WGS84 frame

Cesium `Ellipsoid.WGS84` radii (meters): `[6378137.0, 6378137.0, 6356752.3142451793]`.

Native wgpu frame is **not** Cesium ECEF:

| Axis | Cesium ECEF | globe-native unit sphere |
| --- | --- | --- |
| +X | (0°N, 0°E) | (0°N, 0°E) |
| +Y | (0°N, 90°E) | North pole |
| +Z | North pole | (0°N, 90°W) |

`engine::ellipsoid::Ellipsoid::cartographic_to_native_unit` applies
`[x, z, -y]` then normalizes. Current `engine/` stubs match published WGS84
constants; they are not yet a line-by-line port of `Ellipsoid.js`.

## Global Status layers

Still named stubs in `downtime-core` except reachability. Native must grow
XYZ, terrain, 2D, live layers, spiderweb, and the in-process poller before it
succeeds Cesium. Do not port Cesium ion.
