#!/usr/bin/env python3
"""Build globalstatus/geo/us-airports.json: FAA airport code -> name, city, state, lat, lon.

Used by poll-lib.php (FLIGHT DELAYS) to name and place airports in the FAA NAS Status
feed when the feed leaves a name or coordinate out. Source: OurAirports airports.csv
(public domain), https://davidmegginson.github.io/ourairports-data/airports.csv
Kept: US and territory large and medium airports, plus small airports with an IATA code
or scheduled service. Keyed by FAA local code, with the IATA code as an extra key when
it differs.

Usage: python3 scripts/build_us_airports.py <airports.csv>
"""
import csv, datetime, json, sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "globalstatus" / "geo" / "us-airports.json"
COUNTRIES = {"US", "PR", "GU", "VI", "AS", "MP"}
RANK = {"large_airport": 3, "medium_airport": 2, "small_airport": 1}

rows = {}
for r in csv.DictReader(open(sys.argv[1], encoding="utf-8")):
    if r["iso_country"] not in COUNTRIES or r["type"] not in RANK:
        continue
    if r["type"] == "small_airport" and not (r["iata_code"] or r["scheduled_service"] == "yes"):
        continue
    state = r["iso_region"].split("-", 1)[1] if r["iso_country"] == "US" else r["iso_country"]
    rec = [r["name"], r["municipality"], state, round(float(r["latitude_deg"]), 4), round(float(r["longitude_deg"]), 4), RANK[r["type"]]]
    for code in {r["local_code"], r["iata_code"]}:
        code = (code or "").strip().upper()
        if code and (code not in rows or rows[code][5] < rec[5]):
            rows[code] = rec
OUT.write_text(json.dumps({"source": "OurAirports (public domain)", "built": datetime.date.today().isoformat(),
                           "fields": ["name", "city", "state", "lat", "lon", "rank"], "airports": dict(sorted(rows.items()))},
                          ensure_ascii=False, separators=(",", ":")))
print(len(rows), OUT.stat().st_size)
