#!/usr/bin/env python3
"""Lock the first-party blast radii so JS, Python and Rust stay in step.

`rings()` below is the reference. `JsParityTests` loads the shipped
`globalstatus/blast.js` in Node and checks it returns the same numbers, so a
change to the browser math cannot pass CI unnoticed. Skipped only when Node is
not installed.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BLAST_JS = ROOT / "globalstatus" / "blast.js"
CASES = [(1, True), (15, True), (15, False), (300, True), (1000, True), (5000, False)]
KEYS = ("fireballM", "heavyM", "mediumM", "lightM", "thermalM", "falloutM")


def rings(yield_kt: float, airburst: bool = True) -> dict[str, float]:
    s = max(0.001, float(yield_kt)) ** (1.0 / 3.0)
    air = 1.0 if airburst else 0.9
    fire_air = 1.0 if airburst else 0.75
    return {
        "fireballM": 90.0 * s * fire_air,
        "heavyM": 220.0 * s * air,
        "mediumM": 450.0 * s * air,
        "lightM": 1100.0 * s * air,
        "thermalM": 650.0 * s * (1.1 if airburst else 0.7),
        "falloutM": 0.0 if airburst else 1100.0 * s * 0.9 * 6,
    }


class BlastTests(unittest.TestCase):
    def test_15kt_airburst_is_city_scale_not_continent(self):
        r = rings(15, True)
        self.assertGreater(r["lightM"], 2000)
        self.assertLess(r["lightM"], 4000)
        self.assertGreater(r["fireballM"], 150)
        self.assertLess(r["fireballM"], 400)
        self.assertEqual(r["falloutM"], 0)

    def test_ground_burst_adds_fallout_footprint(self):
        air = rings(15, True)
        ground = rings(15, False)
        self.assertGreater(ground["falloutM"], air["lightM"])
        self.assertLess(ground["fireballM"], air["fireballM"])

    def test_cube_root_scaling(self):
        one = rings(1, True)
        mt = rings(1000, True)
        self.assertAlmostEqual(mt["lightM"] / one["lightM"], 10.0, places=2)


@unittest.skipUnless(shutil.which("node"), "node not installed")
class JsParityTests(unittest.TestCase):
    def js_rings(self) -> list[dict]:
        script = (
            "globalThis.window = globalThis;"
            f"require({json.dumps(str(BLAST_JS))});"
            f"const cases = {json.dumps(CASES)};"
            "process.stdout.write(JSON.stringify(cases.map(([kt, air]) => GsaBlast.rings(kt, air))));"
        )
        out = subprocess.run(["node", "-e", script], check=True, capture_output=True, text=True, timeout=30)
        return json.loads(out.stdout)

    def test_blast_js_matches_reference(self):
        for (kt, air), got in zip(CASES, self.js_rings()):
            want = rings(kt, air)
            for key in KEYS:
                with self.subTest(kt=kt, airburst=air, key=key):
                    self.assertAlmostEqual(got[key], want[key], delta=max(0.01, want[key] * 1e-9))


if __name__ == "__main__":
    unittest.main()
