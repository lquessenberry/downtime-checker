#!/usr/bin/env python3
"""Build the static AIRPORTS and MILITARY BASES files for globalstatus/infra/.

Run by hand when the data should be refreshed (it is not a cron):

    python3 scripts/build_infra_layers.py            # download + build
    python3 scripts/build_infra_layers.py --offline  # rebuild from ./.infra-raw

Airports: OurAirports (public domain), https://ourairports.com/data/
  airports.csv + countries.csv from davidmegginson.github.io/ourairports-data.
  Closed airports, heliports and balloonports are dropped.
  airports-major.json  large + medium airports (shown when the layer is on)
  airports-small/      small airports + seaplane bases in 15-degree tiles, plus
                       index.json (a tile is loaded only when zoomed in over it)

Military bases: OpenStreetMap (ODbL), read through the QLever SPARQL endpoint
  for the OSM planet (https://qlever.dev/osm-planet) because the public
  Overpass servers would not answer from the build box. Only features tagged
  military=base | barracks | airfield | naval_base. A way or relation is drawn
  at its centroid. Country = the admin_level=2 boundary (ISO3166-1:alpha2) the
  feature intersects; disputed areas can list two.
  military-bases.json
"""
import argparse
import csv
import io
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "globalstatus" / "infra"
RAW = ROOT / ".infra-raw"
UA = "globalstatus.app-build/1.0 (+https://globalstatus.app)"
OA = "https://davidmegginson.github.io/ourairports-data/"
QLEVER = "https://qlever.dev/api/osm-planet"

PREFIX = """PREFIX osmkey: <https://www.openstreetmap.org/wiki/Key:>
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX geof: <http://www.opengis.net/def/function/geosparql/>
PREFIX ogc: <http://www.opengis.net/rdf#>
"""
MIL_FILTER = 'FILTER(?mil IN ("base","barracks","airfield","naval_base"))'
Q_SITES = PREFIX + """SELECT ?osm ?mil ?name ?nameen ?wkt WHERE {
 ?osm osmkey:military ?mil . %s
 ?osm geo:hasGeometry/geo:asWKT ?g .
 BIND(geof:centroid(?g) AS ?wkt)
 OPTIONAL { ?osm osmkey:name ?name }
 OPTIONAL { ?osm <https://www.openstreetmap.org/wiki/Key:name:en> ?nameen }
}""" % MIL_FILTER
Q_COUNTRY = PREFIX + """SELECT ?osm (GROUP_CONCAT(DISTINCT ?cc; separator="/") AS ?country) WHERE {
 ?osm osmkey:military ?mil . %s
 ?osm ogc:sfIntersects ?rel .
 ?rel osmkey:admin_level 2 . ?rel <https://www.openstreetmap.org/wiki/Key:ISO3166-1:alpha2> ?cc .
} GROUP BY ?osm""" % MIL_FILTER


def get(url, data=None, accept=None):
    headers = {"User-Agent": UA}
    if accept:
        headers["Accept"] = accept
    body = urllib.parse.urlencode(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers)
    with urllib.request.urlopen(req, timeout=300) as resp:
        return resp.read().decode("utf-8")


def fetch(offline):
    RAW.mkdir(exist_ok=True)
    files = {
        "airports.csv": lambda: get(OA + "airports.csv"),
        "countries.csv": lambda: get(OA + "countries.csv"),
        "mil.tsv": lambda: get(QLEVER, {"query": Q_SITES}, "text/tab-separated-values"),
        "milcc.tsv": lambda: get(QLEVER, {"query": Q_COUNTRY}, "text/tab-separated-values"),
        "qlever-stats.json": lambda: get(QLEVER + "?cmd=stats"),
    }
    out = {}
    for name, loader in files.items():
        path = RAW / name
        if not offline:
            path.write_text(loader(), encoding="utf-8")
        out[name] = path.read_text(encoding="utf-8")
    return out


def num(value, digits):
    try:
        return round(float(value), digits)
    except (TypeError, ValueError):
        return None


def lit(value):
    """QLever TSV literal -> text ("x", "x"@en, plain numbers)."""
    value = value.strip()
    if not value:
        return ""
    if value.startswith('"'):
        end = value.rfind('"')
        text = value[1:end]
        return text.replace('\\"', '"').replace("\\\\", "\\").replace("\\t", " ").replace("\\n", " ")
    return value


def build_airports(raw, countries, stamp):
    rows = csv.DictReader(io.StringIO(raw["airports.csv"]))
    major, minor = [], []
    used = set()
    for r in rows:
        kind = r["type"]
        if kind not in ("large_airport", "medium_airport", "small_airport", "seaplane_base"):
            continue  # closed, heliport, balloonport
        lat, lon = num(r["latitude_deg"], 4), num(r["longitude_deg"], 4)
        if lat is None or lon is None:
            continue
        elev = r["elevation_ft"].strip()
        elev = int(float(elev)) if elev else None
        code = {"large_airport": "L", "medium_airport": "M", "small_airport": "S", "seaplane_base": "W"}[kind]
        cc = r["iso_country"].strip()
        used.add(cc)
        name = r["name"].strip()
        city = r["municipality"].strip()
        if code in ("L", "M"):
            major.append([r["ident"], name, code, lat, lon, elev, r["iata_code"].strip(), r["icao_code"].strip() or r["gps_code"].strip(), city, cc])
        else:
            minor.append([r["ident"], name, code, lat, lon, elev, city, cc, r["iata_code"].strip()])
    major.sort(key=lambda row: (row[2], row[0]))
    minor.sort(key=lambda row: row[0])
    names = {cc: countries.get(cc, cc) for cc in sorted(used) if cc}
    meta = {"source": "OurAirports", "license": "Public domain", "url": "https://ourairports.com/data/", "built": stamp}
    major_doc = dict(meta, fields=["ident", "name", "type", "lat", "lon", "elev_ft", "iata", "icao", "city", "cc"], countries=names, rows=major)
    minor_doc = dict(meta, fields=["ident", "name", "type", "lat", "lon", "elev_ft", "city", "cc", "iata"], rows=minor)
    return major_doc, minor_doc


def build_bases(raw, countries, stamp):
    cc_by = {}
    for line in raw["milcc.tsv"].splitlines()[1:]:
        parts = line.split("\t")
        if len(parts) >= 2:
            cc_by[parts[0]] = lit(parts[1])
    seen = {}
    for line in raw["mil.tsv"].splitlines()[1:]:
        parts = line.split("\t")
        if len(parts) < 5:
            continue
        iri, mil, name, name_en, wkt = parts[:5]
        iri = iri.strip("<>")
        if iri in seen:
            continue
        wkt = wkt.strip()
        if not wkt.startswith("POINT("):
            continue
        lon, lat = (float(v) for v in wkt[6:-1].split())
        bits = iri.rsplit("/", 2)
        osm_type, osm_id = bits[-2], int(bits[-1])
        mil = lit(mil)
        name, name_en = lit(name), lit(name_en)
        if name_en == name:
            name_en = ""
        cc = cc_by.get("<%s>" % iri, "")
        code = {"base": "B", "barracks": "K", "airfield": "A", "naval_base": "N"}[mil]
        seen[iri] = [code, round(lat, 4), round(lon, 4), name, name_en, osm_type[0], osm_id, cc]
    rows = sorted(seen.values(), key=lambda row: ("BANK".index(row[0]), row[5], row[6]))
    used = set()
    for row in rows:
        used.update(c for c in row[7].split("/") if c)
    try:
        stats = json.loads(raw["qlever-stats.json"])
        snapshot = stats.get("name-index", "")
    except ValueError:
        snapshot = ""
    return {
        "source": "OpenStreetMap contributors via QLever OSM planet",
        "license": "ODbL 1.0",
        "url": "https://www.openstreetmap.org/copyright",
        "snapshot": snapshot,
        "built": stamp,
        "tags": "military=base|barracks|airfield|naval_base",
        "fields": ["type", "lat", "lon", "name", "name_en", "osm_type", "osm_id", "cc"],
        "countries": {cc: countries.get(cc, cc) for cc in sorted(used)},
        "rows": rows,
    }


def write(name, doc):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / name
    path.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{name}: {len(doc['rows'])} rows, {path.stat().st_size:,} bytes")


TILE_DEG = 15


def tile_key(lat, lon):
    row = min(int((lat + 90) // TILE_DEG), 180 // TILE_DEG - 1)
    col = min(int((lon + 180) // TILE_DEG), 360 // TILE_DEG - 1)
    return f"{row}_{col}"


def write_tiles(doc):
    folder = OUT / "airports-small"
    folder.mkdir(parents=True, exist_ok=True)
    for old in folder.glob("*.json"):
        old.unlink()
    tiles = {}
    for row in doc["rows"]:
        tiles.setdefault(tile_key(row[3], row[4]), []).append(row)
    meta = {k: v for k, v in doc.items() if k != "rows"}
    total = 0
    for key, rows in sorted(tiles.items()):
        path = folder / f"{key}.json"
        path.write_text(json.dumps(dict(meta, tile=key, rows=rows), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        total += path.stat().st_size
    index = dict(meta, tile_deg=TILE_DEG, tiles={k: len(v) for k, v in sorted(tiles.items())}, total=len(doc["rows"]))
    (folder / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    biggest = max(tiles.items(), key=lambda kv: len(kv[1]))
    print(f"airports-small/: {len(doc['rows'])} rows in {len(tiles)} tiles, {total:,} bytes (largest {biggest[0]} = {len(biggest[1])})")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    raw = fetch(args.offline)
    countries = {r["code"]: r["name"] for r in csv.DictReader(io.StringIO(raw["countries.csv"]))}
    stamp = time.strftime("%Y-%m-%d", time.gmtime())
    major, minor = build_airports(raw, countries, stamp)
    write("airports-major.json", major)
    write_tiles(minor)
    write("military-bases.json", build_bases(raw, countries, stamp))


if __name__ == "__main__":
    sys.exit(main())
