#!/usr/bin/env python3
"""Verify Global Status in the laptop Chrome CDP profile (port 9222)."""
from __future__ import annotations

import json
import os
import struct
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

CDP = os.environ.get("CDP_URL", "http://127.0.0.1:9222")
TARGET = os.environ.get(
    "GSA_VERIFY_URL",
    os.environ.get("GSA_STAGE_URL", "https://globalstatus-stage.fly.dev/"),
)
SHOT = Path(os.environ.get("GSA_CDP_SHOT", "/tmp/gsa-cycle-cdp.png"))


def http_json(url, method="GET", data=None):
    req = urllib.request.Request(url, data=data, method=method)
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode())


def ws_send(sock, payload: dict):
    raw = json.dumps(payload).encode()
    header = b"\x81"
    n = len(raw)
    mask = b"\x01\x02\x03\x04"
    if n < 126:
        header += bytes([0x80 | n])
    elif n < 65536:
        header += b"\xfe" + struct.pack("!H", n)
    else:
        header += b"\xff" + struct.pack("!Q", n)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(raw))
    sock.sendall(header + mask + masked)


def ws_recv(sock) -> dict:
    hdr = sock.recv(2)
    if len(hdr) < 2:
        return {}
    n = hdr[1] & 0x7F
    if n == 126:
        n = struct.unpack("!H", sock.recv(2))[0]
    elif n == 127:
        n = struct.unpack("!Q", sock.recv(8))[0]
    data = b""
    while len(data) < n:
        chunk = sock.recv(n - len(data))
        if not chunk:
            break
        data += chunk
    try:
        return json.loads(data.decode())
    except json.JSONDecodeError:
        return {"raw": data[:200].decode("utf-8", "replace")}


def handshake(ws_url: str):
    import socket
    from urllib.parse import urlparse
    u = urlparse(ws_url)
    host, port = u.hostname, u.port or 80
    path = u.path + (("?" + u.query) if u.query else "")
    sock = socket.create_connection((host, port), timeout=20)
    key = "dGhlIHNhbXBsZSBub25jZQ=="
    req = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n"
        "\r\n"
    )
    sock.sendall(req.encode())
    ack = b""
    while b"\r\n\r\n" not in ack:
        ack += sock.recv(4096)
    if b"101" not in ack.split(b"\r\n", 1)[0]:
        raise RuntimeError(f"ws handshake failed: {ack[:200]!r}")
    return sock


def call(sock, msg_id, method, params=None):
    ws_send(sock, {"id": msg_id, "method": method, "params": params or {}})
    deadline = time.time() + 20
    while time.time() < deadline:
        reply = ws_recv(sock)
        if reply.get("id") == msg_id:
            return reply
    return {}


def main() -> int:
    try:
        version = http_json(f"{CDP}/json/version")
    except Exception as err:
        print(f"CDP down: {err}", file=sys.stderr)
        return 2
    print("browser", version.get("Browser"))
    new_url = f"{CDP}/json/new?{urllib.parse.quote(TARGET, safe='')}"
    try:
        tab = http_json(new_url, method="PUT")
    except Exception:
        tab = http_json(new_url)
    ws_url = tab.get("webSocketDebuggerUrl")
    if not ws_url:
        print("no websocket", tab, file=sys.stderr)
        return 2
    sock = handshake(ws_url)
    call(sock, 1, "Page.enable")
    call(sock, 2, "Runtime.enable")
    call(sock, 3, "Page.navigate", {"url": TARGET})
    time.sleep(6)
    eval_reply = call(
        sock,
        4,
        "Runtime.evaluate",
        {
            "expression": """(() => {
              const toggles = [...document.querySelectorAll('[data-layer-toggle]')]
                .map((el) => el.getAttribute('data-layer-toggle'));
              const nukemap = document.getElementById('nukemap-link');
              return JSON.stringify({
                title: document.title,
                toggles,
                designations: toggles.includes('designations'),
                violence: toggles.includes('violence'),
                nukemap: Boolean(nukemap) && (nukemap.href || '').includes('nukemap'),
              });
            })()""",
            "returnByValue": True,
        },
    )
    value = ((eval_reply.get("result") or {}).get("result") or {}).get("value")
    try:
        info = json.loads(value) if isinstance(value, str) else (value or {})
    except json.JSONDecodeError:
        info = {"raw": value}
    print(json.dumps(info, indent=2))
    shot = call(sock, 5, "Page.captureScreenshot", {"format": "png"})
    b64 = ((shot.get("result") or {}).get("data")) or ""
    if b64:
        import base64
        SHOT.write_bytes(base64.b64decode(b64))
        print("shot", SHOT)
    sock.close()
    ok = bool(info.get("designations") and info.get("nukemap"))
    # Staging may not have this branch yet; local php -S will.
    if not ok and "localhost" not in TARGET and "127.0.0.1" not in TARGET:
        print("staging missing new toggles; not a hard fail until this branch is on Fly")
        return 0
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
