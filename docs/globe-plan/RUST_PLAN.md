# Rust port plan: CesiumJS

Engine license: `Apache-2.0`  ·  Modules scanned: 1,560  ·  Total LOC: 430,401

A Rust port of `Core/` is a **derivative work**. Those files stay `Apache-2.0` and Apache-2.0 §4(d) NOTICE obligations travel with them. This document inventories; it does not port.

## Disposition summary

| disposition | modules | LOC | share |
|---|---|---|---|
| port | 484 | 120,981 | 28.1% |
| rewrite | 730 | 181,867 | 42.3% |
| defer | 250 | 91,255 | 21.2% |
| delete | 96 | 36,298 | 8.4% |

The **delete** column is 8.4% of scanned LOC. That code does not get ported. It gets replaced by `wgpu` (for `Renderer/`) or by a native UI toolkit (for `Widgets/`). Every line in that column is work avoided, and it is usually the single largest architectural decision in the port.

## Work by role and disposition

| disposition | role | LOC |
|---|---|---|
| port | `core-utility` | 78,827 |
| port | `3d-tiles` | 16,151 |
| port | `math3d` | 15,361 |
| port | `geometry` | 5,416 |
| port | `geodesy` | 4,968 |
| port | `projection` | 258 |
| rewrite | `scene-misc` | 120,790 |
| rewrite | `scene-render` | 24,021 |
| rewrite | `shader` | 16,241 |
| rewrite | `globe-surface` | 13,764 |
| rewrite | `worker` | 7,051 |
| defer | `gltf` | 48,058 |
| defer | `entity-model` | 43,197 |
| delete | `webgl-abstraction` | 19,004 |
| delete | `ui` | 17,294 |

## Port targets, largest first

| module | role | LOC | rust home |
|---|---|---|---|
| `packages/engine/Source/Scene/Cesium3DTileset.js` | `3d-tiles` | 4,597 | custom |
| `packages/core/Source/GeometryPipeline.js` | `geometry` | 3,292 | geo + custom |
| `packages/core/Source/Matrix4.js` | `math3d` | 3,281 | glam (DVec3, DMat4, DQuat) |
| `packages/engine/Source/Scene/Cesium3DTile.js` | `3d-tiles` | 2,606 | custom |
| `packages/core/Source/Color.js` | `core-utility` | 2,296 | custom |
| `packages/engine/Source/Core/Resource.js` | `core-utility` | 2,283 | custom |
| `packages/core/Source/Matrix3.js` | `math3d` | 1,908 | glam (DVec3, DMat4, DQuat) |
| `packages/engine/Source/Core/Cesium3DTilesTerrainGeometryProcessor.js` | `core-utility` | 1,870 | custom |
| `packages/engine/Source/Core/GroundPolylineGeometry.js` | `core-utility` | 1,662 | custom |
| `packages/core/Source/PolygonGeometry.js` | `core-utility` | 1,574 | custom |
| `packages/core/Source/BoundingSphere.js` | `core-utility` | 1,500 | custom |
| `packages/engine/Source/Scene/Cesium3DTileStyle.js` | `3d-tiles` | 1,500 | custom |
| `packages/core/Source/RectangleGeometry.js` | `math3d` | 1,487 | glam (DVec3, DMat4, DQuat) |
| `packages/engine/Source/Core/CesiumTerrainProvider.js` | `core-utility` | 1,411 | custom |
| `packages/core/Source/CorridorGeometry.js` | `core-utility` | 1,406 | custom |
| `packages/core/Source/EllipseGeometry.js` | `core-utility` | 1,313 | custom |
| `packages/core/Source/PolygonGeometryLibrary.js` | `core-utility` | 1,302 | custom |
| `packages/core/Source/OrientedBoundingBox.js` | `core-utility` | 1,269 | custom |
| `packages/engine/Source/Core/VectorPipeline.js` | `core-utility` | 1,246 | custom |
| `packages/core/Source/JulianDate.js` | `core-utility` | 1,232 | custom |
| `packages/core/Source/Cartesian3.js` | `math3d` | 1,226 | glam (DVec3, DMat4, DQuat) |
| `packages/core/Source/Quaternion.js` | `math3d` | 1,217 | glam (DVec3, DMat4, DQuat) |
| `packages/core/Source/Math.js` | `math3d` | 1,185 | glam (DVec3, DMat4, DQuat) |
| `packages/engine/Source/Core/ScreenSpaceEventHandler.js` | `core-utility` | 1,149 | custom |
| `packages/engine/Source/Scene/Cesium3DTileBatchTable.js` | `3d-tiles` | 1,135 | custom |
| `packages/core/Source/TimeIntervalCollection.js` | `core-utility` | 1,117 | custom |
| `packages/core/Source/Matrix2.js` | `math3d` | 1,107 | glam (DVec3, DMat4, DQuat) |
| `packages/core/Source/IntersectionTests.js` | `core-utility` | 1,089 | custom |
| `packages/core/Source/Rectangle.js` | `math3d` | 1,087 | glam (DVec3, DMat4, DQuat) |
| `packages/engine/Source/Core/Cesium3DTilesTerrainProvider.js` | `core-utility` | 1,055 | custom |
| `packages/core/Source/Cartesian4.js` | `math3d` | 988 | glam (DVec3, DMat4, DQuat) |
| `packages/engine/Source/Scene/Cesium3DTilesVoxelProvider.js` | `3d-tiles` | 943 | custom |
| `packages/engine/Source/Core/Cesium3DTilesTerrainData.js` | `core-utility` | 935 | custom |
| `packages/engine/Source/Core/HeightmapTerrainData.js` | `core-utility` | 906 | custom |
| `packages/core/Source/BoxGeometry.js` | `core-utility` | 902 | custom |
| `packages/core/Source/Ellipsoid.js` | `geodesy` | 867 | custom + proj4rs |
| `packages/core/Source/Cartesian2.js` | `math3d` | 834 | glam (DVec3, DMat4, DQuat) |
| `packages/core/Source/FixedFrameTransforms.js` | `core-utility` | 825 | custom |
| `packages/engine/Source/Core/VectorProvider.js` | `core-utility` | 797 | custom |
| `packages/engine/Source/Scene/Cesium3DTilePointFeature.js` | `3d-tiles` | 790 | custom |

## Rewrite targets

These keep the conceptual model and get new plumbing. Largest first. Shaders live here: GLSL to WGSL is not a mechanical port.

| module | role | LOC |
|---|---|---|
| `packages/engine/Source/Scene/Scene.js` | `scene-render` | 5,601 |
| `packages/engine/Source/Scene/Camera.js` | `scene-render` | 4,059 |
| `packages/engine/Source/Scene/GlobeSurfaceTileProvider.js` | `globe-surface` | 3,363 |
| `packages/engine/Source/Scene/ScreenSpaceCameraController.js` | `scene-misc` | 3,113 |
| `packages/engine/Source/Scene/Primitive.js` | `scene-render` | 2,509 |
| `packages/engine/Source/Scene/GaussianSplatPrimitive.js` | `scene-misc` | 2,494 |
| `packages/engine/Source/Scene/Expression.js` | `scene-misc` | 2,234 |
| `packages/engine/Source/Scene/TerrainFillMesh.js` | `scene-misc` | 2,226 |
| `packages/engine/Source/Scene/BillboardCollection.js` | `scene-misc` | 2,157 |
| `packages/engine/Source/Scene/VoxelPrimitive.js` | `scene-misc` | 2,139 |
| `packages/engine/Source/Scene/PolylineCollection.js` | `scene-misc` | 2,002 |
| `packages/engine/Source/Scene/ShadowMap.js` | `scene-misc` | 1,965 |
| `packages/engine/Source/Scene/Material.js` | `scene-render` | 1,935 |
| `packages/engine/Source/Scene/ImageryLayer.js` | `globe-surface` | 1,759 |
| `packages/engine/Source/Scene/Picking.js` | `scene-misc` | 1,720 |
| `packages/engine/Source/Workers/decodeI3S.js` | `worker` | 1,658 |
| `packages/engine/Source/Scene/Label.js` | `scene-misc` | 1,655 |
| `packages/engine/Source/Scene/Billboard.js` | `scene-misc` | 1,614 |
| `packages/engine/Source/Scene/QuadtreePrimitive.js` | `globe-surface` | 1,591 |
| `packages/engine/Source/Scene/PointCloud.js` | `scene-misc` | 1,415 |
| `packages/engine/Source/Scene/MetadataClassProperty.js` | `scene-misc` | 1,413 |
| `packages/engine/Source/Scene/ImplicitSubtree.js` | `scene-misc` | 1,397 |
| `packages/engine/Source/Scene/ClassificationPrimitive.js` | `scene-misc` | 1,390 |
| `packages/engine/Source/Scene/Vector3DTilePrimitive.js` | `scene-misc` | 1,281 |
| `packages/engine/Source/Scene/BufferPrimitiveCollection.js` | `scene-misc` | 1,239 |
| `packages/engine/Source/Scene/VoxelTraversal.js` | `scene-misc` | 1,224 |
| `packages/engine/Source/Scene/PointPrimitiveCollection.js` | `scene-misc` | 1,218 |
| `packages/engine/Source/Scene/Implicit3DTileContent.js` | `scene-misc` | 1,188 |
| `packages/engine/Source/Scene/GlobeSurfaceTile.js` | `globe-surface` | 1,160 |
| `packages/engine/Source/Scene/Globe.js` | `globe-surface` | 1,151 |
| `packages/engine/Source/Scene/VoxelEllipsoidShape.js` | `scene-misc` | 1,127 |
| `packages/engine/Source/Scene/SceneTransitioner.js` | `scene-render` | 1,114 |
| `packages/engine/Source/Scene/GlobeTranslucencyState.js` | `globe-surface` | 1,100 |
| `packages/engine/Source/Scene/LabelCollection.js` | `scene-misc` | 1,094 |
| `packages/engine/Source/Scene/buildVectorGltfFromMVT.js` | `scene-misc` | 1,072 |
| `packages/engine/Source/Scene/GeoJsonPrimitive.js` | `scene-misc` | 1,068 |
| `packages/engine/Source/Scene/DynamicEnvironmentMapManager.js` | `scene-misc` | 1,048 |
| `packages/engine/Source/Scene/CloudCollection.js` | `scene-misc` | 1,044 |
| `packages/engine/Source/Scene/PostProcessStage.js` | `scene-render` | 1,024 |
| `packages/engine/Source/Scene/GroundPrimitive.js` | `scene-misc` | 1,003 |

## External dependency surface

Third-party packages the source imports. Each is a decision point: find a Rust crate, or reimplement, or drop the feature. Read this table first.

| package | import sites |
|---|---|
| `@cesium/core` | 999 |
| `@cesium/engine` | 32 |
| `urijs` | 12 |
| `@cesium/gltf` | 5 |
| `mersenne-twister` | 3 |
| `earcut` | 2 |
| `sourceGlobs` | 2 |
| `autolinker` | 2 |
| `@zip.js/zip.js` | 2 |
| `protobufjs` | 2 |
| `meshoptimizer` | 2 |
| `@tweenjs/tween.js` | 2 |
| `@cesium/wasm-splats` | 2 |
| `draco3d` | 2 |
| `lerc` | 2 |
| `collection` | 2 |
| `kdbush` | 1 |
| `topojson-client` | 1 |
| `dompurify` | 1 |
| `rbush` | 1 |
| `ktx-parse` | 1 |
| `pako` | 1 |
| `bitmap-sdf` | 1 |
| `grapheme-splitter` | 1 |
| `@spz-loader/core` | 1 |
| `members of members,` | 1 |
| `jsep` | 1 |
| `nosleep.js` | 1 |

## What this plan does not do

1. It does not port anything. It inventories and classifies. The mapping from a JS module to a Rust module is a judgment call a human makes.

2. `port` means the logic is renderer-independent and the translation is mechanical. It does not mean the translation is free. Ported files stay `Apache-2.0`.

3. `rewrite` means the concept survives and the implementation does not. Treat the LOC figure as effort, not as scope. Shaders are rewrite.

4. `delete` means the Rust ecosystem already provides the capability. Confirm the replacement exists before deleting.

5. Ordering is by LOC, which is a weak proxy for difficulty. A 200-line coordinate transform is easier than a 2,000-line tile-availability tree walker.

6. `defer` is a product decision. DataSources/ exists because declarative entity APIs are useful; whether this native globe needs them is not something the scanner can know.

7. Binary adapters are unimplemented. There is no Cesium binary. Do not build a Ghidra backend until a proprietary tile/terrain decoder with no source shows up.

