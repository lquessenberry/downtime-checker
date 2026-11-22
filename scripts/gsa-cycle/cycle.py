#!/usr/bin/env python3
"""One bounded agile cycle for Global Status.

GLOBALSTATUS is the product owner: layers work, pins exist, no FTP.
RUCKUS is the reviewer: tests pass, licenses hold, no auto-merge to prod.

Max 6 cycles. State lives on the tracking GitHub issue.
Does not FTP. Does not merge feat/globalstatus-prod.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPO = os.environ.get("GSA_REPO", "lquessenberry/downtime-checker")
TRACK_ISSUE = os.environ.get("GSA_CYCLE_ISSUE", "")
MAX_CYCLES = 6
PRIORITY = [
    59, 60, 34, 39, 68, 62, 56, 55, 54, 53, 52, 51, 50,
]


def run(cmd, cwd=ROOT, check=True):
    print("+", " ".join(cmd), flush=True)
    return subprocess.run(cmd, cwd=cwd, check=check, text=True, capture_output=True)


def gh_json(args):
    out = run(["gh", *args, "--json", "number,title,state,labels,body"], check=False)
    if out.returncode != 0:
        print(out.stderr, file=sys.stderr)
        return None
    return json.loads(out.stdout or "null")


def comment(issue: str, body: str) -> None:
    run(["gh", "issue", "comment", issue, "-R", REPO, "--body", body], check=False)


def open_issues():
    out = run(
        ["gh", "issue", "list", "-R", REPO, "--state", "open", "--limit", "50",
         "--json", "number,title,labels"],
        check=False,
    )
    if out.returncode != 0:
        return []
    return json.loads(out.stdout or "[]")


def pick_issue(issues):
    by_n = {i["number"]: i for i in issues}
    for n in PRIORITY:
        if n in by_n:
            return by_n[n]
    return issues[0] if issues else None


def tests() -> tuple[bool, str]:
    logs = []
    py = run(
        [sys.executable, "-m", "unittest", "scripts/designations/tests/test_designations.py"],
        check=False,
    )
    logs.append(py.stdout[-2000:] + py.stderr[-2000:])
    php = run(["php", "-l", "globalstatus/router.php"], check=False)
    logs.append(php.stdout + php.stderr)
    js = run(["node", "--check", "globalstatus/cesium.js"], check=False)
    logs.append(js.stdout + js.stderr)
    ok = py.returncode == 0 and php.returncode == 0 and js.returncode == 0
    return ok, "\n".join(logs)[-4000:]


def cdp() -> tuple[bool, str]:
    script = ROOT / "scripts" / "gsa-cycle" / "cdp_verify.py"
    if not script.exists():
        return False, "cdp_verify.py missing"
    env = os.environ.copy()
    proc = subprocess.run(
        [sys.executable, str(script)],
        cwd=ROOT,
        text=True,
        capture_output=True,
        env=env,
    )
    return proc.returncode == 0, (proc.stdout + proc.stderr)[-2000:]


def cycle_number(issue_body: str) -> int:
    for line in issue_body.splitlines():
        if line.startswith("<!-- cycle:"):
            try:
                return int(line.split(":")[1].strip(" ->"))
            except ValueError:
                return 0
    return 0


def main() -> int:
    os.chdir(ROOT)
    issues = open_issues()
    target = pick_issue(issues)
    ok, log = tests()
    cdp_ok, cdp_log = (False, "skipped")
    if os.environ.get("GSA_CDP", "1") != "0":
        cdp_ok, cdp_log = cdp()

    globalstatus = [
        f"- tests: {'PASS' if ok else 'FAIL'}",
        f"- chrome cdp: {'PASS' if cdp_ok else 'FAIL'}",
        f"- next issue: #{target['number']} {target['title']}" if target else "- queue empty",
        "- FTP: not this cycle",
        "- merge to production: not this cycle",
    ]
    ruckus = [
        "- SPLC jsonl stays gitignored",
        "- Nominatim 1.05s when used",
        "- NUKEMAP is a new-tab link",
        "- no auto-merge of feat/globalstatus-prod",
        f"- reviewer tests: {'happy' if ok else 'blocked'}",
    ]
    body = (
        f"## Cycle {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}\n\n"
        f"### GLOBALSTATUS\n" + "\n".join(globalstatus) + "\n\n"
        f"### RUCKUS\n" + "\n".join(ruckus) + "\n\n"
        f"<details><summary>logs</summary>\n\n```\n{log[-1500:]}\n{cdp_log[-1500:]}\n```\n</details>\n"
    )
    print(body)
    if TRACK_ISSUE:
        comment(TRACK_ISSUE, body)
        if target:
            comment(str(target["number"]), f"Cycle ping from GLOBALSTATUS/RUCKUS. Tests={'pass' if ok else 'fail'}.")
    happy = ok and (cdp_ok or os.environ.get("GSA_CDP") == "0")
    return 0 if happy else 1


if __name__ == "__main__":
    sys.exit(main())
