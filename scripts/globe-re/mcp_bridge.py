"""Talk to a reverse-engineering MCP server the way a 2026 agent does:

    list functions → decompile one → follow xrefs → rename → next

Agents are strong at a single thread and weak at holding the whole binary.
This bridge never dumps a whole program into one prompt. Each call is one
function, one string, or one xref list.

No RE MCP is wired in this Grok session by default. The bridge:
  1. probes GhidraMCP / IDA / Binja / r2 / Frida / jadx / REA endpoints
  2. records a session journal the rebuild planner consumes
  3. falls back to source-mapping when nothing is listening
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any

DEFAULT_ENDPOINTS = {
    "ghidra": os.environ.get("GHIDRA_MCP_URL", "http://127.0.0.1:8080/mcp"),
    "ida": os.environ.get("IDA_MCP_URL", "http://127.0.0.1:13337/mcp"),
    "hexrays": os.environ.get("HEXRAYS_MCP_URL", "http://127.0.0.1:11337/mcp"),
    "binja": os.environ.get("BINJA_MCP_URL", "http://127.0.0.1:9009/mcp"),
    "r2": os.environ.get("R2_MCP_URL", "http://127.0.0.1:9393/mcp"),
    "frida": os.environ.get("FRIDA_MCP_URL", "http://127.0.0.1:27042/mcp"),
    "jadx": os.environ.get("JADX_MCP_URL", "http://127.0.0.1:8650/mcp"),
    "rea": os.environ.get("REA_MCP_URL", "http://127.0.0.1:8750/mcp"),
}


@dataclass
class McpCall:
    server: str
    method: str
    ok: bool
    detail: str
    data: Any = None


@dataclass
class Session:
    engine: str
    calls: list[McpCall] = field(default_factory=list)

    def record(self, call: McpCall) -> McpCall:
        self.calls.append(call)
        return call

    def as_dict(self) -> dict:
        return {
            "engine": self.engine,
            "calls": [
                {
                    "server": c.server,
                    "method": c.method,
                    "ok": c.ok,
                    "detail": c.detail,
                    "data": c.data,
                }
                for c in self.calls
            ],
            "note": (
                "Agents read and locate well and hold the whole binary poorly. "
                "Keep following one xref chain. Do not ask the model to patch "
                "until a human has the function in view."
            ),
        }


def _post_json(url: str, payload: dict, timeout: float = 2.5) -> tuple[bool, Any, str]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", "replace")
            try:
                return True, json.loads(raw), f"http {resp.status}"
            except json.JSONDecodeError:
                return True, raw[:2000], f"http {resp.status} (not json)"
    except urllib.error.HTTPError as err:
        return False, None, f"http {err.code}"
    except Exception as err:  # noqa: BLE001 — probe must never crash the CLI
        return False, None, str(err)


def probe(session: Session, server: str) -> McpCall:
    url = DEFAULT_ENDPOINTS.get(server, "")
    ok, data, detail = _post_json(
        url,
        {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
    )
    return session.record(
        McpCall(
            server=server,
            method="tools/list",
            ok=ok,
            detail=f"{url} → {detail}",
            data=data if ok else None,
        )
    )


def follow_function(session: Session, server: str, name: str) -> list[McpCall]:
    """One function at a time: decompile, then xrefs. Never the whole binary."""
    url = DEFAULT_ENDPOINTS.get(server, "")
    out = []
    for method, params in (
        ("decompile_function", {"name": name}),
        ("list_xrefs", {"name": name}),
        ("list_strings", {"filter": name, "limit": 20}),
    ):
        ok, data, detail = _post_json(
            url,
            {"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
        )
        out.append(
            session.record(
                McpCall(
                    server=server,
                    method=method,
                    ok=ok,
                    detail=f"{name}: {detail}",
                    data=data if ok else None,
                )
            )
        )
    return out
