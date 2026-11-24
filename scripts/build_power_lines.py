#!/usr/bin/env python3
"""Build the USA POWER LINES static files for the globe.

Source: HIFLD U.S. Electric Power Transmission Lines (archive, Sep 30 2024),
public U.S. government data, ArcGIS FeatureServer below. The server already
simplifies the shapes (maxAllowableOffset 0.002 degrees); this script
quantizes to 0.001 degrees, simplifies the overview layer further, and writes:

  globalstatus/infra/power-lines/overview.json   230 kV and up + DC, every zoom
  globalstatus/infra/power-lines/<row>_<col>.json  under 230 kV + unknown, 5-degree tiles
  globalstatus/infra/power-lines/index.json      tile list and counts
  <name>.info.json beside each file: card text (voltage, owner, substations,
  type, status), loaded the first time a line in that file is clicked

Usage: python3 scripts/build_power_lines.py [raw_dir]
raw_dir caches the downloaded pages (default /tmp/gs-power-lines-raw).
"""
import concurrent.futures as cf
import json
import os
import re
import sys
import urllib.parse
import urllib.request

URL = "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/US_Electric_Power_Transmission_Lines/FeatureServer/0/query"
FIELDS = "OBJECTID_1,ID,VOLTAGE,VOLT_CLASS,OWNER,SUB_1,SUB_2,TYPE,STATUS,INFERRED"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "globalstatus", "infra", "power-lines")
Q = 1000          # coordinates are integers of 0.001 degree
TILE_DEG = 5
OVERVIEW_TOL = 6  # extra Douglas-Peucker tolerance for the overview, in 0.001 degree
DETAIL_TOL = 2

# Class codes shared with powerlines.js.
CLASS = {"UNDER 100": 0, "SUB 100": 0, "100-161": 1, "220-287": 2, "345": 3, "500": 4,
         "735 AND ABOVE": 5, "DC": 6, "NOT AVAILABLE": 7, "Unknown": 7}
OVERVIEW_CLASSES = {2, 3, 4, 5, 6}


def fetch(raw):
    os.makedirs(raw, exist_ok=True)
    count = json.loads(urllib.request.urlopen(URL + "?where=1%3D1&returnCountOnly=true&f=json", timeout=60).read())["count"]

    def get(off):
        fn = os.path.join(raw, f"p{off:06d}.json")
        if os.path.exists(fn):
            return fn
        q = dict(where="1=1", outFields=FIELDS, outSR="4326", maxAllowableOffset="0.002", geometryPrecision="4",
                 resultOffset=str(off), resultRecordCount="2000", orderByFields="OBJECTID_1", f="geojson")
        err = None
        for _ in range(4):
            try:
                body = urllib.request.urlopen(URL + "?" + urllib.parse.urlencode(q), timeout=120).read()
                json.loads(body)
                with open(fn, "wb") as fh:
                    fh.write(body)
                return fn
            except Exception as e:  # noqa: BLE001
                err = e
        raise err

    with cf.ThreadPoolExecutor(6) as ex:
        files = list(ex.map(get, range(0, count, 2000)))
    return files, count


def clean(text):
    t = str(text or "").strip()
    if not t or t.upper() in ("NOT AVAILABLE", "UNKNOWN", "N/A"):
        return ""
    return t


def sub_name(text):
    t = clean(text)
    if re.fullmatch(r"UNKNOWN\d*", t):
        return ""
    if re.fullmatch(r"TAP\d+", t):
        return "Tap point"
    if re.fullmatch(r"RISER\d+", t):
        return "Riser"
    if re.fullmatch(r"DEADEND\d+", t):
        return "Dead end"
    return t.title() if t.isupper() else t


def owner_name(text):
    return clean(text)


def dp(pts, tol):
    """Douglas-Peucker on integer points; keeps the ends."""
    if len(pts) <= 2 or tol <= 0:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    t2 = tol * tol
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        L = dx * dx + dy * dy
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if L == 0:
                d = (px - ax) ** 2 + (py - ay) ** 2
            else:
                cr = (px - ax) * dy - (py - ay) * dx
                d = cr * cr / L
            if d > best:
                best, bi = d, i
        if best > t2:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return [p for p, k in zip(pts, keep) if k]


def encode(coords, tol):
    pts = []
    for lon, lat in coords:
        p = (round(lon * Q), round(lat * Q))
        if not pts or pts[-1] != p:
            pts.append(p)
    if len(pts) < 2:
        return None
    pts = dp(pts, tol)
    flat = [pts[0][0], pts[0][1]]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        flat += [x1 - x0, y1 - y0]
    return flat


class Pack:
    def __init__(self):
        self.owners, self.oidx, self.lines, self.verts = [], {}, [], 0

    def owner(self, name):
        if name not in self.oidx:
            self.oidx[name] = len(self.owners)
            self.owners.append(name)
        return self.oidx[name]

    def body(self):
        # Shapes only: [class, parts]. The card text sits in a .info file that
        # loads on the first click, so the map draws with less to download.
        return {"q": Q, "lines": [[row[0], row[-1]] for row in self.lines]}

    def info(self, extra=None):
        out = {"owners": self.owners, "rows": [row[1:-1] for row in self.lines]}
        if extra:
            out.update(extra)
        return out


TYPES = ["", "Overhead", "Underground", "AC overhead", "AC underground", "DC overhead", "DC underground"]
TYPE_MAP = {"OVERHEAD": 1, "UNDERGROUND": 2, "AC; OVERHEAD": 3, "AC; UNDERGROUND": 4, "DC; OVERHEAD": 5, "DC; UNDERGROUND": 6}
STATUSES = ["", "In service", "Inactive", "Under construction"]
STATUS_MAP = {"IN SERVICE": 1, "INACTIVE": 2, "UNDER CONSTRUCTION": 3}


def main():
    raw = sys.argv[1] if len(sys.argv) > 1 else "/tmp/gs-power-lines-raw"
    files, count = fetch(raw)
    overview, tiles = Pack(), {}
    seen = kept = 0
    by_class = [0] * 8
    for fn in files:
        with open(fn) as fh:
            feats = json.load(fh)["features"]
        for ft in feats:
            seen += 1
            p, g = ft["properties"], ft["geometry"]
            if not g:
                continue
            parts_in = g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]]
            cls = CLASS.get(p.get("VOLT_CLASS"), 7)
            major = cls in OVERVIEW_CLASSES
            tol = OVERVIEW_TOL if major else DETAIL_TOL
            parts = [e for e in (encode(c, tol) for c in parts_in) if e]
            if not parts:
                continue
            if major:
                pack = overview
            else:
                x0, y0 = parts[0][0] / Q, parts[0][1] / Q
                key = f"{int((y0 + 90) // TILE_DEG)}_{int((x0 + 180) // TILE_DEG)}"
                pack = tiles.setdefault(key, Pack())
            volt = p.get("VOLTAGE")
            volt = None if volt is None or volt <= 0 else (int(volt) if float(volt).is_integer() else volt)
            pack.lines.append([
                cls, volt, pack.owner(owner_name(p.get("OWNER"))),
                sub_name(p.get("SUB_1")), sub_name(p.get("SUB_2")),
                TYPE_MAP.get(p.get("TYPE"), 0), STATUS_MAP.get(p.get("STATUS"), 0),
                1 if p.get("INFERRED") == "Y" else 0, parts,
            ])
            pack.verts += sum(len(e) // 2 for e in parts)
            kept += 1
            by_class[cls] += 1
    os.makedirs(OUT, exist_ok=True)
    for name in os.listdir(OUT):
        if name.endswith(".json"):
            os.remove(os.path.join(OUT, name))
    meta = {"types": TYPES, "statuses": STATUSES, "source": "HIFLD U.S. Electric Power Transmission Lines (archive, Sep 30, 2024)"}

    def write(name, body):
        with open(os.path.join(OUT, name), "w") as fh:
            json.dump(body, fh, separators=(",", ":"), ensure_ascii=False)

    write("overview.json", overview.body())
    write("overview.info.json", overview.info(meta))
    for key, pack in tiles.items():
        write(f"{key}.json", pack.body())
        write(f"{key}.info.json", pack.info())
    index = {"tile_deg": TILE_DEG, "source": meta["source"], "total": kept, "overview": len(overview.lines),
             "detail": kept - len(overview.lines), "by_class": by_class,
             "tiles": {key: len(pack.lines) for key, pack in sorted(tiles.items())}}
    write("index.json", index)
    print(f"source {count}, read {seen}, kept {kept}; overview {len(overview.lines)} lines / {overview.verts} pts; "
          f"{len(tiles)} detail tiles / {sum(p.verts for p in tiles.values())} pts; by class {by_class}")


if __name__ == "__main__":
    main()
