"""Tools around the disassembler, not the disassembler itself.

capa answers "what can this binary do" before you open a function.
FLOSS recovers obfuscated strings. binwalk extracts firmware. Wireshark
shows what a live globe sends. angr is for symbolic / CTF work. CAPE is
a sandbox. GhidrAssist embeds an LLM inside Ghidra instead of driving it
over MCP.
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass


@dataclass
class SideTool:
    id: str
    title: str
    job: str
    binaries: tuple[str, ...]

    @property
    def present(self) -> bool:
        return any(shutil.which(name) for name in self.binaries)


def catalog() -> list[SideTool]:
    return [
        SideTool(
            "binwalk",
            "binwalk",
            "Firmware / image extraction before Ghidra sees a blob.",
            ("binwalk",),
        ),
        SideTool(
            "floss",
            "FLOSS",
            "Static string decoding (obfuscated C2, tile URLs, ion keys).",
            ("floss", "flare-floss"),
        ),
        SideTool(
            "capa",
            "capa",
            "Capability report: network, crypto, anti-debug. Run before reading functions.",
            ("capa",),
        ),
        SideTool(
            "wireshark",
            "Wireshark / tshark",
            "What the process actually sends (tile URLs, AIS, ADS-B).",
            ("tshark", "wireshark", "dumpcap"),
        ),
        SideTool(
            "angr",
            "angr",
            "Symbolic execution. CTF / small native puzzles, not CesiumJS.",
            ("angr",),
        ),
        SideTool(
            "cape",
            "CAPE sandbox",
            "Detonate a Windows globe .exe we own; extract config.",
            ("cape",),
        ),
        SideTool(
            "ghidrassist",
            "GhidrAssist / reverse-engineering-assistant",
            "LLM inside Ghidra rather than an external MCP client.",
            ("ghidrassist",),
        ),
    ]
