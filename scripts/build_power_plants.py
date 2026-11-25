#!/usr/bin/env python3
"""Build the GLOBAL POWER PLANTS static file for the globe.

Sources:
  * World Resources Institute, Global Power Plant Database v1.3 (CC BY 4.0),
    global_power_plant_database.csv: every country except the United States.
  * U.S. Energy Information Administration, Preliminary Monthly Electric
    Generator Inventory (EIA-860M), "Operating" and "Operating_PR" sheets:
    United States and Puerto Rico. Generators are grouped into plants by EIA
    plant ID; the plant's fuel is the fuel with the most nameplate MW.

Writes globalstatus/infra/power-plants/:
  overview.json      plants of 50 MW and up, drawn at every zoom
  <row>_<col>.json   smaller plants in 10-degree tiles, fetched when zoomed in
  index.json         tile list and counts
Each file: rows [lat, lon, fuel, mw, name, owner#, place#, year, source, detail#]
  with its own owners / places / details tables.
    fuel   index into FUELS (coal, gas, oil, nuclear, hydro, solar, wind, other)
    source 0 = WRI, 1 = EIA
No URLs are written: the cards never link off globalstatus.app.

Usage: python3 scripts/build_power_plants.py <wri csv> <eia860m xlsx> [label]
  label: EIA inventory month for the credit line, e.g. "October 2026"
"""
import csv
import json
import os
import sys
from collections import defaultdict

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "globalstatus", "infra", "power-plants")
BIG_MW = 50
TILE_DEG = 10
FUELS = ["coal", "gas", "oil", "nuclear", "hydro", "solar", "wind", "other"]
WRI_FUEL = {"Coal": 0, "Petcoke": 2, "Gas": 1, "Oil": 2, "Nuclear": 3, "Hydro": 4, "Solar": 5, "Wind": 6}
# EIA-860M energy source codes.
EIA_FUEL = {
    "BIT": 0, "SUB": 0, "LIG": 0, "ANT": 0, "RC": 0, "WC": 0, "SGC": 0, "CBL": 0,
    "NG": 1, "OG": 1, "BFG": 1, "PG": 1, "SGP": 1,
    "DFO": 2, "RFO": 2, "JF": 2, "KER": 2, "PC": 2, "WO": 2,
    "NUC": 3, "WAT": 4, "SUN": 5, "WND": 6,
}
STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts",
    "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
    "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico",
    "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming", "PR": "Puerto Rico",
}


class Table:
    def __init__(self):
        self.items, self.idx = [], {}

    def __call__(self, text):
        text = str(text or "").strip()
        if text not in self.idx:
            self.idx[text] = len(self.items)
            self.items.append(text)
        return self.idx[text]


def num(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def mw_out(mw):
    return int(round(mw)) if mw >= 10 else round(mw, 1)


def eia_plants(path):
    wb = openpyxl.load_workbook(path, read_only=True)
    plants = {}
    for sheet in ("Operating", "Operating_PR"):
        ws = wb[sheet]
        header = None
        for row in ws.iter_rows(values_only=True):
            if header is None:
                if row and row[0] == "Entity ID":
                    header = {name: i for i, name in enumerate(row)}
                continue
            pid = row[header["Plant ID"]]
            if pid in (None, ""):
                continue
            lat, lon = num(row[header["Latitude"]]), num(row[header["Longitude"]])
            mw = num(row[header["Nameplate Capacity (MW)"]]) or 0.0
            p = plants.setdefault(pid, {
                "name": row[header["Plant Name"]], "state": row[header["Plant State"]],
                "county": row[header["County"]], "lat": lat, "lon": lon,
                "fuel": defaultdict(float), "tech": defaultdict(float), "owner": defaultdict(float),
                "mw": 0.0, "year": None,
            })
            if p["lat"] is None and lat is not None:
                p["lat"], p["lon"] = lat, lon
            code = str(row[header["Energy Source Code"]] or "").strip()
            p["fuel"][EIA_FUEL.get(code, 7)] += mw
            p["tech"][str(row[header["Technology"]] or "").strip()] += mw
            p["owner"][str(row[header["Entity Name"]] or "").strip()] += mw
            p["mw"] += mw
            year = row[header["Operating Year"]]
            if isinstance(year, (int, float)) and year > 1800:
                p["year"] = int(year) if p["year"] is None else min(p["year"], int(year))
    return plants


def main():
    wri_csv, eia_xlsx = sys.argv[1], sys.argv[2]
    eia_label = sys.argv[3] if len(sys.argv) > 3 else ""
    rows = []
    owners = places = details = (lambda text: str(text or "").strip())
    counts = {"wri": 0, "eia": 0, "wri_us_replaced": 0, "skipped": 0}
    with open(wri_csv, encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if r["country"] == "USA":
                counts["wri_us_replaced"] += 1
                continue
            lat, lon, mw = num(r["latitude"]), num(r["longitude"]), num(r["capacity_mw"]) or 0.0
            if lat is None or lon is None:
                counts["skipped"] += 1
                continue
            year = num(r["commissioning_year"])
            rows.append([round(lat, 4), round(lon, 4), WRI_FUEL.get(r["primary_fuel"], 7), mw_out(mw),
                         r["name"].strip(), owners(r["owner"]), places(r["country_long"]),
                         int(year) if year and year > 1800 else 0, 0, details(r["primary_fuel"])])
            counts["wri"] += 1
    for p in eia_plants(eia_xlsx).values():
        if p["lat"] is None or p["lon"] is None or (p["lat"] == 0 and p["lon"] == 0):
            counts["skipped"] += 1
            continue
        fuel = max(p["fuel"].items(), key=lambda kv: kv[1])[0]
        tech = max(p["tech"].items(), key=lambda kv: kv[1])[0]
        owner = max(p["owner"].items(), key=lambda kv: kv[1])[0]
        state = STATES.get(p["state"], p["state"] or "")
        county = str(p["county"] or "").strip()
        place = ", ".join(x for x in (county and f"{county} County" if p["state"] not in ("PR", "LA", "AK") else county, state, "United States" if p["state"] != "PR" else "") if x)
        rows.append([round(p["lat"], 4), round(p["lon"], 4), fuel, mw_out(p["mw"]), str(p["name"]).strip(),
                     owners(owner), places(place), p["year"] or 0, 1, details(tech)])
        counts["eia"] += 1
    rows.sort(key=lambda r: -r[3])  # big plants first, so they draw on top
    sources = [
        "World Resources Institute, Global Power Plant Database v1.3 (CC BY 4.0)",
        "U.S. Energy Information Administration, EIA-860M operating generator inventory" + (f", {eia_label}" if eia_label else ""),
    ]

    def pack(part):
        o, pl, de = Table(), Table(), Table()
        out = [r[:5] + [o(r[5]), pl(r[6]), r[7], r[8], de(r[9])] for r in part]
        return {"owners": o.items, "places": pl.items, "details": de.items, "rows": out}

    os.makedirs(OUT, exist_ok=True)
    for name in os.listdir(OUT):
        if name.endswith(".json"):
            os.remove(os.path.join(OUT, name))

    def write(name, body):
        with open(os.path.join(OUT, name), "w", encoding="utf-8") as fh:
            json.dump(body, fh, separators=(",", ":"), ensure_ascii=False)

    big = [r for r in rows if r[3] >= BIG_MW]
    tiles = defaultdict(list)
    for r in rows:
        if r[3] < BIG_MW:
            tiles[f"{int((r[0] + 90) // TILE_DEG)}_{int((r[1] + 180) // TILE_DEG)}"].append(r)
    by_fuel = defaultdict(int)
    for r in rows:
        by_fuel[FUELS[r[2]]] += 1
    overview = pack(big)
    overview.update({"fuels": FUELS, "sources": sources, "total": len(rows), "big_mw": BIG_MW, "counts": counts})
    write("overview.json", overview)
    for key, part in tiles.items():
        write(f"{key}.json", pack(part))
    write("index.json", {"tile_deg": TILE_DEG, "big_mw": BIG_MW, "total": len(rows), "overview": len(big),
                         "by_fuel": by_fuel, "counts": counts, "tiles": {k: len(v) for k, v in sorted(tiles.items())}})
    print(json.dumps(counts), dict(by_fuel), "total", len(rows), "overview", len(big), "tiles", len(tiles))


if __name__ == "__main__":
    main()
