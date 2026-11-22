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
    print("Analysis engines\n")
    print(f"{'id':10} {'present':8} {'cost':28} mcp")
    for eng in engines.catalog():
        flag = "yes" if eng.present else "no"
        print(f"{eng.id:10} {flag:8} {eng.cost[:28]:28} {eng.mcp}")
        print(f"           {eng.title}")
        print(f"           {eng.when}")
        if eng.found:
            print(f"           PATH: {', '.join(eng.found)}")
        print()
    print("Surrounding workflow\n")
    for tool in surrounding.catalog():
        flag = "yes" if tool.present else "no"
        print(f"{tool.id:12} {flag:8} {tool.job}")
    print()
    picked = engines.pick("auto")
    print(f"auto pick → {picked.id} ({picked.title})")
    print(
        "MCP default URLs: "
        + ", ".join(f"{k}={v}" for k, v in mcp_bridge.DEFAULT_ENDPOINTS.items())
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


def cmd_probe(args: argparse.Namespace) -> None:
    session = mcp_bridge.Session(engine=args.engine or "auto")
    servers = (
        [args.engine]
        if args.engine in mcp_bridge.DEFAULT_ENDPOINTS
        else list(mcp_bridge.DEFAULT_ENDPOINTS)
    )
    print("Probing MCP endpoints (tools/list). Timeout 2.5s each.\n")
    for server in servers:
        call = mcp_bridge.probe(session, server)
        mark = "UP" if call.ok else "down"
        print(f"  [{mark:4}] {server:8} {call.detail}")
    print()
    up = sum(1 for c in session.calls if c.ok)
    print(f"{up}/{len(session.calls)} listening.")
    print(
        "Agents are strong at one function and weak at whole-binary context. "
        "Use `follow --function NAME` next."
    )
    if args.json:
        Path(args.json).write_text(json.dumps(session.as_dict(), indent=2) + "\n", encoding="utf-8")


def cmd_follow(args: argparse.Namespace) -> None:
    name = args.function
    if not name:
        _die("follow needs --function NAME")
    session = mcp_bridge.Session(engine=args.engine or "auto")
    server = args.engine if args.engine in mcp_bridge.DEFAULT_ENDPOINTS else "ghidra"
    calls = mcp_bridge.follow_function(session, server, name)
    mcp_hit = any(c.ok for c in calls)
    print(f"Follow {name!r} via {server} MCP ({'hit' if mcp_hit else 'no listener'})\n")
    for call in calls:
        mark = "ok" if call.ok else "—"
        print(f"  [{mark}] {call.method}: {call.detail}")

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
        payload = session.as_dict()
        payload["function"] = name
        Path(args.json).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


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
    engine = engines.pick(args.engine)
    print(f"target={target}  engine={engine.id} ({engine.title})")
    if not engine.present and engine.id != "source":
        print(f"warning: {engine.id} is not on PATH; source-map still runs.")

    session = mcp_bridge.Session(engine=engine.id)
    mcp_lines = []
    for server in mcp_bridge.DEFAULT_ENDPOINTS:
        call = mcp_bridge.probe(session, server)
        url = mcp_bridge.DEFAULT_ENDPOINTS[server]
        if call.ok:
            mcp_lines.append(f"- `{server}`: listening — {call.detail}")
        else:
            mcp_lines.append(f"- `{server}`: down (`{url}`)")
    mcp_summary = "## MCP this run\n\n" + "\n".join(mcp_lines)

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
    print("Do not Ghidra vendor/cesium/Cesium.js — clone Source/.")


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
