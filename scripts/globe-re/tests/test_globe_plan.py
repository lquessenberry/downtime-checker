#!/usr/bin/env python3
"""Inventory/disposition tests. No disassembler required."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

import globe_plan  # noqa: E402

FIXTURE = HERE / "tests" / "fixtures" / "mini-cesium"


class RefuseTests(unittest.TestCase):
    def test_maplibre_allowed(self):
        self.assertIsNone(globe_plan.refuse_engine("maplibre-gl"))
        self.assertEqual(globe_plan.ENGINES["maplibre-gl"]["spdx"], "BSD-3-Clause")

    def test_mapbox_refused(self):
        for name in ("mapbox-gl", "mapbox", "mapbox-gl-js", "mapboxgl"):
            reason = globe_plan.refuse_engine(name)
            self.assertIsNotNone(reason, name)
            self.assertIn("proprietary", reason.lower())

    def test_osgearth_lgpl_refused(self):
        reason = globe_plan.refuse_engine("osgearth")
        self.assertIsNotNone(reason)
        self.assertIn("LGPL", reason)

    def test_cli_mapbox_exits_1(self):
        self.assertEqual(globe_plan.main(["--engine", "mapbox-gl", "--repo", str(FIXTURE)]), 1)


class ClassifyTests(unittest.TestCase):
    def test_core_geodesy_ports(self):
        role, home, disp, _ = globe_plan.classify("Source/Core/Ellipsoid.js")
        self.assertEqual(role, "geodesy")
        self.assertEqual(disp, "port")
        self.assertIn("glam", globe_plan.classify("Source/Core/Cartesian3.js")[1])
        self.assertEqual(
            globe_plan.classify("packages/core/Source/Cartesian3.js")[0], "math3d"
        )
        self.assertEqual(
            globe_plan.classify("packages/core/Source/Ellipsoid.js")[0], "geodesy"
        )

    def test_renderer_deleted(self):
        self.assertEqual(globe_plan.classify("Source/Renderer/Context.js")[2], "delete")

    def test_widgets_deleted(self):
        self.assertEqual(globe_plan.classify("Source/Widgets/Viewer.js")[2], "delete")

    def test_globe_rewritten(self):
        self.assertEqual(globe_plan.classify("Source/Scene/Globe.js")[2], "rewrite")

    def test_entity_deferred(self):
        self.assertEqual(globe_plan.classify("Source/DataSources/Entity.js")[2], "defer")

    def test_shader_is_rewrite_not_port(self):
        role, _, disp, note = globe_plan.classify("Source/Shaders/GlobeFS.glsl")
        self.assertEqual(role, "shader")
        self.assertEqual(disp, "rewrite")
        self.assertIn("WGSL", note)


class ScanTests(unittest.TestCase):
    def test_fixture_dispositions(self):
        engine = globe_plan.ENGINES["cesiumjs"]
        modules, deps = globe_plan.scan_sources(FIXTURE, engine)
        by_path = {m["path"].replace("\\", "/"): m for m in modules}
        self.assertEqual(by_path["Source/Core/Ellipsoid.js"]["disposition"], "port")
        self.assertEqual(by_path["Source/Renderer/Context.js"]["disposition"], "delete")
        self.assertEqual(by_path["Source/Widgets/Viewer.js"]["disposition"], "delete")
        self.assertEqual(by_path["Source/Scene/Globe.js"]["disposition"], "rewrite")
        self.assertEqual(by_path["Source/DataSources/Entity.js"]["disposition"], "defer")
        self.assertEqual(by_path["Source/Shaders/GlobeFS.glsl"]["disposition"], "rewrite")
        internals = [d for d in deps if not d["to"].startswith("external::")]
        self.assertTrue(internals)

    def test_license_inventory_finds_notice(self):
        inv = globe_plan.scan_licenses(FIXTURE)
        self.assertTrue(inv["license"])
        self.assertTrue(inv["notice"])
        report = "\n".join(globe_plan.license_report(FIXTURE, globe_plan.ENGINES["cesiumjs"]))
        self.assertIn("§4(d)", report)
        self.assertIn("derivative", report.lower())

    def test_no_license_refuses_ingest(self):
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "Source").mkdir()
            rc = globe_plan.main(["--repo", tmp, "--engine", "cesiumjs"])
            self.assertEqual(rc, 1)

    def test_binary_mode_exits_2(self):
        rc = globe_plan.main(["--repo", str(FIXTURE), "--binary"])
        self.assertEqual(rc, 2)
        self.assertFalse(globe_plan.BACKENDS["ghidra"].available())
        with self.assertRaises(NotImplementedError):
            globe_plan.BACKENDS["ghidra"].decompile("x", "0x0")

    def test_write_plan_and_install_notice(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "plan"
            dest = Path(tmp) / "root"
            dest.mkdir()
            rc = globe_plan.main([
                "--repo", str(FIXTURE),
                "--engine", "cesiumjs",
                "--out", str(out),
                "--licenses-out", str(dest / "licenses.md"),
                "--install-notices",
                "--notice-dest", str(dest),
            ])
            self.assertEqual(rc, 0)
            plan = (out / "RUST_PLAN.md").read_text(encoding="utf-8")
            self.assertIn("Disposition summary", plan)
            self.assertTrue((dest / "NOTICE-CESIUM").is_file())
            self.assertTrue((dest / "LICENSE-CESIUM").is_file())
            self.assertIn("Apache-2.0", (dest / "licenses.md").read_text(encoding="utf-8"))

    def test_list_engines(self):
        self.assertEqual(globe_plan.main(["--list-engines"]), 0)


if __name__ == "__main__":
    unittest.main()
