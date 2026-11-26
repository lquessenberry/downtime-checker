#!/usr/bin/env python3
"""Build EMERGENCY SERVICES static tiles: USA POLICE DEPARTMENTS, USA SHERIFF
DEPARTMENTS and USA FIRE DEPARTMENTS.

  police  USGS National Structures Dataset, law enforcement (FCODE 74034 police
          stations), as served by Esri U.S. Federal Datasets ("Police Stations",
          fedmaps hub item f380e7aad0864f4997d91c9425187077, CC BY 4.0):
          services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/Structures_Law_Enforcement_v1/FeatureServer/0
          Sheriff's offices (name contains "sheriff") go to the sheriff layer only.
  sheriff the same USGS pages as police, only the sheriff's offices.
  fire    USGS The National Map Fire Stations / EMS Stations (FCODE 74026, public
          domain), ArcGIS item c7b88843429d40cb8e8c86b6a6a54dcf (EPA SEGS) points at
          carto.nationalmap.gov/arcgis/rest/services/structures/MapServer/51
County names: U.S. Census Bureau cartographic boundaries cb_2023_us_county_500k
(public domain), point in polygon.

Usage:
  python3 scripts/build_emergency_services.py police <dir with p_*.geojson pages> <cb_2023_us_county_500k.shp>
  python3 scripts/build_emergency_services.py sheriff <police pages dir> <cb_2023_us_county_500k.shp>
  python3 scripts/build_emergency_services.py fire   <dir with p_*.geojson pages> <cb_2023_us_county_500k.shp>
  pages: <layer>/query?where=1%3D1&outFields=*&outSR=4326&orderByFields=OBJECTID
         &resultOffset=N&resultRecordCount=2000&f=geojson

Output (committed static files, not under globalstatus/data/):
  globalstatus/infra/<police|sheriff|fire>/overview.json   one station per OVERVIEW_DEG cell
  globalstatus/infra/<police|sheriff|fire>/<r>_<c>.json    every station, TILE-degree tiles
  globalstatus/infra/<police|sheriff|fire>/index.json      tile list and counts
Rows: [lat, lon, typeIdx, name, address, placeIdx, zip, countyIdx, updated YYYYMMDD]
No URLs or phone links are written, so cards cannot link off the site. The USGS
data has no phone numbers.
"""
import collections, datetime, glob, json, re, sys
from pathlib import Path

import shapefile
from shapely.geometry import Point, shape
from shapely.strtree import STRtree

LAYER = sys.argv[1]
PAGES = Path(sys.argv[2])
COUNTY_SHP = sys.argv[3]
OUT = Path(__file__).resolve().parent.parent / "globalstatus" / "infra" / LAYER
TILE = 2
OVERVIEW_DEG = 0.35
if LAYER == "police":
    TYPES = ["Police department", "Sheriff's office", "State police or highway patrol", "Campus police",
             "Tribal police", "Marshal", "Constable", "Public safety department", "Law enforcement"]
    RANK = {0: 3, 1: 4, 2: 5, 3: 1, 4: 2, 5: 1, 6: 0, 7: 2, 8: 0}  # overview keeps the "biggest" kind per cell
    SOURCE = "USGS National Structures Dataset (law enforcement), via Esri U.S. Federal Datasets (CC BY 4.0)"
elif LAYER == "sheriff":
    TYPES = ["Sheriff's office", "Sheriff's substation or district office"]
    RANK = {0: 1, 1: 0}
    SOURCE = "USGS National Structures Dataset (law enforcement), via Esri U.S. Federal Datasets (CC BY 4.0)"
else:
    TYPES = ["Fire station", "Volunteer fire company", "Fire and EMS station", "EMS or ambulance station",
             "Wildland fire station", "Emergency services station"]
    RANK = {0: 4, 1: 3, 2: 5, 3: 2, 4: 1, 5: 0}
    SOURCE = "USGS The National Map, Fire Stations / EMS Stations (public domain)"


def fire_kind(name):
    n = name.lower()
    ems = re.search(r"\bems\b|ambulance|emergency medical|rescue squad|paramedic|first responder", n)
    fire = re.search(r"fire|vfd|\bfd\b|hose|engine|hook and ladder|ladder", n)
    if re.search(r"forest service|hotshot|forest protect|wildland|cal fire|forestry|smokejumper|bureau of land management|helitack", n): return 4
    if ems and fire: return 2
    if ems: return 3
    if fire and re.search(r"volunteer|vfd|vol\.? fire|hose company|hook and ladder", n): return 1
    if fire: return 0
    return 5


def police_kind(name):
    n = name.lower()
    if "sheriff" in n: return 1
    if re.search(r"state (police|patrol)|highway patrol|trooper|state troopers", n): return 2
    if re.search(r"universit|college|campus|school district police|isd police", n): return 3
    if "tribal" in n or "nation police" in n: return 4
    if "marshal" in n: return 5
    if "constable" in n: return 6
    if "police" in n or "pd" == n[-2:]: return 0
    if "public safety" in n: return 7
    return 8


def kind(name):
    if LAYER == "fire": return fire_kind(name)
    if LAYER == "sheriff":
        return 1 if re.search(r"substation|district|precinct|annex|satellite|division|patrol (office|station)|outpost|zone", name.lower()) else 0
    return police_kind(name)


def r4(x): return round(x, 4)


def main():
    sf = shapefile.Reader(COUNTY_SHP)
    fields = [f[0] for f in sf.fields[1:]]
    geoms, names = [], []
    for sr in sf.iterShapeRecords():
        rec = dict(zip(fields, sr.record))
        geoms.append(shape(sr.shape.__geo_interface__))
        names.append(f"{rec['NAMELSAD']}")
    tree = STRtree(geoms)

    feats = []
    for page in sorted(glob.glob(str(PAGES / "p_*.geojson"))):
        feats += json.load(open(page))["features"]
    seen, stations, stats = set(), [], collections.Counter()
    for f in feats:
        p = {k.upper(): v for k, v in f["properties"].items()}; g = f.get("geometry") or {}
        coords = g.get("coordinates")
        if not coords or p.get("PERMANENT_IDENTIFIER") in seen:
            stats["skipped"] += 1; continue
        seen.add(p.get("PERMANENT_IDENTIFIER"))
        nm = (p.get("NAME") or "").strip()
        if LAYER in ("police", "sheriff") and (police_kind(nm) == 1) != (LAYER == "sheriff"):
            continue
        lon, lat = float(coords[0]), float(coords[1])
        pt = Point(lon, lat)
        county = ""
        for i in tree.query(pt):
            if geoms[i].covers(pt):
                county = names[i]; break
        if not county: stats["noCounty"] += 1
        ld = p.get("LOADDATE")
        upd = int(datetime.datetime.fromtimestamp(ld / 1000, datetime.timezone.utc).strftime("%Y%m%d")) if ld else 0
        name = (p.get("NAME") or "").strip() or {"police": "Police station", "sheriff": "Sheriff's office"}.get(LAYER, "Fire station")
        stations.append({
            "lat": lat, "lon": lon, "type": kind(name), "name": name,
            "addr": " ".join(x for x in [(p.get("ADDRESSBUILDINGNAME") or "").strip(), (p.get("ADDRESS") or "").strip()] if x),
            "place": ", ".join(x for x in [(p.get("CITY") or "").strip().title() if (p.get("CITY") or "").isupper() else (p.get("CITY") or "").strip(), (p.get("STATE") or "").strip()] if x),
            "st": (p.get("STATE") or "").strip(), "zip": (p.get("ZIPCODE") or "").strip(), "county": county, "upd": upd,
        })
        stats[TYPES[kind(name)]] += 1

    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"): old.unlink()

    def pack(rows):
        places, pi, counties, ci, out = [], {}, [], {}, []
        for s in sorted(rows, key=lambda s: (s["lat"], s["lon"])):
            if s["place"] not in pi: pi[s["place"]] = len(places); places.append(s["place"])
            if s["county"] not in ci: ci[s["county"]] = len(counties); counties.append(s["county"])
            out.append([r4(s["lat"]), r4(s["lon"]), s["type"], s["name"], s["addr"], pi[s["place"]], s["zip"], ci[s["county"]], s["upd"]])
        return {"places": places, "counties": counties, "rows": out}

    built = datetime.date.today().isoformat()
    newest = max(s["upd"] for s in stations)
    tiles = collections.defaultdict(list)
    for s in stations:
        tiles[(int((s["lat"] + 90) // TILE), int((s["lon"] + 180) // TILE))].append(s)
    index = {"types": TYPES, "source": SOURCE, "tile_deg": TILE, "built": built, "tiles": {}}
    for (r, c), rows in tiles.items():
        body = pack(rows); body["built"] = built
        (OUT / f"{r}_{c}.json").write_text(json.dumps(body, ensure_ascii=False, separators=(",", ":")))
        index["tiles"][f"{r}_{c}"] = len(rows)
    cells = {}
    for s in stations:
        k = (int((s["lat"] + 90) // OVERVIEW_DEG), int((s["lon"] + 180) // OVERVIEW_DEG))
        if k not in cells or RANK[s["type"]] > RANK[cells[k]["type"]]: cells[k] = s
    ov = pack(list(cells.values()))
    ov.update({"built": built, "total": len(stations), "types": TYPES, "newest": newest,
               "source": SOURCE})
    (OUT / "overview.json").write_text(json.dumps(ov, ensure_ascii=False, separators=(",", ":")))
    index.update({"total": len(stations), "overview": len(ov["rows"]), "newest": newest})
    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    size = sum(p.stat().st_size for p in OUT.glob("*.json"))
    print(dict(stats)); print("stations", len(stations), "tiles", len(tiles), "overview", len(ov["rows"]), "bytes", size, "newest", newest)


if __name__ == "__main__":
    main()
