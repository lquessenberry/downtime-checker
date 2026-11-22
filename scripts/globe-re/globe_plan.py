#!/usr/bin/env python3
"""
globe_plan.py -- map an open-source globe engine into a Rust port plan.

Reads a pinned checkout of a permissively licensed globe engine, derives its
module graph, classifies each module by architectural role, and emits a plan
that distinguishes four dispositions: port, rewrite, defer, delete.

This is a source-inventory-and-disposition problem. Binary backends (Ghidra,
radare2, Rizin, IDA, Binary Ninja, Frida) are declared as interfaces and
deliberately unimplemented. Populate them when a target with no source appears.

Usage:
  python3 scripts/globe-re/globe_plan.py --repo ./vendor/cesium --engine cesiumjs --out docs/globe-plan
  python3 scripts/globe-re/globe_plan.py --repo ./vendor/cesium --licenses --licenses-out licenses.md
  python3 scripts/globe-re/globe_plan.py --repo ./vendor/cesium --engine cesiumjs --top 40
  python3 scripts/globe-re/globe_plan.py --list-engines
  python3 scripts/globe-re/globe_plan.py --repo ./vendor/x --binary   # fails by design
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

# --------------------------------------------------------------------------
# engine registry. license is the gate: anything not clearly permissive is
# refused at ingest rather than silently mapped.
# MapLibre ≠ Mapbox. Mapbox GL JS v2+ is proprietary; v1 was BSD-3-Clause.
# --------------------------------------------------------------------------
PERMISSIVE_SPDX = frozenset({
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "MIT",
    "ISC",
    "0BSD",
    "Unlicense",
    "CC0-1.0",
})

ENGINES = {
    "cesiumjs": {
        "label": "CesiumJS",
        "spdx": "Apache-2.0",
        "lang": "js",
        "roots": [
            "packages/core/Source",
            "packages/engine/Source",
            "packages/gltf/Source",
            "packages/widgets/Source",
            "Source",
        ],
        "skip": ["Specs", "ThirdParty", "node_modules", "Build",
                 "__tests__", ".spec."],
        "upstream": "https://github.com/CesiumGS/cesium",
    },
    "cesium-native": {
        "label": "cesium-native",
        "spdx": "Apache-2.0",
        "lang": "cpp",
        "roots": ["CesiumUtility", "CesiumGeometry", "CesiumGeospatial",
                  "CesiumGltf", "CesiumGltfReader", "Cesium3DTilesSelection",
                  "CesiumAsync", "CesiumRasterOverlays"],
        "skip": ["test", "CMakeFiles", "ThirdParty", "external"],
        "upstream": "https://github.com/CesiumGS/cesium-native",
    },
    "maplibre-gl": {
        "label": "MapLibre GL JS",
        "spdx": "BSD-3-Clause",
        "lang": "ts",
        "roots": ["src"],
        "skip": ["test", "rollup", "build", ".d.ts"],
        "upstream": "https://github.com/maplibre/maplibre-gl-js",
    },
    "openlayers": {
        "label": "OpenLayers",
        "spdx": "BSD-2-Clause",
        "lang": "js",
        "roots": ["src/ol"],
        "skip": ["test", "spec"],
        "upstream": "https://github.com/openlayers/openlayers",
    },
    "deck": {
        "label": "deck.gl",
        "spdx": "MIT",
        "lang": "ts",
        "roots": ["modules/core/src", "modules/layers/src"],
        "skip": ["test", "dist"],
        "upstream": "https://github.com/visgl/deck.gl",
    },
    "three": {
        "label": "three.js",
        "spdx": "MIT",
        "lang": "js",
        "roots": ["src"],
        "skip": ["test", "examples"],
        "upstream": "https://github.com/mrdoob/three.js",
    },
}

# Anything that looks like a globe engine but is not cleanly permissive.
# mapbox-gl and maplibre-gl are not interchangeable.
REFUSE = {
    "mapbox-gl": "Mapbox GL JS v2+ is proprietary; v1 was BSD-3. "
                 "Do not ingest v2+ into a permissive pipeline. Use maplibre-gl.",
    "mapbox": "Mapbox GL JS v2+ is proprietary. Use maplibre-gl (BSD-3-Clause).",
    "mapbox-gl-js": "Mapbox GL JS v2+ is proprietary. Use maplibre-gl.",
    "mapboxgl": "Mapbox GL JS v2+ is proprietary. Use maplibre-gl.",
    "google-earth": "Proprietary.",
    "googleearth": "Proprietary.",
    "arcgis-js": "Proprietary.",
    "arcgis": "Proprietary.",
    "osgearth": "LGPL-3.0 is copyleft, not a permissive SPDX. Read, do not ingest.",
}

# --------------------------------------------------------------------------
# role classification. pattern -> (role, rust_home, disposition, note)
# order matters; first match wins.
# Shaders are rewrite: GLSL→WGSL is not mechanical.
# --------------------------------------------------------------------------
ROLE_RULES = [
    (r"/(?:Core/|packages/core/Source/)(Cartesian|Matrix|Quaternion|Math|Matrix3|Matrix4|Rectangle)",
     "math3d", "glam (DVec3, DMat4, DQuat)", "port",
     "mechanical translation, high confidence"),
    (r"/(?:Core/|packages/core/Source/)(Cartographic|Ellipsoid|Transforms|HeadingPitchRoll)",
     "geodesy", "custom + proj4rs", "port",
     "verify datum and ellipsoid constants match; Apache-2.0 derivative"),
    (r"/(?:Core/|packages/core/Source/)(GeographicProjection|WebMercatorProjection|Projection)",
     "projection", "proj4rs", "port",
     "parity check against reference coordinates"),
    (r"/(?:Core/|packages/core/Source/)(PolygonPipeline|PolylinePipeline|Geometry|GeometryPipeline)",
     "geometry", "geo + custom", "port",
     "ring winding, arc tessellation, degenerate cases"),
    (r"/packages/core/Source/", "core-utility", "custom", "port",
     "packages/core is the modern Core/; Apache-2.0 derivative"),
    (r"/packages/gltf/", "gltf", "gltf crate", "defer",
     "evaluate the gltf crate before writing a parser"),
    (r"/packages/widgets/", "ui", "egui or native", "delete",
     "native UI toolkit replaces this"),
    (r"/Core/", "core-utility", "custom", "port", "triage individually"),
    (r"/Renderer/", "webgl-abstraction", "wgpu", "delete",
     "wgpu replaces this layer; porting is pure cost"),
    (r"/Shaders/|\.(glsl|vert|frag)$",
     "shader", "wgsl", "rewrite",
     "GLSL to WGSL is not mechanical; uniform layouts, clip space, precision"),
    (r"/Scene/(Globe|TerrainProvider|ImageryLayer|ImageryProvider|TileProvider|Quadtree)",
     "globe-surface", "wgpu + custom", "rewrite",
     "keep the conceptual model, replace all plumbing"),
    (r"/Scene/(Cesium3DTile|Tileset|TilingScheme|TileAvailability)",
     "3d-tiles", "custom", "port",
     "format decode, independent of any renderer"),
    (r"/Scene/(Model|Gltf|GltfPipeline|ModelUtility)",
     "gltf", "gltf crate", "defer",
     "evaluate the gltf crate before writing a parser"),
    (r"/Scene/(Camera|Scene|Primitive|Material|PostProcess|Sun|SkyAtmosphere)",
     "scene-render", "wgpu + custom", "rewrite",
     "engine-specific, no drop-in equivalent"),
    (r"/Scene/", "scene-misc", "wgpu + custom", "rewrite", ""),
    (r"/DataSources/", "entity-model", "custom", "defer",
     "skip unless the app needs declarative entities"),
    (r"/Widgets?/|/Widget/", "ui", "egui or native", "delete",
     "native UI toolkit replaces this"),
    (r"/Workers/", "worker", "rayon or tokio", "rewrite",
     "thread split changes; decode logic is portable, orchestration is not"),
    (r"/Assets/", "asset", "include_bytes! or loader", "port", ""),
    (r"/ThirdParty/|/external/", "vendored", "find upstream crate", "delete",
     "vendored C is usually a dependency you can get from crates.io"),
]

DEP_RE = re.compile(
    r"""(?:from\s+|require\s*\(\s*|import\s*\(\s*)['"]([^'"]+)['"]"""
)
SYM_RE = re.compile(
    r"^\s*export\s+(?:default\s+)?(?:abstract\s+)?"
    r"(?:class|interface|function|const|let|var|enum|type)\s+([A-Za-z_$][\w$]*)",
    re.M)
CODE_EXT = {".js", ".ts", ".mjs", ".cjs", ".jsx", ".tsx", ".cpp", ".hpp",
            ".h", ".cc", ".cxx", ".glsl", ".vert", ".frag", ".wgsl"}


def log(m):
    print(f"[{time.strftime('%H:%M:%S', time.gmtime())}] {m}", file=sys.stderr)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


ALIASES = {
    "cesium": "cesiumjs",
    "maplibre": "maplibre-gl",
    "maplibre-gl-js": "maplibre-gl",
    "open-layers": "openlayers",
    "deck.gl": "deck",
    "threejs": "three",
    "three.js": "three",
}


def canonical_engine(name: str) -> str:
    key = name.strip().lower().replace("_", "-").replace(" ", "-")
    return ALIASES.get(key, key)


def refuse_engine(name: str) -> str | None:
    key = canonical_engine(name)
    if key in REFUSE:
        return REFUSE[key]
    collapsed = key.replace("-", "").replace(".", "")
    for bad, why in REFUSE.items():
        token = bad.replace("-", "").replace(".", "")
        if token and token in collapsed:
            return why
    if key in ENGINES:
        spdx = ENGINES[key]["spdx"]
        if spdx not in PERMISSIVE_SPDX:
            return f"{key} is {spdx}, which is not a permissive SPDX. Refusing ingest."
        return None
    return f"unknown engine {name!r}; --list-engines"


# --------------------------------------------------------------------------
# license inventory
# --------------------------------------------------------------------------
LICENSE_NAMES = {"license", "license.md", "license.txt", "licence",
                 "licence.md", "copying", "copying.txt"}
NOTICE_NAMES = {"notice", "notice.md", "notice.txt"}


def scan_licenses(root: Path) -> dict:
    found = {"license": [], "notice": [], "package": []}
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        # Stay out of giant trees that are not license material.
        parts = set(p.parts)
        if parts & {"node_modules", ".git", "Build", "ThirdParty"}:
            continue
        low = p.name.lower()
        rel = str(p.relative_to(root))
        if any(low == n or low.startswith(n + ".") for n in LICENSE_NAMES):
            found["license"].append({"path": rel, "sha256": sha256(p),
                                     "bytes": p.stat().st_size, "abs": str(p)})
        elif any(low == n or low.startswith(n + ".") for n in NOTICE_NAMES):
            found["notice"].append({"path": rel, "sha256": sha256(p),
                                    "bytes": p.stat().st_size, "abs": str(p)})
        elif low == "package.json" and len(found["package"]) < 8:
            try:
                body = json.loads(p.read_text(encoding="utf-8", errors="replace"))
            except Exception:
                continue
            lic = body.get("license") or body.get("licenses")
            if lic:
                found["package"].append({"path": rel, "license": lic})
    return found


def license_report(root: Path, engine: dict) -> list[str]:
    inv = scan_licenses(root)
    lines = ["# License inventory", "",
             f"Upstream: {engine.get('upstream', root)}",
             f"Scanned tree: `{root.name}`", "",
             f"Declared engine license: `{engine['spdx']}`", ""]

    lines.append("## License files")
    if inv["license"]:
        lines += ["| file | bytes | sha256 |", "|---|---|---|"]
        for f in inv["license"]:
            lines.append(f"| {f['path']} | {f['bytes']:,} | `{f['sha256'][:16]}…` |")
    else:
        lines.append("**No license file found. Refuse to proceed.**")

    lines.append("")
    lines.append("## Notice files")
    if inv["notice"]:
        for f in inv["notice"]:
            lines.append(f"- `{f['path']}` ({f['bytes']:,} bytes, `{f['sha256'][:16]}…`)")
        lines += ["", "Apache-2.0 §4(d): a derivative distribution must "
                  "reproduce the content of this NOTICE file. A Rust port of "
                  "`Core/` modules is a derivative work, so the NOTICE travels "
                  "into this repository (`NOTICE-CESIUM` or `NOTICE-<engine>`) "
                  "and into releases. Dual-licensed crates (`MIT OR Apache-2.0`) "
                  "cannot relicense those files as MIT; they stay Apache-2.0.", ""]
    else:
        lines += ["No NOTICE file present. Apache-2.0 §4(d) then imposes no "
                  "additional notice beyond the license itself, but you still "
                  "must retain the license text and mark modified files. "
                  "Ported `Core/` files stay `" + engine["spdx"] + "`.", ""]

    lines.append("## package.json license declarations")
    if inv["package"]:
        lines += ["| file | declared license |", "|---|---|"]
        for f in inv["package"]:
            lines.append(f"| {f['path']} | `{f['license']}` |")
    else:
        lines.append("None found.")
    lines += ["",
              "## Mapbox vs MapLibre", "",
              "MapLibre GL JS is BSD-3-Clause. Mapbox GL JS v2+ is proprietary. "
              "This scanner will not ingest `mapbox-gl`.", ""]
    return lines


def install_notices(root: Path, dest_root: Path, engine: dict, engine_id: str) -> list[str]:
    """Copy NOTICE into the consuming repo root. Compliance reviewers look here."""
    dest_root.mkdir(parents=True, exist_ok=True)
    inv = scan_licenses(root)
    copied = []
    if inv["notice"]:
        src = Path(inv["notice"][0]["abs"])
        name = "NOTICE-CESIUM" if engine_id.startswith("cesium") else f"NOTICE-{engine_id}"
        dest = dest_root / name
        shutil.copyfile(src, dest)
        copied.append(str(dest))
    if inv["license"]:
        src = Path(inv["license"][0]["abs"])
        name = "LICENSE-CESIUM" if engine_id.startswith("cesium") else f"LICENSE-{engine_id}"
        dest = dest_root / name
        shutil.copyfile(src, dest)
        copied.append(str(dest))
    return copied


# --------------------------------------------------------------------------
# source scan
# --------------------------------------------------------------------------
def skip_path(rel: str, engine: dict) -> bool:
    for pat in engine.get("skip", []):
        if pat in rel:
            return True
    return False


def classify(rel: str) -> tuple[str, str, str, str]:
    norm = "/" + rel.replace(os.sep, "/")
    for pattern, role, home, disp, note in ROLE_RULES:
        if re.search(pattern, norm):
            return role, home, disp, note
    return "unclassified", "?", "unclassified", "no rule matched; manual triage"


def resolve_rel_import(from_file: Path, spec: str, root: Path):
    if not spec.startswith("."):
        return None
    base = (from_file.parent / spec).resolve()
    for cand in (base, base.with_suffix(".js"), base.with_suffix(".ts"),
                 base.with_suffix(".mjs"), Path(str(base) + ".js"),
                 Path(str(base) + ".ts"), base / "index.js", base / "index.ts"):
        try:
            if cand.is_file() and cand.suffix in CODE_EXT:
                return str(cand.relative_to(root))
        except ValueError:
            return None
    return None


def scan_sources(root: Path, engine: dict):
    modules = []
    deps = []
    roots = [root / r for r in engine["roots"] if (root / r).is_dir()]
    if not roots:
        log(f"none of the declared roots exist under {root}: {engine['roots']}")
        return [], []
    # Drop the legacy Source/ stub when the monorepo packages exist.
    if any("packages/" in str(r.relative_to(root)) for r in roots):
        roots = [r for r in roots if str(r.relative_to(root)) != "Source"]
    log("scanning roots " + ", ".join(str(r.relative_to(root)) for r in roots))

    for base in roots:
        for p in base.rglob("*"):
            if not p.is_file() or p.suffix not in CODE_EXT:
                continue
            rel = str(p.relative_to(root))
            if skip_path(rel, engine):
                continue
            try:
                text = p.read_text(encoding="utf-8", errors="replace")
            except Exception as e:
                log(f"unreadable {rel}: {e}")
                continue

            symbols = sorted(set(SYM_RE.findall(text)))[:50]
            role, home, disp, note = classify(rel)
            modules.append({
                "path": rel,
                "role": role,
                "rust_home": home,
                "disposition": disp,
                "note": note,
                "loc": text.count("\n") + 1,
                "symbols": len(symbols),
                "symbol_names": ";".join(symbols[:8]),
            })
            for spec in DEP_RE.findall(text):
                target = resolve_rel_import(p, spec, root)
                if target:
                    deps.append({"from": rel, "to": target, "spec": spec})
                elif not spec.startswith("."):
                    deps.append({"from": rel, "to": f"external::{spec}",
                                 "spec": spec})
    return modules, deps


# --------------------------------------------------------------------------
# plan generation
# --------------------------------------------------------------------------
DISPOSITION_ORDER = {"port": 0, "rewrite": 1, "defer": 2, "delete": 3,
                     "unclassified": 4}


def build_plan(modules, deps, engine, top):
    by_disp = defaultdict(list)
    for m in modules:
        by_disp[m["disposition"]].append(m)

    loc_total = sum(m["loc"] for m in modules) or 1
    summary = []
    for disp in ("port", "rewrite", "defer", "delete", "unclassified"):
        group = by_disp.get(disp, [])
        loc = sum(m["loc"] for m in group)
        summary.append((disp, len(group), loc, 100.0 * loc / loc_total))

    role_loc = defaultdict(lambda: defaultdict(int))
    for m in modules:
        role_loc[m["disposition"]][m["role"]] += m["loc"]

    ext = Counter()
    for d in deps:
        if d["to"].startswith("external::"):
            top_pkg = d["to"].split("external::", 1)[1].split("/")[0]
            if top_pkg.startswith("@"):
                top_pkg = "/".join(d["to"].split("external::", 1)[1].split("/")[:2])
            ext[top_pkg] += 1

    lines = [f"# Rust port plan: {engine['label']}", "",
             f"Engine license: `{engine['spdx']}`  ·  "
             f"Modules scanned: {len(modules):,}  ·  "
             f"Total LOC: {loc_total:,}", "",
             "A Rust port of `Core/` is a **derivative work**. Those files stay "
             f"`{engine['spdx']}` and Apache-2.0 §4(d) NOTICE obligations travel "
             "with them. This document inventories; it does not port.", "",
             "## Disposition summary", "",
             "| disposition | modules | LOC | share |",
             "|---|---|---|---|"]
    for disp, n, loc, pct in summary:
        if n:
            lines.append(f"| {disp} | {n:,} | {loc:,} | {pct:.1f}% |")

    delete_share = next((p for d, _, _, p in summary if d == "delete"), 0.0)
    lines += ["", f"The **delete** column is {delete_share:.1f}% of scanned LOC. "
              "That code does not get ported. It gets replaced by `wgpu` "
              "(for `Renderer/`) or by a native UI toolkit (for `Widgets/`). "
              "Every line in that column is work avoided, and it is usually "
              "the single largest architectural decision in the port.", ""]

    lines += ["## Work by role and disposition", "",
              "| disposition | role | LOC |", "|---|---|---|"]
    for disp in ("port", "rewrite", "defer", "delete"):
        for role, loc in sorted(role_loc.get(disp, {}).items(),
                                key=lambda kv: -kv[1])[:8]:
            lines.append(f"| {disp} | `{role}` | {loc:,} |")
    lines.append("")

    lines += ["## Port targets, largest first", "",
              "| module | role | LOC | rust home |",
              "|---|---|---|---|"]
    ports = sorted(by_disp.get("port", []), key=lambda m: -m["loc"])[:top]
    for m in ports:
        lines.append(
            f"| `{m['path']}` | `{m['role']}` | {m['loc']:,} | {m['rust_home']} |"
        )
    lines.append("")

    lines += ["## Rewrite targets", "",
              "These keep the conceptual model and get new plumbing. Largest "
              "first. Shaders live here: GLSL to WGSL is not a mechanical port.",
              "",
              "| module | role | LOC |",
              "|---|---|---|"]
    for m in sorted(by_disp.get("rewrite", []), key=lambda x: -x["loc"])[:top]:
        lines.append(f"| `{m['path']}` | `{m['role']}` | {m['loc']:,} |")
    lines.append("")

    if ext:
        lines += ["## External dependency surface", "",
                  "Third-party packages the source imports. Each is a decision "
                  "point: find a Rust crate, or reimplement, or drop the "
                  "feature. Read this table first.", "",
                  "| package | import sites |", "|---|---|"]
        for pkg, n in ext.most_common(30):
            lines.append(f"| `{pkg}` | {n:,} |")
        lines.append("")

    unclass = by_disp.get("unclassified", [])
    if unclass:
        lines += ["## Unclassified, needs manual triage", ""]
        for m in sorted(unclass, key=lambda x: -x["loc"])[:40]:
            lines.append(f"- `{m['path']}` ({m['loc']:,} LOC)")
        lines.append("")

    lines += ["## What this plan does not do", "",
              "1. It does not port anything. It inventories and classifies. "
              "The mapping from a JS module to a Rust module is a judgment "
              "call a human makes.", "",
              "2. `port` means the logic is renderer-independent and the "
              "translation is mechanical. It does not mean the translation is "
              "free. Ported files stay `" + engine["spdx"] + "`.", "",
              "3. `rewrite` means the concept survives and the implementation "
              "does not. Treat the LOC figure as effort, not as scope. "
              "Shaders are rewrite.", "",
              "4. `delete` means the Rust ecosystem already provides the "
              "capability. Confirm the replacement exists before deleting.", "",
              "5. Ordering is by LOC, which is a weak proxy for difficulty. A "
              "200-line coordinate transform is easier than a 2,000-line "
              "tile-availability tree walker.", "",
              "6. `defer` is a product decision. DataSources/ exists because "
              "declarative entity APIs are useful; whether this native globe "
              "needs them is not something the scanner can know.", "",
              "7. Binary adapters are unimplemented. There is no Cesium "
              "binary. Do not build a Ghidra backend until a proprietary "
              "tile/terrain decoder with no source shows up.", ""]
    return lines


# --------------------------------------------------------------------------
# binary backends: declared, not implemented
# --------------------------------------------------------------------------
class BinaryBackend:
    """Interface for the case where a target has no source.

    None of these are implemented. They exist so the seam is defined and the
    eventual implementation has a shape to fit.
    """
    name = "null"
    engine = None

    def available(self) -> bool:
        return False

    def list_functions(self, binary: str) -> list:
        raise NotImplementedError

    def decompile(self, binary: str, addr: str) -> str:
        raise NotImplementedError

    def xrefs(self, binary: str, addr: str) -> list:
        raise NotImplementedError


BACKENDS = {
    "ghidra": BinaryBackend(),
    "radare2": BinaryBackend(),
    "rizin": BinaryBackend(),
    "ida": BinaryBackend(),
    "binja": BinaryBackend(),
    "frida": BinaryBackend(),
}


def binary_mode(_repo: Path) -> int:
    log("binary mode requested")
    print("No binary backend is implemented, by design.\n", file=sys.stderr)
    print("CesiumJS and every engine in the registry have source. A binary "
          "backend is only useful when a target ships as an opaque artifact: "
          "a proprietary tile or terrain decoder whose format you must "
          "interoperate with, a vendor SDK you cannot build against, or a "
          "firmware image.", file=sys.stderr)
    print("\nWhen that happens, the seam is BACKENDS[<name>] implementing "
          "list_functions / decompile / xrefs. Until then, an SDK that ships "
          "a headers directory, or a format with a specification, is a far "
          "better investment than disassembly.", file=sys.stderr)
    print("\nDeclared backends: " + ", ".join(sorted(BACKENDS)),
          file=sys.stderr)
    return 2


def write_outputs(out: Path, modules, deps, engine, top, root: Path) -> list[str]:
    out.mkdir(parents=True, exist_ok=True)
    lines = build_plan(modules, deps, engine, top)
    (out / "RUST_PLAN.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    with open(out / "modules.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=[
            "path", "role", "disposition", "rust_home", "loc", "symbols",
            "symbol_names", "note"])
        w.writeheader()
        for m in sorted(modules, key=lambda x: (DISPOSITION_ORDER.get(
                x["disposition"], 9), -x["loc"])):
            w.writerow({k: m[k] for k in w.fieldnames})

    with open(out / "deps.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["from", "to", "spec"])
        w.writeheader()
        for d in sorted(deps, key=lambda x: x["from"]):
            w.writerow(d)

    unclass = [m for m in modules if m["disposition"] == "unclassified"]
    (out / "unmapped.txt").write_text(
        "\n".join(f"{m['path']}\t{m['loc']}" for m in unclass) + ("\n" if unclass else ""),
        encoding="utf-8")

    lic_lines = license_report(root, engine)
    (out / "licenses.md").write_text("\n".join(lic_lines) + "\n", encoding="utf-8")
    return lines


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", default=None)
    ap.add_argument("--engine", default="cesiumjs")
    ap.add_argument("--out", default="plan")
    ap.add_argument("--top", type=int, default=30)
    ap.add_argument("--licenses", action="store_true")
    ap.add_argument("--licenses-out", default=None,
                    help="Write licenses.md here as well (repo root for reviewers)")
    ap.add_argument("--install-notices", action="store_true",
                    help="Copy NOTICE/LICENSE into --notice-dest (repo root)")
    ap.add_argument("--notice-dest", default=None)
    ap.add_argument("--binary", action="store_true")
    ap.add_argument("--list-engines", action="store_true")
    a = ap.parse_args(argv)

    if a.list_engines:
        for k, v in ENGINES.items():
            print(f"{k:<16}{v['spdx']:<16}{v['label']}")
        print("\nRefused (not permissive SPDX):")
        for k, why in REFUSE.items():
            print(f"  {k:<16}{why}")
        return 0

    reason = refuse_engine(a.engine)
    if reason:
        log(f"refusing engine '{a.engine}': {reason}")
        return 1

    engine_id = canonical_engine(a.engine)
    engine = ENGINES[engine_id]

    if not a.repo:
        log("--repo is required")
        return 1
    root = Path(a.repo).resolve()
    if not root.is_dir():
        log(f"not a directory: {root}")
        return 1

    if a.binary:
        return binary_mode(root)

    inv = scan_licenses(root)
    if not inv["license"] and not inv["package"]:
        log("no LICENSE file and no package.json license. Refusing ingest.")
        return 1

    out = Path(a.out)

    if a.licenses:
        lines = license_report(root, engine)
        out.mkdir(parents=True, exist_ok=True)
        (out / "licenses.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
        if a.licenses_out:
            Path(a.licenses_out).write_text("\n".join(lines) + "\n", encoding="utf-8")
        print("\n".join(lines))
        if a.install_notices:
            dest = Path(a.notice_dest) if a.notice_dest else Path.cwd()
            for p in install_notices(root, dest, engine, engine_id):
                log(f"installed {p}")
        return 0

    log(f"scanning {root} as {engine['label']}")
    modules, deps = scan_sources(root, engine)
    if not modules:
        log("no modules matched; check --repo and the engine roots")
        return 1
    log(f"{len(modules):,} modules, {len(deps):,} dependency edges")

    lines = write_outputs(out, modules, deps, engine, a.top, root)
    if a.licenses_out:
        Path(a.licenses_out).write_text("\n".join(license_report(root, engine)) + "\n",
                                       encoding="utf-8")
    if a.install_notices:
        dest = Path(a.notice_dest) if a.notice_dest else Path.cwd()
        for p in install_notices(root, dest, engine, engine_id):
            log(f"installed {p}")

    print("\n".join(lines[:40]))
    log(f"wrote {out}/RUST_PLAN.md, modules.csv, deps.csv, licenses.md, "
        f"unmapped.txt")
    return 0


if __name__ == "__main__":
    sys.exit(main())
