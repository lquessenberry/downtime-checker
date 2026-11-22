# globe-re

Automation that maps **open-source globe engines** into the native Rust globe
(`rust/crates/globe-native`). The point is to succeed Cesium, not to decompile
a proprietary Earth app.

```bash
python3 scripts/globe-re/globe_re.py engines
python3 scripts/globe-re/globe_re.py policy cesium
python3 scripts/globe-re/globe_re.py map --target cesium --emit-rust
python3 scripts/globe-re/globe_re.py plan
python3 -m unittest scripts/globe-re/tests/test_globe_re.py
```

CesiumJS is Apache-2.0. We read `Source/` from [CesiumGS/cesium](https://github.com/CesiumGS/cesium)
and write new Rust. We do **not** Ghidra minified `globalstatus/vendor/cesium/Cesium.js`.

## Engines (2026)

| Engine | Cost | Use |
| --- | --- | --- |
| **Ghidra** 12.x + GhidraMCP | free | Default. Headless + decompiler. Native / WASM. |
| **IDA Pro** + mrexodia MCP or Hex-Rays MCP (9.4+) | subscription | Cleanest decompiler. IDA Free: no IDAPython, no commercial. |
| **Binary Ninja** MCP | Personal $199 / Commercial $1799 | Automation-first. Free edition has no API. |
| **radare2 / Rizin** + Cutter / r2ai | free | Scripts, triage, embedded. |
| **Hopper** | paid Mac | ObjC / Swift shells. |
| **x64dbg** | GPL | Windows debug of a binary we own. |
| **Frida** MCP | free | Runtime: what the process does. |
| **jadx** MCP | free | Android. |
| **Published source** | free | **Preferred for Cesium / MapLibre / WorldWind.** |

Auto-pick: Ghidra if installed, else r2, else Binja, else IDA, else source.

The 2026 layer is an LLM agent talking to whichever engine you picked **through
an MCP server**, listing functions and following xrefs **one tool call at a
time**. Agents read and locate well. They do not hold a whole binary in view.
Do not ask the model to patch until a human has the function on screen.

There is no published head-to-head of IDA MCP vs GhidraMCP. Treat roundup star
counts as suspect.

## MCP endpoints this CLI probes

Override with env vars. Defaults:

| server | env | default |
| --- | --- | --- |
| ghidra | `GHIDRA_MCP_URL` | `http://127.0.0.1:8080/mcp` |
| ida | `IDA_MCP_URL` | `http://127.0.0.1:13337/mcp` |
| hexrays | `HEXRAYS_MCP_URL` | `http://127.0.0.1:11337/mcp` |
| binja | `BINJA_MCP_URL` | `http://127.0.0.1:9009/mcp` |
| r2 | `R2_MCP_URL` | `http://127.0.0.1:9393/mcp` |
| frida | `FRIDA_MCP_URL` | `http://127.0.0.1:27042/mcp` |
| jadx | `JADX_MCP_URL` | `http://127.0.0.1:8650/mcp` |
| rea | `REA_MCP_URL` | `http://127.0.0.1:8750/mcp` |

Zero-cost start: Ghidra + GhidraMCP. Example Cursor/Claude config:
`templates/mcp.example.json`.

```bash
python3 scripts/globe-re/globe_re.py probe
python3 scripts/globe-re/globe_re.py follow --function Ellipsoid
```

## Allowed targets

`cesium` (Apache-2.0), `worldwind`, `maplibre`, `osgearth` (LGPL — read, do not
link), `magnum`, `self` (our `downtime-globe`).

Refused: Google Earth, ArcGIS Pro, Apple Maps, Bing, Mapbox GL JS.

## Surrounding tools

binwalk, FLOSS, capa, tshark, angr, CAPE, GhidrAssist. `engines` prints which
are on PATH. Templates:

- `templates/ghidra_headless.py` — function/string dump after `analyzeHeadless`
- `templates/r2_triage.r2` — `r2 -i … downtime-globe`
- `templates/frida_hooks.js` — log `connect()` on our process

## Cesium source

```bash
python3 scripts/globe-re/globe_re.py inventory --clone-cesium /tmp/cesium-src
# or
git clone --depth 1 https://github.com/CesiumGS/cesium.git ~/src/cesium
CESIUM_SRC=~/src/cesium python3 scripts/globe-re/globe_re.py map --target cesium
```

## What `map --emit-rust` writes

Under `rust/crates/globe-native/src/engine/`:

`ellipsoid.rs` (WGS84 + ECEF + native-frame unit), `cartographic.rs`,
`imagery.rs`, `quadtree.rs`, `terrain.rs`, `primitives.rs`, `scene.rs`.

Live draw path stays `render.rs` + `globe_math.rs`. Engine modules fill in
one Cesium type at a time. Report: `docs/CESIUM_MAP.md`.

Do not port Cesium ion.
