#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

import designations  # noqa: E402

FIXTURE = HERE / "tests" / "fixtures" / "un-sample.xml"


class UnIngestTests(unittest.TestCase):
    def test_entities_only_by_default(self):
        records, meta = designations.ingest_un_xml(FIXTURE.read_bytes())
        self.assertEqual(meta["skipped_individuals"], 1)
        names = {r["org_name"] for r in records}
        self.assertEqual(names, {"ADF", "AL-SHABAAB"})
        self.assertTrue(all(r["class"] == "designation" for r in records))
        self.assertTrue(all(r["designator_kind"] == "government" for r in records))
        self.assertTrue(all(r["legal_status"] != "none" for r in records))

    def test_keeps_source_street_and_city(self):
        records, _ = designations.ingest_un_xml(FIXTURE.read_bytes())
        adf = next(r for r in records if r["org_name"] == "ADF")
        self.assertEqual(adf["location"]["street"], "North Kivu office")
        self.assertEqual(adf["location"]["city"], "Goma")
        self.assertEqual(adf["location"]["state"], "North Kivu")
        self.assertEqual(adf["location"]["granularity"], "street")

    def test_include_individuals(self):
        records, meta = designations.ingest_un_xml(
            FIXTURE.read_bytes(), include_individuals=True
        )
        self.assertEqual(meta["skipped_individuals"], 0)
        people = [r for r in records if r["claim_type"] == "sanctions_individual"]
        self.assertEqual(people[0]["org_name"], "ERIC BADEGE")
        self.assertEqual(people[0]["location"]["country"], "Rwanda")
        self.assertEqual(people[0]["location"]["street"], "Avenue de la Paix")
        self.assertEqual(people[0]["location"]["city"], "Kigali")


class CsvAndSymmetryTests(unittest.TestCase):
    def test_csv_requires_designator(self):
        self.assertEqual(designations.main(["--ingest", "csv", "--csv", "x.csv"]), 1)

    def test_splc_only_is_asymmetric(self):
        recs = [
            designations.designation_record("splc", "Example Org", state="AR", country="US")
        ]
        text = "\n".join(designations.symmetry_report(recs))
        self.assertIn("Asymmetric NGO catalog", text)

    def test_un_only_is_government_ok(self):
        recs, _ = designations.ingest_un_xml(FIXTURE.read_bytes())
        text = "\n".join(designations.symmetry_report(recs))
        self.assertIn("Government lists only", text)
        self.assertNotIn("Asymmetric NGO", text)

    def test_cli_un_xml_and_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            rc = designations.main(
                ["--ingest", "un", "--xml", str(FIXTURE), "--out", str(out)]
            )
            self.assertEqual(rc, 0)
            claims = (out / "claims.jsonl").read_text(encoding="utf-8")
            self.assertIn('"class": "designation"', claims)
            self.assertIn("North Kivu office", claims)
            rc = designations.main(["--report", "--out", str(out)])
            self.assertEqual(rc, 0)
            self.assertTrue((out / "SYMMETRY.md").is_file())
            layer = (out / "LAYER.md").read_text(encoding="utf-8")
            self.assertIn("UN Security Council", layer)
            self.assertIn("ADF", layer)
            self.assertIn("Goma", layer)


class SafetyTests(unittest.TestCase):
    def test_write_jsonl_keeps_street(self):
        rec = designations.designation_record(
            "un_sanctions", "X", country="SO", street="Via Roma 1", city="Mogadishu"
        )
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "claims.jsonl"
            designations.write_jsonl(path, [rec], append=False)
            saved = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(saved["location"]["street"], "Via Roma 1")
            self.assertEqual(saved["location"]["city"], "Mogadishu")


if __name__ == "__main__":
    unittest.main()
