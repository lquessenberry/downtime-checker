#!/usr/bin/env python3
"""Map open-source globe engines into a new Rust globe.

Zero-cost default: read Cesium `Source/` (Apache-2.0) and emit `globe-native`
engine stubs. If Ghidra / radare2 / IDA / Binary Ninja / Frida MCP is listening,
the same CLI drives it **one function at a time**.

    python3 scripts/globe-re/globe_re.py engines
    python3 scripts/globe-re/globe_re.py map --target cesium --emit-rust
    python3 scripts/globe-re/globe_re.py probe
    python3 scripts/globe-re/globe_re.py follow --function Ellipsoid

Engines (pick order): Ghidra → r2/Rizin → Binary Ninja → IDA → Hopper →
Frida → jadx → published source. CesiumJS is JavaScript: Ghidra on minified
`vendor/cesium/Cesium.js` is a waste; clone CesiumGS/cesium and read Source/.

Legal: Cesium, WorldWind, MapLibre, osgEarth (read-only, LGPL), Magnum, and
our own `downtime-globe` binary. Google Earth / ArcGIS / Apple Maps / Bing /
Mapbox GL JS are refused.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import cesium_source  # noqa: E402
import emit_report  # noqa: E402
import emit_rust  # noqa: E402
import engines  # noqa: E402
import knowledge  # noqa: E402
import mcp_bridge  # noqa: E402
import policy  # noqa: E402
import surrounding  # noqa: E402

REPO = HERE.parents[1]
CRATE_SRC = REPO / "rust" / "crates" / "globe-native" / "src"
MAP_PATH = REPO / "docs" / "CESIUM_MAP.md"


def _die(msg: str, code: int = 2) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(code)


def cmd_engines(_args: argparse.Namespace) -> None:
    import globe_plan
    print("Permissive source engines (the ingest gate)\n")
    print(f"{'id':16} {'spdx':16} label")
    for key, meta in globe_plan.ENGINES.items():
        print(f"{key:<16}{meta['spdx']:<16}{meta['label']}")
    print("\nRefused:")
    for key, why in globe_plan.REFUSE.items():
        print(f"  {key}: {why}")
    print(
        "\nBinary backends are declared and unimplemented. "
        "`globe_plan.py --binary` exits 2 until a target with no source appears."
    )


def cmd_policy(args: argparse.Namespace) -> None:
    if args.target:
        reason = policy.refuse_reason(args.target)
        if reason:
            _die(reason, 3)
        meta = policy.ALLOWED_TARGETS[args.target.strip().lower()]
        print(json.dumps({"target": args.target, "allowed": True, **meta}, indent=2))
        return
    print("Allowed targets\n")
    for key, meta in policy.ALLOWED_TARGETS.items():
        print(f"- {key}: {meta['license']}")
        print(f"    {meta['repo']}")
        print(f"    {meta['notes']}")
    print("\nRefused substrings:", ", ".join(policy.REFUSED_SUBSTRINGS))


def _guard(target: str) -> str:
    reason = policy.refuse_reason(target)
    if reason:
        _die(reason, 3)
    return target.strip().lower()


def cmd_probe(_args: argparse.Namespace) -> None:
    import globe_plan
    raise SystemExit(globe_plan.binary_mode(REPO))


def cmd_follow(args: argparse.Namespace) -> None:
    name = args.function
    if not name:
        _die("follow needs --function NAME")
    print("Source follow only. Binary MCP is unimplemented; use globe_plan.py.\n")
    source = cesium_source.locate(args.cesium_src, REPO)
    if source:
        extracted = cesium_source.extract_symbol(source, name)
        print(f"\nSource map under {source} — {len(extracted['matches'])} file(s)")
        for match in extracted["matches"]:
            print(f"\n## {match['file']} ({match['chars']} chars)\n")
            print(match["snippet"][:2000])
            print()
    else:
        print("\nNo Cesium Source/ tree. Rows from knowledge.py:\n")
        for mod in knowledge.MODULES:
            if name.lower() in " ".join(mod["cesium"]).lower() or name.lower() in mod["id"]:
                print(json.dumps(mod, indent=2))
    print(
        "\nNext: implement that type in rust/crates/globe-native/src/engine/ "
        "and re-run `map --emit-rust` only if the stub is still missing."
    )
    if args.json:
        Path(args.json).write_text(json.dumps({"function": name}, indent=2) + "\n", encoding="utf-8")


def cmd_inventory(args: argparse.Namespace) -> None:
    _guard(args.target or "cesium")
    source = cesium_source.locate(args.cesium_src, REPO)
    if source is None and args.clone_cesium:
        dest = Path(args.clone_cesium)
        print(f"sparse-cloning CesiumGS/cesium into {dest} …")
        source = cesium_source.clone_sparse(dest)
    if source is None:
        _die(
            "No Cesium Source/ tree. Clone https://github.com/CesiumGS/cesium "
            "and pass --cesium-src, or set CESIUM_SRC, or use "
            "--clone-cesium /tmp/cesium-src"
        )
    inv = cesium_source.inventory(source)
    print(json.dumps(inv, indent=2))
    if args.json:
        cesium_source.dump_json(inv, Path(args.json))


def cmd_map(args: argparse.Namespace) -> None:
    target = _guard(args.target)
    engine = engines.pick("source")
    print(f"target={target}  inventory via globe_plan.py; this command emits stubs")
    mcp_summary = (
        "## Binary backends\n\n"
        "Unimplemented by design. CesiumJS has source. "
        "`python3 scripts/globe-re/globe_plan.py --binary` exits 2.\n"
    )

    cesium_inv = None
    if target == "cesium":
        source = cesium_source.locate(args.cesium_src, REPO)
        if source is None and args.clone_cesium:
            print(f"sparse-cloning CesiumGS/cesium into {args.clone_cesium} …")
            source = cesium_source.clone_sparse(Path(args.clone_cesium))
        if source is not None:
            cesium_inv = cesium_source.inventory(source)
            print(
                f"Cesium Source/ at {source}: {cesium_inv['js_files']} js files, "
                f"{len(cesium_inv['symbol_hits'])} symbol hits"
            )
        else:
            print("Cesium Source/ not on disk — mapping from knowledge.py (Apache-2.0 types).")

    rust_files: list[str] = []
    if args.emit_rust:
        dest = Path(args.crate_src) if args.crate_src else CRATE_SRC
        rust_files = emit_rust.write_engine(dest)
        print("wrote engine stubs:")
        for path in rust_files:
            print(f"  {path}")

    report = emit_report.write(
        MAP_PATH,
        engine=engine,
        mcp_summary=mcp_summary,
        cesium_inv=cesium_inv,
        rust_files=rust_files,
    )
    print(f"wrote {report}")

    print("\nPriority-1 gaps:")
    for mod in knowledge.by_priority():
        if mod["priority"] != 1:
            continue
        print(f"  [{mod['status']}] {mod['id']:20} → {mod['rust']}")
    print(
        "\nFollow one thread: python3 scripts/globe-re/globe_re.py follow "
        "--function Ellipsoid"
    )


def cmd_plan(_args: argparse.Namespace) -> None:
    print("# Rebuild order (goal-backward from succeed-Cesium)\n")
    print("Native already has: unit sphere, Blue Marble JPEG, orbit camera, egui pins.")
    print("Cesium still wins on: XYZ, terrain, 2D, live layers, spiderweb, poller.\n")
    print("| step | Cesium type | rust file | why |")
    print("| --- | --- | --- | --- |")
    steps = [
        ("1", "Ellipsoid.WGS84 + Cartographic", "engine/ellipsoid.rs, cartographic.rs", "ECEF meters; mesh is still a sphere"),
        ("2", "UrlTemplateImageryProvider", "engine/imagery.rs + render.rs", "switchable XYZ / GIBS / OSM / night"),
        ("3", "QuadtreeTile / GlobeSurfaceTile", "engine/quadtree.rs", "LOD; stop drawing one UV sphere"),
        ("4", "TerrainProvider", "engine/terrain.rs", "Esri / Terrarium height"),
        ("5", "SceneMode.SCENE2D", "engine/scene.rs + globe_math.rs", "Android flat map, keepFlatMapIntact"),
        ("6", "PointPrimitiveCollection", "engine/primitives.rs", "20k AIR + 20k AIS at 60 fps"),
        ("7", "GSA layers + poller", "downtime-core layer.rs", "one-user cache, #34"),
        ("8", "CameraFlightPath / inertia", "globe_math.rs OrbitCamera", "feel"),
    ]
    for row in steps:
        print("| " + " | ".join(row) + " |")
    print("\nSkip: Cesium ion, Entity convenience API for AIR/AIS, minified Cesium.js.")
    print("Inventory: python3 scripts/globe-re/globe_plan.py --repo <cesium> --engine cesiumjs")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="globe_re.py",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument(
        "--engine",
        default="auto",
        help="ghidra | ida | binja | r2 | hopper | frida | jadx | source | auto",
    )
    p.add_argument("--cesium-src", help="Path to CesiumGS/cesium or its Source/ directory")
    p.add_argument("--json", help="Write a session / inventory JSON next to the human report")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("engines", help="List engines, MCP URLs, surrounding tools")
    pol = sub.add_parser("policy", help="Show allowlist or check one target")
    pol.add_argument("target", nargs="?")
    sub.add_parser("probe", help="tools/list against every MCP endpoint")
    fol = sub.add_parser("follow", help="One function: decompile + xrefs (MCP) or Source/ extract")
    fol.add_argument("--function", required=True)
    inv = sub.add_parser("inventory", help="Walk Cesium Source/ for globe types")
    inv.add_argument("--target", default="cesium")
    inv.add_argument("--clone-cesium", metavar="DIR", help="Sparse-clone CesiumGS/cesium into DIR")
    mp = sub.add_parser("map", help="Write docs/CESIUM_MAP.md and optionally engine stubs")
    mp.add_argument("--target", default="cesium")
    mp.add_argument("--emit-rust", action="store_true")
    mp.add_argument("--crate-src", help="Override rust/crates/globe-native/src")
    mp.add_argument("--clone-cesium", metavar="DIR")
    sub.add_parser("plan", help="Print the rebuild order")
    return p


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    cmds = {
        "engines": cmd_engines,
        "policy": cmd_policy,
        "probe": cmd_probe,
        "follow": cmd_follow,
        "inventory": cmd_inventory,
        "map": cmd_map,
        "plan": cmd_plan,
    }
    cmds[args.cmd](args)


if __name__ == "__main__":
    main()
