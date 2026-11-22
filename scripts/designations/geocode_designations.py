#!/usr/bin/env python3
"""
geocode_designations.py -- geocode designation addresses with source-honest
precision.

Every point is placed at the precision its source actually published.
Nothing is upgraded. A source that names a city yields a city centroid,
never a street. A source that names a street yields a street point, with
Nominatim-reported accuracy rules attached.

Usage:
  ./geocode_designations.py \
      --input data/designations/designations.jsonl \
      --output data/designations/geo/designations.geojson \
      --contact "you@example.com"

  ./geocode_designations.py --input ... --dry-run
  ./geocode_designations.py --input ... --stats
  ./geocode_designations.py --input ... --pack globalstatus/api/designations.json

Env:
  NOMINATIM_URL   default https://nominatim.openstreetmap.org
                  point at a self-hosted instance for production
  GEOCODE_CACHE   default .geocode-cache
  GEOCODE_CONTACT required by Nominatim policy

Nominatim usage policy: 1 request per second, valid User-Agent with contact.
A self-hosted instance is the correct production deployment. This script
honors the policy by default (1.05s spacing, cached responses).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import designations  # noqa: E402

NOMINATIM = os.environ.get("NOMINATIM_URL", "https://nominatim.openstreetmap.org")
CACHE_DIR = Path(os.environ.get("GEOCODE_CACHE", ".geocode-cache"))
RATE_LIMIT_S = 1.05
TIMEOUT = 30

# US state centroids. Fixed table; no network lookup for state-level records.
US_STATE_CENTROIDS = {
    "AL": (32.806671, -86.791130), "AK": (61.370716, -152.404419),
    "AZ": (33.729759, -111.431221), "AR": (34.969704, -92.373123),
    "CA": (36.116203, -119.681564), "CO": (39.059811, -105.311104),
    "CT": (41.597782, -72.755371), "DE": (39.318523, -75.507141),
    "DC": (38.897438, -77.026817), "FL": (27.766279, -81.686783),
    "GA": (33.040619, -83.643074), "HI": (21.094318, -157.498337),
    "ID": (44.240459, -114.478828), "IL": (40.349457, -88.986137),
    "IN": (39.849426, -86.258278), "IA": (42.011539, -93.210526),
    "KS": (38.526600, -96.726486), "KY": (37.668140, -84.670067),
    "LA": (31.169546, -91.867805), "ME": (44.693947, -69.381927),
    "MD": (39.063946, -76.802101), "MA": (42.230171, -71.530106),
    "MI": (43.326618, -84.536095), "MN": (45.694454, -93.900192),
    "MS": (32.741646, -89.678696), "MO": (38.456085, -92.288368),
    "MT": (46.921925, -110.454353), "NE": (41.125370, -98.268082),
    "NV": (38.313515, -117.055374), "NH": (43.452492, -71.563896),
    "NJ": (40.298904, -74.521011), "NM": (34.840515, -106.248482),
    "NY": (42.165726, -74.948051), "NC": (35.630066, -79.806419),
    "ND": (47.528912, -99.784012), "OH": (40.388783, -82.764915),
    "OK": (35.565342, -96.928917), "OR": (44.572021, -122.070938),
    "PA": (40.590752, -77.209755), "RI": (41.680893, -71.511780),
    "SC": (33.856892, -80.945007), "SD": (44.299782, -99.438828),
    "TN": (35.747845, -86.692345), "TX": (31.054487, -97.563461),
    "UT": (40.150032, -111.862434), "VT": (44.045876, -72.710686),
    "VA": (37.769337, -78.169968), "WA": (47.400902, -121.490494),
    "WV": (38.491226, -80.954453), "WI": (44.268543, -89.616508),
    "WY": (42.755966, -107.302490),
}

# Country centroids for country-precision records. Not a street upgrade.
COUNTRY_CENTROIDS = {
    "afghanistan": (33.9391, 67.7100), "albania": (41.1533, 20.1683),
    "algeria": (28.0339, 1.6596), "angola": (-11.2027, 17.8739),
    "argentina": (-38.4161, -63.6167), "armenia": (40.0691, 45.0382),
    "australia": (-25.2744, 133.7751), "austria": (47.5162, 14.5501),
    "azerbaijan": (40.1431, 47.5769), "bahrain": (26.0667, 50.5577),
    "bangladesh": (23.6850, 90.3563), "belarus": (53.7098, 27.9534),
    "belgium": (50.5039, 4.4699), "bolivia": (-16.2902, -63.5887),
    "bosnia": (43.9159, 17.6791), "brazil": (-14.2350, -51.9253),
    "bulgaria": (42.7339, 25.4858), "burkina faso": (12.2383, -1.5616),
    "cambodia": (12.5657, 104.9910), "cameroon": (7.3697, 12.3547),
    "canada": (56.1304, -106.3468), "chad": (15.4542, 18.7322),
    "chile": (-35.6751, -71.5430), "china": (35.8617, 104.1954),
    "colombia": (4.5709, -74.2973), "congo": (-0.2280, 15.8277),
    "democratic republic of the congo": (-4.0383, 21.7587),
    "drc": (-4.0383, 21.7587), "croatia": (45.1000, 15.2000),
    "cuba": (21.5218, -77.7812), "cyprus": (35.1264, 33.4299),
    "czech": (49.8175, 15.4730), "denmark": (56.2639, 9.5018),
    "ecuador": (-1.8312, -78.1834), "egypt": (26.8206, 30.8025),
    "eritrea": (15.1794, 39.7823), "estonia": (58.5953, 25.0136),
    "ethiopia": (9.1450, 40.4897), "finland": (61.9241, 25.7482),
    "france": (46.2276, 2.2137), "georgia": (42.3154, 43.3569),
    "germany": (51.1657, 10.4515), "ghana": (7.9465, -1.0232),
    "greece": (39.0742, 21.8243), "guatemala": (15.7835, -90.2308),
    "guinea": (9.9456, -9.6966), "haiti": (18.9712, -72.2852),
    "honduras": (15.2000, -86.2419), "hungary": (47.1625, 19.5033),
    "india": (20.5937, 78.9629), "indonesia": (-0.7893, 113.9213),
    "iran": (32.4279, 53.6880), "iraq": (33.2232, 43.6793),
    "ireland": (53.1424, -7.6921), "israel": (31.0461, 34.8516),
    "italy": (41.8719, 12.5674), "ivory coast": (7.5400, -5.5471),
    "cote d'ivoire": (7.5400, -5.5471), "japan": (36.2048, 138.2529),
    "jordan": (30.5852, 36.2384), "kazakhstan": (48.0196, 66.9237),
    "kenya": (-0.0236, 37.9062), "kuwait": (29.3117, 47.4818),
    "kyrgyzstan": (41.2044, 74.7661), "laos": (19.8563, 102.4955),
    "latvia": (56.8796, 24.6032), "lebanon": (33.8547, 35.8623),
    "libya": (26.3351, 17.2283), "lithuania": (55.1694, 23.8813),
    "luxembourg": (49.8153, 6.1296), "mali": (17.5707, -3.9962),
    "mexico": (23.6345, -102.5528), "moldova": (47.4116, 28.3699),
    "mongolia": (46.8625, 103.8467), "morocco": (31.7917, -7.0926),
    "mozambique": (-18.6657, 35.5296), "myanmar": (21.9162, 95.9560),
    "namibia": (-22.9576, 18.4904), "nepal": (28.3949, 84.1240),
    "netherlands": (52.1326, 5.2913), "nicaragua": (12.8654, -85.2072),
    "niger": (17.6078, 8.0817), "nigeria": (9.0820, 8.6753),
    "north korea": (40.3399, 127.5101), "norway": (60.4720, 8.4689),
    "oman": (21.4735, 55.9754), "pakistan": (30.3753, 69.3451),
    "palestine": (31.9522, 35.2332), "panama": (8.5380, -80.7821),
    "paraguay": (-23.4425, -58.4438), "peru": (-9.1900, -75.0152),
    "philippines": (12.8797, 121.7740), "poland": (51.9194, 19.1451),
    "portugal": (39.3999, -8.2245), "qatar": (25.3548, 51.1839),
    "romania": (45.9432, 24.9668), "russia": (61.5240, 105.3188),
    "rwanda": (-1.9403, 29.8739), "saudi arabia": (23.8859, 45.0792),
    "senegal": (14.4974, -14.4524), "serbia": (44.0165, 21.0059),
    "sierra leone": (8.4606, -11.7799), "singapore": (1.3521, 103.8198),
    "slovakia": (48.6690, 19.6990), "somalia": (5.1521, 46.1996),
    "south africa": (-30.5595, 22.9375), "south korea": (35.9078, 127.7669),
    "south sudan": (6.8770, 31.3070), "spain": (40.4637, -3.7492),
    "sri lanka": (7.8731, 80.7718), "sudan": (12.8628, 30.2176),
    "sweden": (60.1282, 18.6435), "switzerland": (46.8182, 8.2275),
    "syria": (34.8021, 38.9968), "taiwan": (23.6978, 120.9605),
    "tajikistan": (38.8610, 71.2761), "tanzania": (-6.3690, 34.8888),
    "thailand": (15.8700, 100.9925), "togo": (8.6195, 0.8248),
    "tunisia": (33.8869, 9.5375), "turkey": (38.9637, 35.2433),
    "turkmenistan": (38.9697, 59.5563), "uganda": (1.3733, 32.2903),
    "ukraine": (48.3794, 31.1656), "united arab emirates": (23.4241, 53.8478),
    "united kingdom": (55.3781, -3.4360), "uk": (55.3781, -3.4360),
    "united states": (37.0902, -95.7129), "us": (37.0902, -95.7129),
    "usa": (37.0902, -95.7129), "un": (40.7489, -73.9680),
    "uruguay": (-32.5228, -55.7658), "uzbekistan": (41.3775, 64.5853),
    "venezuela": (6.4238, -66.5897), "vietnam": (14.0583, 108.2772),
    "yemen": (15.5527, 48.5164), "zambia": (-13.1339, 27.8493),
    "zimbabwe": (-19.0154, 29.1549),
}


def log(m):
    print(f"[{time.strftime('%H:%M:%S', time.gmtime())}] {m}", file=sys.stderr)


def cache_key(q):
    return hashlib.sha256(q.encode()).hexdigest()[:40]


def cached_geocode(q, contact, dry_run=False):
    """Query Nominatim with per-query cache. Rate limited per usage policy."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"{cache_key(q)}.json"
    if path.exists():
        return json.loads(path.read_text())
    if dry_run:
        return {"_dry": True, "query": q}

    url = f"{NOMINATIM}/search?" + urllib.parse.urlencode({
        "q": q, "format": "json", "limit": 1,
        "addressdetails": 0, "extratags": 0,
    })
    req = urllib.request.Request(url, headers={
        "User-Agent": f"textweb-geocode/1.0 (contact: {contact})",
    })
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            data = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        result = {"_error": f"HTTP {e.code}", "query": q}
        path.write_text(json.dumps(result))
        time.sleep(RATE_LIMIT_S)
        return result
    except Exception as e:
        result = {"_error": f"{type(e).__name__}: {e}", "query": q}
        path.write_text(json.dumps(result))
        time.sleep(RATE_LIMIT_S)
        return result

    if not data:
        result = {"_none": True, "query": q}
    else:
        d = data[0]
        try:
            result = {
                "lat": float(d["lat"]),
                "lon": float(d["lon"]),
                "display_name": d.get("display_name", ""),
                "class": d.get("class", ""),
                "type": d.get("type", ""),
                "osm_place_id": d.get("place_id"),
                "query": q,
            }
        except (KeyError, ValueError) as e:
            result = {"_error": f"bad response: {e}", "query": q}
    path.write_text(json.dumps(result))
    time.sleep(RATE_LIMIT_S)
    return result


def chain_query(address, rec):
    """Add country context to an address so Nominatim resolves it."""
    country = ((rec.get("location") or {}).get("country") or "").strip()
    if country and country.lower() not in address.lower():
        return f"{address}, {country}"
    return address


def address_line(rec):
    loc = rec.get("location") or {}
    if rec.get("address"):
        return rec["address"]
    parts = [
        loc.get("street"),
        loc.get("city"),
        loc.get("state"),
        loc.get("zip"),
        loc.get("country"),
    ]
    return ", ".join(p for p in parts if p)


def pick_precision(rec):
    """Return (precision, method_note) reflecting the source's own claim."""
    loc = rec.get("location") or {}
    src = rec.get("address_source")
    street = loc.get("street") or rec.get("address")
    official = src == "official_source" or rec.get("designator_kind") == "government"
    if street and official:
        return "street", "address published by designator"
    if street:
        return "city", "address present but not from official source"
    if loc.get("city"):
        return "city", "city published by source"
    if loc.get("county_fips"):
        return "county", "county"
    if loc.get("state"):
        return "state", "state"
    if loc.get("country"):
        return "country", "country"
    if rec.get("org_name"):
        return "name", "source published a name with no geography"
    return "none", "no geographic claim in source"


def country_centroid(name):
    if not name:
        return None
    key = name.strip().lower()
    if key in COUNTRY_CENTROIDS:
        lat, lon = COUNTRY_CENTROIDS[key]
        return {
            "lat": lat,
            "lon": lon,
            "display_name": f"{name} country centroid",
            "class": "place",
            "type": "country_centroid",
        }
    return None


def resolve(rec, contact, dry_run=False, nominatim=True):
    """Return (result, precision, method_note) for one record."""
    loc = rec.get("location") or {}
    if loc.get("lat") is not None and loc.get("lon") is not None:
        precision, note = pick_precision(rec)
        return (
            {
                "lat": float(loc["lat"]),
                "lon": float(loc["lon"]),
                "display_name": address_line(rec) or rec.get("org_name"),
                "class": "source",
                "type": "published_coordinate",
            },
            precision,
            note + " (source published coordinates)",
        )

    precision, note = pick_precision(rec)
    if precision == "none":
        return None, precision, note

    if precision == "street":
        q = chain_query(address_line(rec) or rec.get("org_name", ""), rec)
        if nominatim:
            return cached_geocode(q, contact, dry_run), precision, note
        return None, precision, note + " (nominatim skipped)"

    if precision in ("city", "county"):
        parts = [loc.get("city"), loc.get("state"), loc.get("country")]
        q = ", ".join(x for x in parts if x) or loc.get("county_fips") or ""
        if not q:
            return None, precision, note + " (no queryable field)"
        if nominatim:
            result = cached_geocode(q, contact, dry_run)
            return result, "city", note
        return None, precision, note + " (nominatim skipped)"

    if precision == "state":
        st = (loc.get("state") or "").upper()
        if st in US_STATE_CENTROIDS:
            lat, lon = US_STATE_CENTROIDS[st]
            return ({
                "lat": lat, "lon": lon,
                "display_name": f"{st} state centroid",
                "class": "place", "type": "state_centroid",
            }, "state", note)
        if nominatim:
            return cached_geocode(
                f"{loc.get('state')}, {loc.get('country', '')}",
                contact, dry_run,
            ), "state", note
        return None, precision, note + " (nominatim skipped)"

    if precision == "country":
        hit = country_centroid(loc.get("country") or "")
        if hit:
            return hit, "country", note
        if nominatim:
            return cached_geocode(loc.get("country") or "", contact, dry_run), "country", note
        return None, precision, note + " (nominatim skipped)"

    if precision == "name":
        hit = country_centroid(loc.get("country") or "")
        if hit:
            return hit, "country", "name-only record; country centroid if present"
        if nominatim:
            return cached_geocode(rec.get("org_name") or "", contact, dry_run), "name", note
        return None, precision, note + " (nominatim skipped)"

    return None, precision, note


def to_feature(rec, result, precision, note):
    if not result or "lat" not in result:
        return None
    return {
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": [result["lon"], result["lat"]],
        },
        "properties": {
            "org_name": rec.get("org_name"),
            "org_key": rec.get("org_key"),
            "designator_id": rec.get("designator_id"),
            "designator_name": rec.get("designator_name"),
            "designator_kind": rec.get("designator_kind"),
            "claim_type": rec.get("claim_type"),
            "legal_status": rec.get("legal_status"),
            "person": bool(rec.get("person")),
            "geo_precision": precision,
            "geo_precision_note": note,
            "geo_display_name": result.get("display_name", ""),
            "geo_osm_place_id": result.get("osm_place_id"),
            "geo_query": result.get("query"),
            "geo_verified": False,
            "source_url": rec.get("source_url"),
            "retrieved_at": rec.get("retrieved_at"),
            "policy": "data/designations/geo/README.md",
        },
    }


def apply_coords(rec, result, precision):
    if not result or "lat" not in result:
        return rec
    loc = dict(rec.get("location") or {})
    loc["lat"] = result["lat"]
    loc["lon"] = result["lon"]
    rec = dict(rec)
    rec["location"] = loc
    rec["geo_precision"] = precision
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="data/designations/designations.jsonl")
    ap.add_argument("--output",
                    default="data/designations/geo/designations.geojson")
    ap.add_argument("--contact", default=os.environ.get("GEOCODE_CONTACT", ""))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--stats", action="store_true")
    ap.add_argument("--no-nominatim", action="store_true")
    ap.add_argument("--pack", default="")
    ap.add_argument("--include-restricted", action="store_true")
    ap.add_argument("--eu-people", action="store_true")
    a = ap.parse_args()

    need_net = not a.dry_run and not a.no_nominatim
    if need_net and not a.contact:
        log("--contact is required for Nominatim usage policy; "
            "set GEOCODE_CONTACT env or pass --contact")
        return 1

    inp = Path(a.input)
    if not inp.exists():
        log(f"missing {inp}")
        return 1

    out = Path(a.output)
    out.parent.mkdir(parents=True, exist_ok=True)

    records = []
    with inp.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError as e:
                log(f"bad line: {e}")

    log(f"loaded {len(records)} records")
    features = []
    located = []
    precisions = Counter()
    skipped = Counter()

    for i, rec in enumerate(records, 1):
        result, precision, note = resolve(
            rec, a.contact, a.dry_run, nominatim=not a.no_nominatim
        )
        precisions[precision] += 1
        feature = to_feature(rec, result, precision, note)
        if feature:
            features.append(feature)
            located.append(apply_coords(rec, result, precision))
        else:
            skipped[precision] += 1
            located.append(rec)
        if i % 100 == 0:
            log(f"{i:,}/{len(records):,}  last precision={precision}")

    doc = {
        "type": "FeatureCollection",
        "features": features,
        "metadata": {
            "generated_by": "geocode_designations.py",
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "input": str(inp),
            "record_count": len(records),
            "feature_count": len(features),
            "precision_counts": dict(precisions),
            "skipped": dict(skipped),
            "policy": "See data/designations/geo/README.md",
            "denominator_note": "Precision is the source claim, never upgraded.",
        },
    }
    out.write_text(json.dumps(doc, indent=1), encoding="utf-8")
    log(f"wrote {out} ({len(features):,} features)")

    if a.pack:
        pack_path = Path(a.pack)
        meta = designations.pack_globe(
            located,
            pack_path,
            include_restricted=a.include_restricted,
            eu_people=a.eu_people,
            rec_class="designation",
        )
        log(f"packed {meta}")

    if a.stats:
        print("\nprecision ladder:")
        for p in ("street", "city", "state", "county", "country", "name", "none"):
            print(f"  {p:<8} {precisions.get(p, 0):>6,}")
        print(f"\nskipped (no result): {dict(skipped)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
