"""Walk a CesiumGS/cesium checkout if the operator has one.

Minified globalstatus/vendor/cesium/Cesium.js is the wrong tree: no symbols,
no Source/ layout. Prefer a git clone of github.com/CesiumGS/cesium.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

INTERESTING = re.compile(
    r"export (default )?function (Cartesian3|Cartographic|Ellipsoid|Camera|"
    r"Globe|QuadtreeTile|ImageryLayer|TerrainProvider|Scene|Entity|"
    r"BillboardCollection|PointPrimitiveCollection|EllipsoidalOccluder)\b"
)


def locate(explicit: str | None, repo_root: Path) -> Path | None:
    candidates = []
    if explicit:
        candidates.append(Path(explicit))
    env = os.environ.get("CESIUM_SRC")
    if env:
        candidates.append(Path(env))
    candidates.extend(
        [
            repo_root.parent / "cesium",
            Path.home() / "src" / "cesium",
            Path("/opt/cesium"),
            repo_root / "vendor" / "cesium-src",
        ]
    )
    for path in candidates:
        source = path / "Source" if (path / "Source").is_dir() else path
        if (source / "Core").is_dir() and (source / "Scene").is_dir():
            return source
    return None


def inventory(source: Path, limit: int = 400) -> dict:
    files = []
    hits = []
    for dirpath, _, filenames in os.walk(source):
        for name in filenames:
            if not name.endswith(".js"):
                continue
            rel = os.path.relpath(os.path.join(dirpath, name), source)
            files.append(rel)
            if len(hits) < limit:
                try:
                    text = Path(dirpath, name).read_text(encoding="utf-8", errors="replace")
                except OSError:
                    continue
                if INTERESTING.search(text):
                    hits.append(rel)
    return {
        "root": str(source),
        "js_files": len(files),
        "core_present": (source / "Core").is_dir(),
        "scene_present": (source / "Scene").is_dir(),
        "renderer_present": (source / "Renderer").is_dir(),
        "workers_present": (source / "Workers").is_dir(),
        "symbol_hits": hits[:80],
    }


def dump_json(payload: dict, dest: Path) -> None:
    dest.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def extract_symbol(source: Path, name: str, max_chars: int = 4000) -> dict:
    """Pull one constructor / function from Source/ — the source-map analog of decompile."""
    needle = re.compile(rf"(export\s+(default\s+)?function\s+{re.escape(name)}\b|function\s+{re.escape(name)}\s*\()")
    matches = []
    for dirpath, _, filenames in os.walk(source):
        for fname in filenames:
            if not fname.endswith(".js"):
                continue
            path = Path(dirpath, fname)
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            if not needle.search(text) and name not in fname:
                continue
            rel = os.path.relpath(path, source)
            idx = text.find(f"function {name}")
            snippet = text[max(0, idx) : max(0, idx) + max_chars] if idx >= 0 else text[:max_chars]
            matches.append({"file": rel, "chars": len(text), "snippet": snippet})
            if len(matches) >= 5:
                return {"name": name, "matches": matches}
    return {"name": name, "matches": matches}


def clone_sparse(dest: Path) -> Path:
    """Shallow-sparse clone of CesiumGS/cesium Source/ + LICENSE. Network required."""
    import subprocess

    dest.parent.mkdir(parents=True, exist_ok=True)
    if (dest / "Source" / "Core").is_dir():
        return dest / "Source"
    subprocess.run(
        [
            "git",
            "clone",
            "--depth",
            "1",
            "--filter=blob:none",
            "--sparse",
            "https://github.com/CesiumGS/cesium.git",
            str(dest),
        ],
        check=True,
    )
    subprocess.run(
        [
            "git",
            "-C",
            str(dest),
            "sparse-checkout",
            "set",
            "Source/Core",
            "Source/Scene",
            "Source/Renderer",
            "Source/DataSources",
            "LICENSE.md",
        ],
        check=True,
    )
    return dest / "Source"
