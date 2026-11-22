#!/usr/bin/env python3
"""Lock the first-party blast radii so JS and Rust stay in the same ballpark."""
from __future__ import annotations

import math
import unittest


def rings(yield_kt: float, airburst: bool = True) -> dict[str, float]:
    s = max(0.0, float(yield_kt)) ** (1.0 / 3.0)
    air = 1.0 if airburst else 0.9
    fire_air = 1.0 if airburst else 0.75
    return {
        "fireballM": 90.0 * s * fire_air,
        "heavyM": 220.0 * s * air,
        "mediumM": 450.0 * s * (1.0 if airburst else 0.9),
        "lightM": 1100.0 * s * (1.0 if airburst else 0.9),
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


if __name__ == "__main__":
    unittest.main()
