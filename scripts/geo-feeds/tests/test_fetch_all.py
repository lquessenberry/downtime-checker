#!/usr/bin/env python3
from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

import fetch_all  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"
CANONICAL = {
    "id",
    "schemaVersion",
    "source",
    "sourceUrl",
    "licence",
    "credit",
    "commercialUse",
    "cadenceSeconds",
    "fetchedAt",
    "stale",
    "error",
    "count",
    "points",
}
ALIASES = {"license", "attribution", "fetched_at", "ttl", "features"}
USGS_ROW = {
    "id": "usgs-eq-all-day",
    "name": "USGS earthquakes past day",
    "provider": "USGS",
    "endpoint": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
    "docs": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php",
    "format": "GeoJSON",
    "auth": "none",
    "licence": "US Government work (public domain)",
    "attribution": "USGS. US Government work; attribution appreciated.",
    "commercial_use": "yes",
    "cadence": "near real-time (minutes)",
    "category": "hazards",
}


def _load_fixture_catalog() -> list[dict]:
    return json.loads((FIXTURES / "catalog_min.json").read_text(encoding="utf-8"))


class EnvelopeTests(unittest.TestCase):
    def test_envelope_has_canonical_and_alias_fields(self):
        feat = fetch_all.as_feature(
            "usgs-eq-all-day:us7000test1",
            "hazards",
            "10 km NE of Testville",
            -89.5,
            35.2,
            "USGS",
            "https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php",
        )
        env = fetch_all.make_envelope(USGS_ROW, [feat], 1_700_000_000)
        self.assertTrue(CANONICAL.issubset(env.keys()))
        self.assertTrue(ALIASES.issubset(env.keys()))
        self.assertEqual(env["schemaVersion"], 2)
        self.assertIsInstance(env["fetchedAt"], int)
        self.assertEqual(env["fetchedAt"], 1_700_000_000)
        self.assertEqual(env["fetched_at"], env["fetchedAt"])
        self.assertEqual(env["ttl"], env["cadenceSeconds"])
        self.assertEqual(env["ttl"], 300)
        self.assertEqual(env["license"], env["licence"])
        self.assertEqual(env["attribution"], env["credit"])
        self.assertEqual(env["count"], 1)
        self.assertEqual(len(env["points"]), 1)
        self.assertEqual(len(env["features"]), 1)
        point = env["points"][0]
        self.assertEqual(point["lat"], 35.2)
        self.assertEqual(point["lon"], -89.5)
        self.assertEqual(point["name"], "10 km NE of Testville")
        self.assertEqual(env["features"][0]["type"], "Feature")
        self.assertIsNone(env["error"])
        self.assertFalse(env["stale"])
        self.assertNotIn("token=", env["sourceUrl"])

    def test_extract_many_keeps_geojson_points(self):
        content = (FIXTURES / "usgs_day_min.geojson").read_bytes()
        pts, path = fetch_all.extract_many(USGS_ROW, content, "application/geo+json", 80)
        self.assertEqual(len(pts), 2)
        lats = sorted(p[0] for p in pts)
        self.assertEqual(lats, [35.2, 55.4])
        self.assertTrue(path)


class AuthAndUrlTests(unittest.TestCase):
    def test_catalog_endpoints_do_not_embed_secret_params(self):
        catalog = fetch_all.load_catalog()
        dirty = []
        for row in catalog:
            query = parse_qs(urlparse(row.get("endpoint") or "").query)
            if any(key.lower() in fetch_all.SECRET_QUERY_PARAMS for key in query):
                dirty.append(row["id"])
        self.assertEqual(dirty, [])

    def test_strip_and_apply_auth_uses_env_only(self):
        url = "https://api.waqi.info/map/bounds/?latlng=33,-95,37,-89&token=SHOULD-NOT-STAY"
        clean = fetch_all.strip_secrets_from_url(url)
        self.assertNotIn("token=", clean)
        self.assertIn("latlng=", clean)
        row = {"id": "waqi-bounds", "endpoint": clean}
        with patch.dict(os.environ, {"WAQI_TOKEN": "from-env-only"}, clear=False):
            authed, headers, skipped = fetch_all.apply_auth(clean, {}, row)
        self.assertIsNone(skipped)
        self.assertEqual(parse_qs(urlparse(authed).query)["token"], ["from-env-only"])
        self.assertNotIn("SHOULD-NOT-STAY", authed)

    def test_missing_key_skips_keyed_feed(self):
        row = {"id": "openaq-locations", "auth": "free key", "link_only": False, "category": "air"}
        env = {k: v for k, v in os.environ.items() if k != "OPENAQ_API_KEY"}
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(fetch_all.missing_key_env(row), "OPENAQ_API_KEY")
            self.assertFalse(fetch_all.eligible(row))

    def test_link_only_and_registry_feeds_are_not_eligible(self):
        catalog = _load_fixture_catalog()
        nsopw = next(row for row in catalog if row["id"] == "nsopw")
        self.assertFalse(fetch_all.eligible(nsopw))
        usgs = next(row for row in catalog if row["id"] == "usgs-eq-all-day")
        self.assertTrue(fetch_all.eligible(usgs))

    def test_keyed_feed_eligible_when_env_present(self):
        row = next(r for r in _load_fixture_catalog() if r["id"] == "waqi-bounds")
        with patch.dict(os.environ, {"WAQI_TOKEN": "present"}, clear=False):
            self.assertTrue(fetch_all.eligible(row))
        env = {k: v for k, v in os.environ.items() if k != "WAQI_TOKEN"}
        with patch.dict(os.environ, env, clear=True):
            self.assertFalse(fetch_all.eligible(row))

    def test_ocm_and_openaq_use_headers_not_query(self):
        with patch.dict(os.environ, {"OPENAQ_API_KEY": "aq-secret", "OCM_API_KEY": "ocm-secret"}):
            _, openaq_headers, _ = fetch_all.apply_auth(
                "https://api.openaq.org/v3/locations?limit=20", {}, {"id": "openaq-locations"}
            )
            _, ocm_headers, _ = fetch_all.apply_auth(
                "https://api.openchargemap.io/v3/poi/?output=json", {}, {"id": "open-charge-map"}
            )
        self.assertEqual(openaq_headers["X-API-Key"], "aq-secret")
        self.assertEqual(ocm_headers["X-API-Key"], "ocm-secret")


class WriteAndLogTests(unittest.TestCase):
    def test_write_layer_and_no_secret_in_logs_or_file(self):
        secret = "super-secret-waqi-value"
        row = next(r for r in _load_fixture_catalog() if r["id"] == "waqi-bounds")
        captured = io.StringIO()
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            catalog = Path(tmp) / "catalog.json"
            catalog.write_text((FIXTURES / "catalog_min.json").read_text(encoding="utf-8"))
            with patch.dict(os.environ, {"WAQI_TOKEN": secret}, clear=False):
                with patch("fetch_all.http_get", return_value=(200, b'{"data":[]}', "application/json")) as get:
                    with patch("sys.stdout", captured):
                        fetch_all.main(
                            [
                                "--catalog",
                                str(catalog),
                                "--out",
                                str(out / "layers"),
                                "--all-points",
                                str(out / "all_points.geojson"),
                                "--ids",
                                "waqi-bounds",
                            ]
                        )
                    called_url = get.call_args[0][0]
                    self.assertIn("token=", called_url)
                    self.assertIn(secret, called_url)
            layer = json.loads((out / "layers" / "waqi-bounds.json").read_text(encoding="utf-8"))
            blob = json.dumps(layer) + captured.getvalue()
            self.assertNotIn(secret, blob)
            self.assertNotIn(secret, (out / "all_points.geojson").read_text(encoding="utf-8"))
            self.assertIn("sourceUrl", layer)
            self.assertNotIn("token=", layer["sourceUrl"])
            self.assertIsInstance(layer["fetchedAt"], int)

    def test_fetch_row_builds_points_from_geojson(self):
        content = (FIXTURES / "usgs_day_min.geojson").read_bytes()
        with patch("fetch_all.http_get", return_value=(200, content, "application/geo+json")):
            env = fetch_all.fetch_row(USGS_ROW, 80, 1_700_000_100)
        self.assertEqual(env["count"], 2)
        self.assertEqual(env["error"], None)
        self.assertEqual(env["source"], "USGS")
        names = " ".join(p["name"] for p in env["points"])
        self.assertIn("Testville", names)
        self.assertIn("Pacific Ocean", names)


if __name__ == "__main__":
    unittest.main()
