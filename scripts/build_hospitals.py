#!/usr/bin/env python3
"""Build EMERGENCY SERVICES > USA HOSPITALS & TRAUMA CENTERS static tiles.

Sources (both public):
  HIFLD Next Hospitals v1.1.0 (hifld.publicenvirodata.org, dataset hospitals-3,
      CC-PDM-1.0 public domain, source data issued 2026-04-06). Only STATUS = OPEN.
      https://hifld.publicenvirodata.org/storage/hifld/hospitals-3/hospitals-3/v1.1.0/geopackage/hospitals-3.gpkg
  CMS Care Compare, Hospital General Information (data.cms.gov provider data
      xubh-q36u, modified 2026-10-26): emergency services yes/no, overall star rating,
      CMS hospital type and ownership. No coordinates, so it is joined to HIFLD by
      street address + ZIP, then name + ZIP, then phone. A phone match is kept only when
      the names agree and the city or ZIP agrees, so a health system's shared number
      does not tie a CMS hospital to the wrong building. One CMS row per HIFLD hospital.

Usage:
  python3 scripts/build_hospitals.py <hospitals-3.gpkg> <Hospital_General_Information.csv>

Output (committed static files, not under globalstatus/data/):
  globalstatus/infra/hospitals/overview.json  every trauma center plus one other hospital
                                              per OVERVIEW_DEG cell
  globalstatus/infra/hospitals/<r>_<c>.json   every open hospital, TILE-degree tiles
  globalstatus/infra/hospitals/index.json     tile list and counts
Rows: [lat, lon, traumaClass, name, address, placeIdx, zip, countyIdx, updated YYYYMMDD,
       typeIdx, traumaRawIdx, er (1 yes, 0 no, -1 unknown), beds (-1 unknown),
       helipad (1 yes, 0 no, -1 unknown), stars (1-5, 0 not rated, -1 no CMS match),
       ownerIdx, phone, cmsTypeIdx, pediatric (1/0)]
traumaClass: 0 none, 1-5 Level I-V (highest adult level), 6 Pediatric only, 7 State-specific.
WEBSITE and SOURCE URLs are never written, and phones are plain text, so cards cannot
link off the site.
"""
import collections, csv, datetime, difflib, json, re, sqlite3, sys
from pathlib import Path

GPKG, CMS = sys.argv[1], sys.argv[2]
OUT = Path(__file__).resolve().parent.parent / "globalstatus" / "infra" / "hospitals"
TILE = 2
OVERVIEW_DEG = 0.35
CLASSES = ["Not a trauma center", "Level I", "Level II", "Level III", "Level IV", "Level V", "Pediatric", "State-specific"]
ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5}
DRAW = {0: 0, 7: 1, 5: 2, 4: 3, 6: 4, 3: 5, 2: 6, 1: 7}
SOURCE = "HIFLD Next Hospitals v1.1.0 (public domain), CMS Care Compare Oct 2026"
NA = {"", "NOT AVAILABLE", "NONE", "N/A"}


def clean(v):
    v = "" if v is None else str(v).strip()
    return "" if v.upper() in NA else v


def tcase(s):
    s = clean(s)
    if not s or not s.isupper():
        return s
    t = s.title()
    t = re.sub(r"\b(Of|And|The|For|At|In|On)\b", lambda m: m.group(1).lower(), t)
    t = re.sub(r"\b(Va|Ucla|Ucsf|Usc|Ucsd|Uc|Uw|Unc|Nyu|Upmc|Ohsu|Musc|Uab|Uams|Ut|Hca|Ssm|Cmc|Llc|Inc|Ltc|Ltach|Ii|Iii|Iv|Nw|Ne|Sw|Se|Dc|Us|Afb|Amc)\b", lambda m: m.group(1).upper(), t)
    t = re.sub(r"'S\b", "'s", t)
    return t[0].upper() + t[1:]


def trauma(raw):
    """(class, pediatric flag, clean label) from HIFLD's free-text TRAUMA value."""
    t = clean(raw).upper()
    if not t:
        return 0, 0, ""
    adult, ped, rehab = [], [], False
    for part in re.split(r",|/|;", t):
        p = part.strip()
        m = re.search(r"LEVEL (IV|V|III|II|I)\b", p)
        if "REHAB" in p:
            rehab = True
            continue
        if "PEDIATRIC" in p:
            ped.append(ROMAN[m.group(1)] if m else 0)
        elif m:
            adult.append(ROMAN[m.group(1)])
    # "LEVEL II / PEDIATRIC": the pediatric part carries no level of its own.
    inv = {v: k for k, v in ROMAN.items()}
    pedtxt = ""
    if ped:
        lv = [x for x in ped if x]
        pedtxt = f"Pediatric Level {inv[min(lv)]}" if lv else "Pediatric"
    if adult:
        label = f"Level {inv[min(adult)]}" + (f" (adult), {pedtxt}" if pedtxt else "")
        return min(adult), 1 if ped else 0, label
    if ped:
        return 6, 1, pedtxt
    return 7, 0, "State-specific designation" + (" (rehabilitation)" if rehab else "")


def norm(s):
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def digits(s):
    d = re.sub(r"\D", "", s or "")
    return d[-10:] if len(d) >= 10 else ""


STOP = {"HOSPITAL", "MEDICAL", "CENTER", "CENTRE", "THE", "OF", "AND", "HEALTH", "REGIONAL", "MEMORIAL", "COMMUNITY", "SYSTEM", "INC", "LLC", "CAMPUS", "AT", "ST", "SAINT"}


def name_ok(a, b):
    ta = {w for w in re.findall(r"[A-Z0-9]+", a.upper()) if w not in STOP}
    tb = {w for w in re.findall(r"[A-Z0-9]+", b.upper()) if w not in STOP}
    if ta and tb and len(ta & tb) / min(len(ta), len(tb)) >= 0.5:
        return True
    return difflib.SequenceMatcher(None, norm(a), norm(b)).ratio() >= 0.75


def main():
    db = sqlite3.connect(GPKG)
    table = db.execute("select table_name from gpkg_contents").fetchone()[0]
    cur = db.execute(f'select * from "{table}" where STATUS = "OPEN"')
    cols = [d[0] for d in cur.description]
    hosp = [dict(zip(cols, r)) for r in cur]
    cms = list(csv.DictReader(open(CMS, encoding="utf-8-sig")))

    by_addr, by_zip, by_phone = {}, collections.defaultdict(list), collections.defaultdict(list)
    for i, h in enumerate(hosp):
        z = str(h["ZIP"] or "")[:5]
        by_addr.setdefault((norm(h["ADDRESS"])[:12], z), i)
        by_zip[z].append(i)
        if digits(h["TELEPHONE"]):
            by_phone[digits(h["TELEPHONE"])].append(i)
    link, how = {}, collections.Counter()
    for c in cms:
        z = c["ZIP Code"][:5].zfill(5)
        cand, kind = None, ""
        i = by_addr.get((norm(c["Address"])[:12], z))
        if i is not None:
            cand, kind = i, "address"
        if cand is None:
            for i in by_zip.get(z, []):
                if name_ok(c["Facility Name"], hosp[i]["NAME"]):
                    cand, kind = i, "name"; break
        if cand is None:
            for i in by_phone.get(digits(c["Telephone Number"]), []):
                h = hosp[i]
                same_place = str(h["ZIP"] or "")[:5] == z or norm(h["CITY"]) == norm(c["City/Town"])
                if name_ok(c["Facility Name"], h["NAME"]) and same_place:
                    cand, kind = i, "phone"; break
                how["phoneRejected"] += 1
        if cand is None:
            how["unmatched"] += 1; continue
        if cand in link:
            how["duplicate"] += 1; continue
        link[cand] = c; how[kind] += 1

    stats = collections.Counter()
    types, owners, cmstypes, raws, places, rows = [], {}, [], [], [], []
    def idx(lst, v):
        if v not in lst: lst.append(v)
        return lst.index(v)
    owner_list = []
    out = []
    for i, h in enumerate(hosp):
        c = link.get(i)
        cls, ped, label = trauma(h["TRAUMA"])
        stats[CLASSES[cls]] += 1
        if ped: stats["pediatric flag"] += 1
        er = -1
        stars = -1
        cmstype = ""
        owner = tcase(h["OWNER"])
        phone = clean(h["TELEPHONE"])
        if c:
            er = 1 if c["Emergency Services"] == "Yes" else 0
            r = c["Hospital overall rating"]
            stars = int(r) if r.isdigit() else 0
            cmstype = c["Hospital Type"]
            owner = c["Hospital Ownership"] or owner
            if not phone and digits(c["Telephone Number"]):
                d = digits(c["Telephone Number"]); phone = f"({d[:3]}) {d[3:6]}-{d[6:]}"
            stats["er yes" if er else "er no"] += 1
        beds = h["BEDS"]
        beds = int(beds) if beds is not None and beds >= 0 else -1
        hp = {"Y": 1, "N": 0}.get(clean(h["HELIPAD"]).upper(), -1)
        sd = clean(h["SOURCEDATE"])
        upd = int(sd[:10].replace("-", "")) if re.match(r"\d{4}-\d{2}-\d{2}", sd) else 0
        city = tcase(h["CITY"])
        county = tcase(h["COUNTY"])
        if county and h["STATE"] not in ("LA", "AK", "PR", "DC") and not re.search(r"county|parish|borough|city|municipio", county, re.I):
            county += " County"
        out.append({
            "lat": float(h["LATITUDE"]), "lon": float(h["LONGITUDE"]), "cls": cls, "ped": ped,
            "name": tcase(h["NAME"]) or "Hospital", "addr": tcase(h["ADDRESS"]),
            "place": ", ".join(x for x in [city, clean(h["STATE"])] if x), "zip": clean(h["ZIP"]),
            "county": county, "upd": upd, "type": idx(types, tcase(h["TYPE"]) or "Not listed"),
            "raw": idx(raws, clean(h["TRAUMA"]) and f"{label}\t{clean(h['TRAUMA'])}"),
            "er": er, "beds": beds, "hp": hp, "stars": stars, "owner": idx(owner_list, owner),
            "phone": phone, "cmstype": idx(cmstypes, cmstype),
        })

    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"): old.unlink()

    def pack(rs):
        pl, pi, co, ci, rows = [], {}, [], {}, []
        # Draw order: other hospitals first, Level I last, so trauma pins sit on top.
        for s in sorted(rs, key=lambda s: (DRAW[s["cls"]], s["lat"], s["lon"])):
            if s["place"] not in pi: pi[s["place"]] = len(pl); pl.append(s["place"])
            if s["county"] not in ci: ci[s["county"]] = len(co); co.append(s["county"])
            rows.append([round(s["lat"], 5), round(s["lon"], 5), s["cls"], s["name"], s["addr"], pi[s["place"]], s["zip"],
                         ci[s["county"]], s["upd"], s["type"], s["raw"], s["er"], s["beds"], s["hp"], s["stars"],
                         s["owner"], s["phone"], s["cmstype"], s["ped"]])
        return {"places": pl, "counties": co, "rows": rows}

    common = {"types": types, "trauma": raws, "owners": owner_list, "cmsTypes": cmstypes, "classes": CLASSES}
    built = datetime.date.today().isoformat()
    newest = max(s["upd"] for s in out)
    tiles = collections.defaultdict(list)
    for s in out:
        tiles[(int((s["lat"] + 90) // TILE), int((s["lon"] + 180) // TILE))].append(s)
    index = {"source": SOURCE, "tile_deg": TILE, "built": built, "tiles": {}}
    for (r, c), rs in tiles.items():
        body = pack(rs); body.update(common); body["built"] = built
        (OUT / f"{r}_{c}.json").write_text(json.dumps(body, ensure_ascii=False, separators=(",", ":")))
        index["tiles"][f"{r}_{c}"] = len(rs)
    # Overview: every trauma center, plus the largest other hospital in each cell.
    cells, keep = {}, [s for s in out if s["cls"]]
    for s in out:
        if s["cls"]: continue
        k = (int((s["lat"] + 90) // OVERVIEW_DEG), int((s["lon"] + 180) // OVERVIEW_DEG))
        if k not in cells or s["beds"] > cells[k]["beds"]: cells[k] = s
    ov = pack(keep + list(cells.values()))
    counts = {"total": len(out), "trauma": sum(1 for s in out if s["cls"]), "byClass": {CLASSES[k]: v for k, v in sorted(collections.Counter(s["cls"] for s in out).items())},
              "pediatric": sum(s["ped"] for s in out), "cmsMatched": len(link), "cmsRows": len(cms), "erYes": stats["er yes"], "erNo": stats["er no"]}
    ov.update(common); ov.update({"built": built, "total": len(out), "newest": newest, "source": SOURCE, "counts": counts})
    (OUT / "overview.json").write_text(json.dumps(ov, ensure_ascii=False, separators=(",", ":")))
    index.update({"total": len(out), "overview": len(ov["rows"]), "newest": newest, "counts": counts})
    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    size = sum(p.stat().st_size for p in OUT.glob("*.json"))
    print(json.dumps(counts)); print("match", dict(how)); print("tiles", len(tiles), "overview", len(ov["rows"]), "bytes", size, "newest", newest)


if __name__ == "__main__":
    main()
