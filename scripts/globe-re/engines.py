"""Analysis engines the LLM agent can drive, one tool call at a time.

Pick order (2026):
  Ghidra          — default, free, headless, GhidraMCP
  IDA Pro         — paid, cleanest decompiler, official MCP on 9.4+
  Binary Ninja    — automation-first, headless on Commercial
  radare2 / Rizin — shell and scripts
  Hopper          — macOS ObjC/Swift
  x64dbg          — Windows debug
  Frida           — live process (what the code does)
  jadx            — Android Java/Kotlin
"""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass, field


@dataclass
class Engine:
    id: str
    title: str
    cost: str
    binaries: tuple[str, ...]
    mcp: str
    when: str
    found: list[str] = field(default_factory=list)

    @property
    def present(self) -> bool:
        return bool(self.found)


def _which_any(names: tuple[str, ...]) -> list[str]:
    hits = []
    for name in names:
        path = shutil.which(name)
        if path:
            hits.append(path)
        elif os.path.exists(name):
            hits.append(name)
    extra_dirs = [
        "/opt/ghidra",
        "/usr/local/ghidra",
        os.path.expanduser("~/ghidra"),
        "/Applications/Hopper Disassembler v5.app",
        "/Applications/IDA Professional 9.4.app",
        "/Applications/Binary Ninja.app",
        "/Applications/Cutter.app",
    ]
    for d in extra_dirs:
        if os.path.exists(d) and d not in hits:
            for name in names:
                if name.lower() in d.lower():
                    hits.append(d)
    return hits


def catalog() -> list[Engine]:
    engines = [
        Engine(
            id="ghidra",
            title="Ghidra 12.x (NSA, Apache-2.0)",
            cost="free",
            binaries=("ghidraRun", "analyzeHeadless", "ghidra"),
            mcp="GhidraMCP (LaurieWired) — decompile, list functions, rename in a live instance",
            when="Default. JS/Java globes still use source mapping; Ghidra is for native/WASM.",
        ),
        Engine(
            id="ida",
            title="IDA Pro / IDA Home / IDA Free",
            cost="Pro ~€1099/yr, Home €365/yr, Free x86/x64 cloud decompiler",
            binaries=("ida64", "idat64", "idat", "ida"),
            mcp="mrexodia IDA Pro MCP (8.3+); Hex-Rays official MCP (9.4+). IDA Free: no IDAPython.",
            when="Optimized native. Do not use IDA Free for commercial Global Status work.",
        ),
        Engine(
            id="binja",
            title="Binary Ninja",
            cost="Free (no API), Personal $199, Commercial $1799 + headless",
            binaries=("binaryninja", "binary-ninja"),
            mcp="Binary Ninja MCP plugin, headless variant on Commercial",
            when="Automation-heavy research. Free edition cannot drive this script.",
        ),
        Engine(
            id="r2",
            title="radare2 / Rizin + Cutter",
            cost="free",
            binaries=("r2", "radare2", "rizin", "rz-bin", "cutter"),
            mcp="radare2 MCP / r2ai",
            when="Scripting, triage, embedded. Cutter can load rz-ghidra.",
        ),
        Engine(
            id="hopper",
            title="Hopper (macOS)",
            cost="paid Mac-native",
            binaries=("hopper", "Hopper"),
            mcp="Hopper integrated MCP",
            when="Objective-C / Swift globe shells on macOS.",
        ),
        Engine(
            id="x64dbg",
            title="x64dbg",
            cost="GPL-3.0",
            binaries=("x64dbg", "x32dbg"),
            mcp="none first-party",
            when="Windows live debug of a globe .exe we own.",
        ),
        Engine(
            id="frida",
            title="Frida",
            cost="free",
            binaries=("frida", "frida-trace", "frida-ps"),
            mcp="Frida MCP — runtime hooks",
            when="Answers what the process does. Use on downtime-globe, not on a random Earth.app.",
        ),
        Engine(
            id="jadx",
            title="jadx",
            cost="free",
            binaries=("jadx", "jadx-gui"),
            mcp="jadx MCP — Java/Kotlin, manifest, refs",
            when="Android APK of WorldWind or our GlobalStatus.apk.",
        ),
        Engine(
            id="source",
            title="Published source tree (preferred for Cesium)",
            cost="free",
            binaries=("git",),
            mcp="none — the agent reads files",
            when="Cesium, MapLibre, WorldWind. Ghidra on minified Cesium.js is a waste.",
        ),
    ]
    for engine in engines:
        engine.found = _which_any(engine.binaries)
    return engines


def pick(preference: str = "auto") -> Engine:
    engines = {e.id: e for e in catalog()}
    if preference != "auto":
        if preference not in engines:
            raise SystemExit(f"unknown engine {preference!r}")
        return engines[preference]
    for key in ("ghidra", "r2", "binja", "ida", "hopper", "frida", "jadx", "source"):
        if engines[key].present or key == "source":
            return engines[key]
    return engines["source"]
