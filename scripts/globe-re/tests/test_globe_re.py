#!/usr/bin/env python3
"""Stdlib tests for the globe-re pipeline. Run from anywhere:

    python3 -m unittest scripts/globe-re/tests/test_globe_re.py
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

import engines  # noqa: E402
import knowledge  # noqa: E402
import mcp_bridge  # noqa: E402
import policy  # noqa: E402
import emit_rust  # noqa: E402
import emit_report  # noqa: E402


class PolicyTests(unittest.TestCase):
    def test_cesium_allowed(self):
        self.assertIsNone(policy.refuse_reason("cesium"))
        self.assertEqual(policy.ALLOWED_TARGETS["cesium"]["license"], "Apache-2.0")

    def test_maplibre_not_mapbox(self):
        self.assertIsNone(policy.refuse_reason("maplibre-gl"))
        self.assertIsNotNone(policy.refuse_reason("mapbox-gl"))

    def test_google_earth_refused(self):
        reason = policy.refuse_reason("Google Earth Pro")
        self.assertIsNotNone(reason)
        self.assertIn("Refused", reason)

    def test_arcgis_refused(self):
        self.assertIsNotNone(policy.refuse_reason("arcgis-pro.exe"))

    def test_mapbox_refused(self):
        self.assertIsNotNone(policy.refuse_reason("mapbox-gl-js"))

    def test_unknown_refused(self):
        self.assertIsNotNone(policy.refuse_reason("mystery-globe"))


class KnowledgeTests(unittest.TestCase):
    def test_wgs84_cesium_radii(self):
        self.assertEqual(knowledge.WGS84_RADII_M[0], 6378137.0)
        self.assertEqual(knowledge.WGS84_RADII_M[2], 6356752.3142451793)

    def test_priority_ones_exist(self):
        ids = {m["id"] for m in knowledge.MODULES if m["priority"] == 1}
        self.assertIn("core.ellipsoid", ids)
        self.assertIn("scene.imagery", ids)
        self.assertIn("data.layers.gsa", ids)

    def test_ion_is_wontfix(self):
        ion = next(m for m in knowledge.MODULES if m["id"] == "ion")
        self.assertEqual(ion["status"], "wontfix — stay off ion")

    def test_gsa_layers_include_grid(self):
        ids = [row[0] for row in knowledge.GSA_LAYERS]
        self.assertIn("grid", ids)
        self.assertIn("adsb", ids)


class EngineTests(unittest.TestCase):
    def test_catalog_includes_ghidra_and_source(self):
        ids = [e.id for e in engines.catalog()]
        self.assertEqual(
            ids,
            ["ghidra", "ida", "binja", "r2", "hopper", "x64dbg", "frida", "jadx", "source"],
        )

    def test_auto_pick_falls_back_to_source_or_installed(self):
        picked = engines.pick("auto")
        self.assertIn(picked.id, {"ghidra", "r2", "binja", "ida", "hopper", "frida", "jadx", "source"})

    def test_unknown_engine_exits(self):
        with self.assertRaises(SystemExit):
            engines.pick("ghidra-enterprise-cloud")


class McpTests(unittest.TestCase):
    def test_session_journal_shape(self):
        session = mcp_bridge.Session(engine="ghidra")
        session.record(
            mcp_bridge.McpCall(server="ghidra", method="tools/list", ok=False, detail="down")
        )
        blob = session.as_dict()
        self.assertEqual(blob["engine"], "ghidra")
        self.assertEqual(len(blob["calls"]), 1)
        self.assertIn("xref", blob["note"].lower())


class EmitTests(unittest.TestCase):
    def test_write_engine_injects_mod(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp)
            (src / "lib.rs").write_text("mod globe_math;\npub fn x() {}\n", encoding="utf-8")
            written = emit_rust.write_engine(src)
            self.assertTrue((src / "engine" / "ellipsoid.rs").is_file())
            lib = (src / "lib.rs").read_text(encoding="utf-8")
            self.assertIn("mod engine;", lib)
            self.assertIn("WGS84_RADII_M", (src / "engine" / "ellipsoid.rs").read_text(encoding="utf-8"))
            self.assertGreaterEqual(len(written), 8)

    def test_report_mentions_wgs84(self):
        eng = engines.pick("source")
        text = emit_report.render(
            engine=eng,
            mcp_summary="## MCP this run\n\n- ghidra: down",
            cesium_inv=None,
            rust_files=[],
        )
        self.assertIn("6378137", text)
        self.assertIn("core.ellipsoid", text)
        self.assertIn("Do not port Cesium ion", text)


if __name__ == "__main__":
    unittest.main()
