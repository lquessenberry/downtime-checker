#!/usr/bin/env python3
"""Build globalstatus/geo/world-cities.json for RIPE Atlas probe pins.

Source: GeoNames cities15000 + admin1CodesASCII (CC BY 4.0, https://www.geonames.org).
Rows: [lat, lon, name, country code, state/region]. US rows use the postal
state code (GeoNames US admin1 codes are postal codes). The server uses this to
say which town a probe is near; it is never sent to the browser whole.

  curl -sLO https://download.geonames.org/export/dump/cities15000.zip && unzip cities15000.zip
  curl -sLO https://download.geonames.org/export/dump/admin1CodesASCII.txt
  python3 scripts/build_world_cities.py cities15000.txt admin1CodesASCII.txt
"""
import json
import os
import sys

cities_txt, admin1_txt = sys.argv[1], sys.argv[2]
admin = {}
with open(admin1_txt, encoding="utf-8") as f:
    for line in f:
        parts = line.rstrip("\n").split("\t")
        if len(parts) >= 3:
            admin[parts[0]] = parts[2] or parts[1]
rows = []
with open(cities_txt, encoding="utf-8") as f:
    for line in f:
        c = line.rstrip("\n").split("\t")
        if len(c) < 15:
            continue
        name = c[2] or c[1]
        cc = c[8]
        a1 = c[10]
        region = a1 if cc == "US" else admin.get(f"{cc}.{a1}", "")
        rows.append([round(float(c[4]), 3), round(float(c[5]), 3), name, cc, region])
rows.sort(key=lambda r: (r[0], r[1]))
out = os.path.join(os.path.dirname(__file__), "..", "globalstatus", "geo", "world-cities.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump({"source": "GeoNames cities15000 (CC BY 4.0)", "rows": rows}, f, ensure_ascii=False, separators=(",", ":"))
print(len(rows), "cities ->", os.path.normpath(out), os.path.getsize(out), "bytes")
