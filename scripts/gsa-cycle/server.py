#!/usr/bin/env python3
"""Fly status board for the bounded morning cycle. Public repo only."""
from __future__ import annotations

import json
import os
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

REPO = os.environ.get("GSA_REPO", "lquessenberry/downtime-checker")
ISSUE = os.environ.get("GSA_CYCLE_ISSUE", "75")
PORT = int(os.environ.get("PORT", "8080"))


def github_issue():
    url = f"https://api.github.com/repos/{REPO}/issues/{ISSUE}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "gsa-agile-cycle/1.0",
            "Accept": "application/vnd.github+json",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode())


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys_stderr = __import__("sys").stderr
        sys_stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, code, payload, ctype="application/json"):
        body = payload if isinstance(payload, (bytes, bytearray)) else json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ("/healthz", "/"):
            self._send(200, {"ok": True, "service": "gsa-agile-cycle", "max_cycles": 6})
            return
        if self.path == "/cycle":
            try:
                issue = github_issue()
            except Exception as err:
                self._send(502, {"error": str(err)})
                return
            self._send(200, {
                "issue": issue.get("number"),
                "title": issue.get("title"),
                "state": issue.get("state"),
                "html_url": issue.get("html_url"),
                "comments": issue.get("comments"),
                "updated_at": issue.get("updated_at"),
                "ftp": False,
                "auto_merge": False,
                "max_cycles": 6,
            })
            return
        self._send(404, {"error": "not found"})


if __name__ == "__main__":
    httpd = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"gsa-agile-cycle on {PORT}", flush=True)
    httpd.serve_forever()
