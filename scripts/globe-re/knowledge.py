"""Cesium architecture as published under Apache-2.0.

This is not a decompile of minified Cesium.js. It is the module map CesiumGS
ships in Source/, translated into the Rust crates we have to build to succeed
the web globe. Every row cites a Cesium type and a globe-native destination.
"""

from __future__ import annotations

# Cesium WGS84 (Source/Core/Ellipsoid.js), meters.
WGS84_RADII_M = (6378137.0, 6378137.0, 6356752.3142451793)

MODULES = [
    {
        "id": "core.cartesian",
        "cesium": ["Cartesian2", "Cartesian3", "Cartesian4", "Cartographic"],
        "source": "Source/Core/Cartesian3.js, Cartographic.js",
        "job": "ECEF meters, geodetic lat/lon/height. Cesium Y is up in world, X through (0,0).",
        "rust": "globe-native/src/engine/cartographic.rs",
        "status": "partial — Cartographic stub + globe_math unit sphere; ECEF via ellipsoid.rs",
        "priority": 1,
    },
    {
        "id": "core.ellipsoid",
        "cesium": ["Ellipsoid", "Ellipsoid.WGS84", "EllipsoidalOccluder"],
        "source": "Source/Core/Ellipsoid.js, EllipsoidalOccluder.js",
        "job": "Radii, geodetic-to-ECEF, surface normals, far-side pin culling.",
        "rust": "globe-native/src/engine/ellipsoid.rs",
        "status": "constants + ECEF tests; live mesh still a unit sphere",
        "priority": 1,
    },
    {
        "id": "core.transforms",
        "cesium": ["Matrix3", "Matrix4", "Quaternion", "Transforms", "HeadingPitchRoll"],
        "source": "Source/Core/Matrix4.js, Transforms.js",
        "job": "View/projection, ENU frames, aircraft heading.",
        "rust": "globe-native/src/engine/transforms.rs (glam already covers matrices)",
        "status": "partial — glam Mat4 in globe_math.view_proj",
        "priority": 1,
    },
    {
        "id": "scene.camera",
        "cesium": ["Camera", "ScreenSpaceCameraController", "CameraFlightPath"],
        "source": "Source/Scene/Camera.js, ScreenSpaceCameraController.js",
        "job": "Orbit, zoom, inertia, 2D/Columbus, fly-to. Cesium uses a frustum + lookAt.",
        "rust": "globe_math.rs OrbitCamera — expand to 2D + inertia",
        "status": "partial — 3D orbit only, no 2D, no fly-to",
        "priority": 1,
    },
    {
        "id": "scene.globe",
        "cesium": ["Globe", "GlobeSurfaceTile", "QuadtreePrimitive", "QuadtreeTile"],
        "source": "Source/Scene/Globe.js, GlobeSurfaceTile.js, QuadtreeTile.js",
        "job": "LOD globe mesh. Tiles split when the projected error exceeds a pixel budget.",
        "rust": "globe-native/src/engine/quadtree.rs",
        "status": "QuadtreeTile stub; live mesh is still one UV sphere",
        "priority": 1,
    },
    {
        "id": "scene.imagery",
        "cesium": [
            "ImageryLayer",
            "ImageryLayerCollection",
            "UrlTemplateImageryProvider",
            "WebMapTileServiceImageryProvider",
            "ArcGisMapServerImageryProvider",
            "OpenStreetMapImageryProvider",
            "SingleTileImageryProvider",
        ],
        "source": "Source/Scene/ImageryLayer.js, Source/Scene/*ImageryProvider.js",
        "job": "XYZ/WMTS/ArcGIS/OSM tiles. Global Status uses Esri street/sat, Sentinel, GIBS, OSM, Blue Marble.",
        "rust": "globe-native/src/engine/imagery.rs",
        "status": "Basemap enum + Blue Marble JPEG; XYZ/WMTS not wired",
        "priority": 1,
    },
    {
        "id": "scene.terrain",
        "cesium": [
            "TerrainProvider",
            "EllipsoidTerrainProvider",
            "CesiumTerrainProvider",
            "GooglePhotorealistic3DTileset",
            "ArcGISTiledElevationTerrainProvider",
        ],
        "source": "Source/Core/TerrainProvider.js, Source/Scene/GlobeSurfaceTile.js",
        "job": "Heightmaps / quantized-mesh / Terrarium. Web globe uses Esri WorldElevation3D.",
        "rust": "globe-native/src/engine/terrain.rs",
        "status": "TerrainKind enum only; ellipsoid-smooth sphere",
        "priority": 2,
    },
    {
        "id": "scene.mode",
        "cesium": ["Scene", "SceneMode.SCENE3D", "SCENE2D", "COLUMBUS_VIEW"],
        "source": "Source/Scene/Scene.js, SceneMode.js",
        "job": "3D globe, 2D map, Columbus. Android 2D must not tear (keepFlatMapIntact).",
        "rust": "globe-native/src/engine/scene.rs",
        "status": "SceneMode enum; renderer is 3D only",
        "priority": 2,
    },
    {
        "id": "scene.primitives",
        "cesium": [
            "Primitive",
            "PrimitiveCollection",
            "BillboardCollection",
            "PointPrimitiveCollection",
            "PolylineCollection",
            "GroundPrimitive",
        ],
        "source": "Source/Scene/Primitive.js, BillboardCollection.js, PointPrimitiveCollection.js",
        "job": "GPU batches. Cesium Entities are a slow convenience; production layers use collections.",
        "rust": "globe-native/src/engine/primitives.rs",
        "status": "PointPrimitive stub; pins are still CPU egui dots",
        "priority": 2,
    },
    {
        "id": "data.entity",
        "cesium": ["Entity", "CustomDataSource", "GeoJsonDataSource", "CzmlDataSource"],
        "source": "Source/DataSources/Entity.js, CustomDataSource.js",
        "job": "Per-object API the web globe uses today. Native should skip this for AIR/AIS and instance.",
        "rust": "downtime-core DataLayer + globe-native instancing",
        "status": "partial — DataLayer stubs named after Cesium layers",
        "priority": 2,
    },
    {
        "id": "data.layers.gsa",
        "cesium": ["globalstatus/cesium.js live sources"],
        "source": "globalstatus/cesium.js, router.php, visualizer/lib/*.mjs",
        "job": (
            "Outages, AIR, JAM, AIS, mesh, disease, animal, scanners, AM/FM, "
            "hunger, conflict, grid spiderweb. One-user poller (#34)."
        ),
        "rust": "downtime-core/src/layer.rs + downtime-server datapack",
        "status": "stubs only except reachability",
        "priority": 1,
    },
    {
        "id": "render.webgl",
        "cesium": ["Context", "ShaderProgram", "VertexArray", "RenderState", "Pass"],
        "source": "Source/Renderer/",
        "job": "Cesium's WebGL2 wrapper. Native already uses wgpu 25 / Metal.",
        "rust": "globe-native/src/render.rs + globe.wgsl",
        "status": "partial — one pass, no depth buffer, no tile shader",
        "priority": 2,
    },
    {
        "id": "worker",
        "cesium": ["TaskProcessor", "createVerticesFromHeightmap", "upsampleQuantizedTerrainMesh"],
        "source": "Source/Workers/",
        "job": "Terrain and geometry on worker threads. Native: rayon / wgpu compute.",
        "rust": "globe-native workers later",
        "status": "missing",
        "priority": 3,
    },
    {
        "id": "ion",
        "cesium": ["CesiumIon", "IonImageryProvider", "IonResource"],
        "source": "Source/Scene/IonImageryProvider.js",
        "job": "Cesium ion is a paid tile CDN. We do not depend on it. Esri / GIBS / OSM / NASA.",
        "rust": "none — do not port ion tokens",
        "status": "wontfix — stay off ion",
        "priority": 9,
    },
]


GSA_LAYERS = [
    ("reachability", "Website reachability", "active"),
    ("power", "Power outages", "stub"),
    ("adsb", "Live air traffic", "stub"),
    ("gps-jamming", "Jammed GPS signals", "stub"),
    ("ships", "Maritime traffic", "stub"),
    ("mesh", "Mesh nodes", "stub"),
    ("disease", "Disease outbreak", "stub"),
    ("animal", "Animal disease outbreak", "stub"),
    ("scanners", "Scanners", "stub"),
    ("conflicts", "Conflict tracker", "stub"),
    ("hunger", "World hunger", "stub"),
    ("amfm", "AM FM towers", "stub"),
    ("grid", "Country grid / spiderweb", "stub"),
]


def by_priority() -> list[dict]:
    return sorted(MODULES, key=lambda m: (m["priority"], m["id"]))
