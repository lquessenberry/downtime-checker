#!/usr/bin/env python3
"""Build USA CELL TOWERS static tiles from FCC Antenna Structure Registration (ASR)
public bulk data (r_tower.zip: RA, CO, EN) plus the HIFLD Cellular Towers CSV
(FCC cellular license sites) for carrier names.

Output (committed static files, not under globalstatus/data/):
  globalstatus/infra/cell-towers/overview.json   thinned set for globe distance
  globalstatus/infra/cell-towers/<r>_<c>.json    every site, TILE-degree tiles
  globalstatus/infra/cell-towers/index.json      tile list and counts
Rows: [lat, lon, type, heightM, ownerIdx, asr, city, st, carrierIdx]
No URLs are written, so cards cannot link off the site.
"""
import csv, json, math, collections, datetime
from pathlib import Path

import sys
# Usage: python3 scripts/build_cell_towers.py <unzipped r_tower.zip dir> <HIFLD Cellular_Towers.csv>
#   r_tower.zip: https://data.fcc.gov/download/pub/uls/complete/r_tower.zip
FCC = Path(sys.argv[1] if len(sys.argv) > 1 else "fcc")
HIFLD = Path(sys.argv[2] if len(sys.argv) > 2 else "Cellular_Towers.csv")
OUT = Path(__file__).resolve().parent.parent / "globalstatus" / "infra" / "cell-towers"
TILE = 2
OVERVIEW_DEG = 0.35

# Tower-like structures that commonly carry cellular antennas.
KEEP = {"TOWER", "LTOWER", "MTOWER", "GTOWER", "POLE", "UPOLE", "MAST", "BTWR",
        "BMAST", "BPOLE", "TREE", "2TOWER"}

def carrier_for(lic):
    l = lic.lower()
    if "cingular" in l or l.startswith("at&t") or "at&t" in l:
        return "AT&T"
    if l.startswith("cellco") or "verizon" in l or "alltel" in l or "bell atlantic mobile" in l or "gte mobilnet" in l:
        return "Verizon"
    if l.startswith("uscoc") or "united states cellular" in l:
        return "UScellular"
    if "t-mobile" in l or "sprint" in l:
        return "T-Mobile"
    return ""

TYPES = ["TOWER", "LTOWER", "MTOWER", "GTOWER", "POLE", "UPOLE", "MAST", "BTWR", "BMAST", "BPOLE",
         "TREE", "2TOWER", "SITE", "TANK", "B", "BANT", "SILO", "OTHER"]

def r4(x): return round(x, 4)

def main():
    owners = {}
    for line in open(FCC / "EN.dat", encoding="latin-1"):
        f = line.rstrip("\r\n").split("|")
        if f[5] == "O" and f[9].strip():
            owners[f[4]] = f[9].strip()
    coords = {}
    for line in open(FCC / "CO.dat", encoding="latin-1"):
        f = line.rstrip("\r\n").split("|")
        if f[5] != "T": continue
        try:
            lat = float(f[6]) + float(f[7] or 0) / 60 + float(f[8] or 0) / 3600
            lon = float(f[11]) + float(f[12] or 0) / 60 + float(f[13] or 0) / 3600
        except ValueError:
            continue
        if f[9] == "S": lat = -lat
        if f[14] == "W": lon = -lon
        coords[f[4]] = (lat, lon)
    sites = {}
    stats = collections.Counter()
    for line in open(FCC / "RA.dat", encoding="latin-1"):
        f = line.rstrip("\r\n").split("|")
        stats["ra"] += 1
        if f[8] != "C" or f[15] != "C":
            stats["skip_status"] += 1; continue
        stype = f[32].strip()
        if stype not in KEEP:
            stats["skip_type"] += 1; continue
        usi = f[4]
        if usi not in coords:
            stats["skip_nocoord"] += 1; continue
        lat, lon = coords[usi]
        try: h = float(f[30])
        except ValueError: h = None
        sites[f[3]] = {
            "lat": lat, "lon": lon, "type": stype, "h": h,
            "owner": owners.get(usi, ""), "asr": f[3],
            "city": f[24].strip().title(), "st": f[25].strip(), "car": set(), "lic": set(),
        }
    stats["asr_kept"] = len(sites)
    # spatial hash for proximity matching (~110 m cells)
    grid = collections.defaultdict(list)
    for k, s in sites.items():
        grid[(int(math.floor(s["lat"] * 1000)), int(math.floor(s["lon"] * 1000)))].append(k)
    def near(lat, lon, m=60):
        gy, gx = int(math.floor(lat * 1000)), int(math.floor(lon * 1000))
        best, bd = None, m
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for k in grid.get((gy + dy, gx + dx), ()):
                    s = sites[k]
                    d = math.hypot((s["lat"] - lat) * 111320, (s["lon"] - lon) * 111320 * math.cos(math.radians(lat)))
                    if d <= bd: best, bd = k, d
        return best
    extra = {}
    for row in csv.DictReader(open(HIFLD, encoding="utf-8-sig")):
        try: lat, lon = float(row["latdec"]), float(row["londec"])
        except ValueError: continue
        lic = row["Licensee"].strip()
        car = carrier_for(lic)
        reg = (row["TowReg"] or "").strip()
        reg = reg.lstrip("0") if reg not in ("", "0") else ""
        k = reg if reg in sites else near(lat, lon)
        if k:
            stats["hifld_matched_reg" if k == reg else "hifld_matched_near"] += 1
            if car: sites[k]["car"].add(car)
            sites[k]["lic"].add(lic)
            continue
        key = (r4(lat), r4(lon))
        s = extra.get(key)
        if not s:
            try: h = float(row["AllStruc"])
            except ValueError: h = None
            st = row["LocState"].strip()
            s = extra[key] = {"lat": lat, "lon": lon, "type": (row["StrucType"] or "").strip() or "SITE",
                              "h": h if h and h > 0 else None, "owner": "", "asr": "",
                              "city": row["LocCity"].strip().title(), "st": st, "car": set(), "lic": set()}
            stats["hifld_only_sites"] += 1
        if car: s["car"].add(car)
        s["lic"].add(lic)
    allsites = list(sites.values()) + list(extra.values())
    stats["total"] = len(allsites)
    stats["with_carrier_or_licensee"] = sum(1 for s in allsites if s["lic"])

    def label(s):
        bits = []
        for c in sorted(s["car"]):
            origs = sorted(l for l in s["lic"] if carrier_for(l) == c)
            bits.append(f"{c} (FCC licensee: {'; '.join(origs)})" if origs and any(o.lower() != c.lower() for o in origs) else c)
        for l in sorted(s["lic"]):
            if not carrier_for(l): bits.append(l)
        return " · ".join(bits)

    OUT.mkdir(parents=True, exist_ok=True)
    for p in OUT.glob("*.json"): p.unlink()
    tiles = collections.defaultdict(list)
    for s in allsites:
        r = int((s["lat"] + 90) // TILE); c = int((s["lon"] + 180) // TILE)
        tiles[(r, c)].append(s)

    def pack(rows):
        own, owni, cars, cari, cit, citi, out = [], {}, [], {}, [], {}, []
        for s in sorted(rows, key=lambda s: (s["lat"], s["lon"])):
            o = s["owner"]; lab = label(s); cy = ", ".join(x for x in (s["city"], s["st"]) if x)
            if o not in owni: owni[o] = len(own); own.append(o)
            if lab not in cari: cari[lab] = len(cars); cars.append(lab)
            if cy not in citi: citi[cy] = len(cit); cit.append(cy)
            h = None if s["h"] is None else int(round(s["h"]))
            out.append([r4(s["lat"]), r4(s["lon"]), TYPES.index(s["type"]) if s["type"] in TYPES else TYPES.index("OTHER"), h,
                        owni[o], int(s["asr"]) if s["asr"] else 0, citi[cy], cari[lab]])
        return {"owners": own, "places": cit, "carriers": cars, "rows": out}

    built = datetime.date.today().isoformat()
    index = {"types": TYPES, "tile_deg": TILE, "built": built, "tiles": {}}
    for (r, c), rows in tiles.items():
        body = pack(rows); body["built"] = built
        (OUT / f"{r}_{c}.json").write_text(json.dumps(body, separators=(",", ":")))
        index["tiles"][f"{r}_{c}"] = len(rows)
    # overview: tallest site per OVERVIEW_DEG cell
    cells = {}
    for s in allsites:
        k = (int(s["lat"] // OVERVIEW_DEG), int(s["lon"] // OVERVIEW_DEG))
        score = (s["h"] or 0, 1 if s["car"] else 0)
        if k not in cells or score > cells[k][0]: cells[k] = (score, s)
    ov = pack([v[1] for v in cells.values()])
    ov.update({"built": built, "total": len(allsites), "asr": len(sites), "hifldOnly": len(extra),
               "source": "FCC Antenna Structure Registration (weekly public file, " + open(FCC / "counts").readline().split(":", 1)[1].strip() + ") and FCC cellular license sites (HIFLD Cellular Towers)"})
    (OUT / "overview.json").write_text(json.dumps(ov, separators=(",", ":")))
    index["total"] = len(allsites); index["overview"] = len(ov["rows"])
    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    print(dict(stats)); print("tiles", len(tiles), "overview", len(ov["rows"]))
    print("types", collections.Counter(s["type"] for s in allsites).most_common(30))
    print("carriers", collections.Counter(c for s in allsites for c in s["car"]))

main()
