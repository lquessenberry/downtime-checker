"""Allowlist: only open-source globe engines and binaries we own.

CesiumJS is Apache-2.0. Mapping its published architecture into our Rust
globe is the point of this tool. Disassembling a proprietary Earth app
(Google Earth, ArcGIS Pro, Apple Maps, Bing) to copy it is out of scope
and this CLI refuses those targets.
"""

from __future__ import annotations

ALLOWED_TARGETS = {
    "cesium": {
        "license": "Apache-2.0",
        "repo": "https://github.com/CesiumGS/cesium",
        "kind": "javascript-source",
        "notes": "Primary. Read Source/, not the minified vendor bundle.",
    },
    "worldwind": {
        "license": "Apache-2.0 / NASA",
        "repo": "https://github.com/NASAWorldWind/WebWorldWind",
        "kind": "javascript-source",
        "notes": "Ellipsoid + tessellator reference.",
    },
    "maplibre": {
        "license": "BSD-3-Clause",
        "repo": "https://github.com/maplibre/maplibre-gl-js",
        "kind": "javascript-source",
        "notes": "2D/Mercator specialist. Useful for the flat-map path, not the sphere.",
    },
    "osgearth": {
        "license": "LGPL-3.0",
        "repo": "https://github.com/gwaldron/osgearth",
        "kind": "native-source",
        "notes": "LGPL. Read for ideas; do not statically link into MIT/Apache crates.",
    },
    "magnum": {
        "license": "MIT",
        "repo": "https://github.com/mosra/magnum",
        "kind": "native-source",
        "notes": "Scene graph + GL. Optional backend comparison.",
    },
    "self": {
        "license": "MIT OR Apache-2.0",
        "repo": "https://github.com/lquessenberry/downtime-checker",
        "kind": "native-binary",
        "notes": "Our downtime-globe binary. Always allowed to reverse.",
    },
}

REFUSED_SUBSTRINGS = (
    "google earth",
    "googleearth",
    "earth.google",
    "arcgis",
    "esri",
    "apple maps",
    "mapkit",
    "bing maps",
    "virtual earth",
    "mapbox-gl-js",  # proprietary Mapbox GL; use MapLibre
)


def refuse_reason(target: str) -> str | None:
    key = target.strip().lower()
    if key in ALLOWED_TARGETS:
        return None
    for bad in REFUSED_SUBSTRINGS:
        if bad in key:
            return (
                f"Refused target {target!r}. This pipeline maps open-source globe "
                "engines (Cesium, WorldWind, MapLibre, osgEarth, Magnum) and our "
                "own binaries. Proprietary Earth apps are out of scope."
            )
    if key.endswith(".exe") or key.endswith(".app") or key.endswith(".dll"):
        return (
            f"Binary {target!r} is not on the allowlist. Pass --target self "
            "for downtime-globe, or an OSS name from policy.ALLOWED_TARGETS."
        )
    return f"Unknown target {target!r}. Allowed: {', '.join(sorted(ALLOWED_TARGETS))}."
