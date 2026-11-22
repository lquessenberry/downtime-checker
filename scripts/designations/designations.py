#!/usr/bin/env python3
"""Designation claims: named designator, never a fact about the org.

Government lists first. NGO lists are optional CSV imports and must not ship
without a symmetry report. Addresses the source published stay on the record.
UN individuals are omitted unless --include-individuals.

Every record is a CLAIM. legal_status is first-class so FTO/sanctions and
NGO catalogs cannot be colored the same.

Related: lquessenberry/downtime-checker#60 #59.

Usage:
  python3 scripts/designations/designations.py --list-designators
  python3 scripts/designations/designations.py --ingest un --out data/designations
  python3 scripts/designations/designations.py --ingest csv --csv export.csv --designator influencewatch
  python3 scripts/designations/designations.py --report --out data/designations
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
UA = "globalstatus-designations/1.0 (+https://github.com/lquessenberry/downtime-checker)"

PERMISSIVE_REDISTRIBUTE = frozenset({"public-domain", "ogl-3.0", "un-attribution"})

DESIGNATORS = {
    "state_fto": {
        "name": "US Department of State",
        "list": "Foreign Terrorist Organizations",
        "kind": "government",
        "orientation": "state",
        "basis": "statutory criteria, INA 219",
        "legal_status": "legal designation with consequences",
        "appeal": "administrative and judicial review",
        "url": "https://www.state.gov/foreign-terrorist-organizations/",
        "access": "page; scrape is fragile — CSV ingest",
        "terms": "public-domain",
    },
    "un_sanctions": {
        "name": "UN Security Council",
        "list": "Consolidated Sanctions List",
        "kind": "government",
        "orientation": "state",
        "basis": "Security Council committee decision",
        "legal_status": "binding on member states",
        "appeal": "Focal Point / Ombudsperson",
        "url": "https://scsanctions.un.org/resources/xml/en/consolidated.xml",
        "access": "XML feed",
        "terms": "un-attribution",
    },
    "eu_sanctions": {
        "name": "European Union",
        "list": "Financial Sanctions Files",
        "kind": "government",
        "orientation": "state",
        "basis": "CFSP listing",
        "legal_status": "legal designation with consequences",
        "appeal": "CJEU",
        "url": "https://data.europa.eu/data/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions",
        "access": "XML/CSV bulk; not wired yet",
        "terms": "commission-reuse",
    },
    "uk_proscribed": {
        "name": "UK Home Office",
        "list": "Proscribed terrorist organisations",
        "kind": "government",
        "orientation": "state",
        "basis": "statutory proscription",
        "legal_status": "criminal offence to belong or support",
        "appeal": "statutory review",
        "url": "https://www.gov.uk/government/publications/proscribed-terror-groups-or-organisations--2",
        "access": "page; CSV ingest",
        "terms": "ogl-3.0",
    },
    "splc": {
        "name": "Southern Poverty Law Center",
        "list": "Hate Map / Extremist Files",
        "kind": "ngo",
        "orientation": "left",
        "basis": "expert review of publications, media, law enforcement input",
        "legal_status": "none",
        "appeal": "none published",
        "url": "https://www.splcenter.org/hate-map",
        "access": "manual CSV only; no scrape",
        "terms": "no-bulk-redistribution",
    },
    "adl": {
        "name": "Anti-Defamation League",
        "list": "H.E.A.T. Map / profiles",
        "kind": "ngo",
        "orientation": "left",
        "basis": "incident reports and extremist profiles",
        "legal_status": "none",
        "appeal": "none published",
        "url": "https://www.adl.org/resources/hate-symbols",
        "access": "manual CSV only",
        "terms": "check-terms",
    },
    "influencewatch": {
        "name": "Capital Research Center (InfluenceWatch)",
        "list": "organization profiles",
        "kind": "ngo",
        "orientation": "right",
        "basis": "editorial profiles of funding and activity",
        "legal_status": "none",
        "appeal": "correction request",
        "url": "https://www.influencewatch.org/",
        "access": "manual CSV only",
        "terms": "check-terms",
    },
}


def local_tag(el: ET.Element) -> str:
    return el.tag.split("}")[-1]


def child_text(el: ET.Element, name: str) -> str:
    for child in el:
        if local_tag(child) == name:
            return (child.text or "").strip()
    return ""


def nested_text(el: ET.Element, parent: str, child: str) -> str:
    for node in el:
        if local_tag(node) != parent:
            continue
        for g in node:
            if local_tag(g) == child and (g.text or "").strip():
                return g.text.strip()
        if child == "COUNTRY" and (node.text or "").strip():
            return node.text.strip()
    return ""


def address_block(el: ET.Element, parent: str) -> dict:
    """Keep every address field the source published."""
    out = {"street": None, "city": None, "state": None, "country": None, "note": None, "zip": None}
    for node in el:
        if local_tag(node) != parent:
            continue
        for g in node:
            tag = local_tag(g)
            text = (g.text or "").strip()
            if not text:
                continue
            if tag in ("STREET", "ADDRESS1", "ADDRESS"):
                out["street"] = text
            elif tag == "CITY":
                out["city"] = text
            elif tag in ("STATE_PROVINCE", "STATE"):
                out["state"] = text
            elif tag == "COUNTRY":
                out["country"] = text
            elif tag in ("ZIP_CODE", "POSTAL_CODE", "ZIP"):
                out["zip"] = text
            elif tag == "NOTE":
                out["note"] = text
        break
    return out


def designation_record(
    designator: str,
    org_name: str,
    *,
    county_fips: str | None = None,
    state: str | None = None,
    country: str | None = None,
    street: str | None = None,
    city: str | None = None,
    zip_code: str | None = None,
    claim_type: str = "hate_group",
    basis: str | None = None,
    asserted: str | None = None,
    status: str = "active",
    source_url: str | None = None,
    raw: dict | None = None,
    ref: str | None = None,
) -> dict:
    meta = DESIGNATORS.get(designator, {})
    loc_country = country or None
    loc_state = state or None
    loc_fips = county_fips or None
    loc_street = street or None
    loc_city = city or None
    loc_zip = zip_code or None
    if loc_street:
        grain = "street"
    elif loc_city:
        grain = "city"
    elif loc_fips:
        grain = "county"
    elif loc_state:
        grain = "state"
    else:
        grain = "country"
    return {
        "schema_version": "1.0",
        "class": "designation",
        "org_key": re.sub(r"[^a-z0-9]+", "-", (org_name or "").lower()).strip("-"),
        "org_name": org_name,
        "designator_id": designator,
        "designator_name": meta.get("name", designator),
        "designator_kind": meta.get("kind"),
        "claim_type": claim_type,
        "basis": basis or meta.get("basis"),
        "legal_status": meta.get("legal_status"),
        "asserted_date": asserted,
        "status": status,
        "ref": ref,
        "location": {
            "county_fips": loc_fips,
            "state": loc_state,
            "country": loc_country,
            "granularity": grain,
            "street": loc_street,
            "city": loc_city,
            "zip": loc_zip,
        },
        "source_url": source_url or meta.get("url"),
        "retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "raw_sha256": hashlib.sha256(
            json.dumps(raw, sort_keys=True).encode()
        ).hexdigest()
        if raw
        else None,
    }


def fetch(url: str, timeout: float = 120) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def ingest_un_xml(blob: bytes, include_individuals: bool = False) -> tuple[list, dict]:
    root = ET.fromstring(blob)
    records = []
    skipped_people = 0
    skipped_empty = 0
    for el in root.iter():
        tag = local_tag(el)
        if tag not in ("ENTITY", "INDIVIDUAL"):
            continue
        if tag == "INDIVIDUAL" and not include_individuals:
            skipped_people += 1
            continue
        first = child_text(el, "FIRST_NAME")
        second = child_text(el, "SECOND_NAME")
        name = " ".join(x for x in (first, second) if x).strip()
        if not name:
            skipped_empty += 1
            continue
        if tag == "ENTITY":
            addr = address_block(el, "ENTITY_ADDRESS")
            claim = "sanctions_entity"
        else:
            addr = address_block(el, "INDIVIDUAL_ADDRESS")
            if not addr.get("country"):
                addr["country"] = nested_text(el, "NATIONALITY", "VALUE")
            claim = "sanctions_individual"
        records.append(
            designation_record(
                "un_sanctions",
                name,
                country=addr.get("country") or "UN",
                state=addr.get("state"),
                street=addr.get("street"),
                city=addr.get("city"),
                zip_code=addr.get("zip"),
                claim_type=claim,
                asserted=child_text(el, "LISTED_ON") or None,
                status="listed",
                ref=child_text(el, "REFERENCE_NUMBER") or None,
                raw={"ref": child_text(el, "REFERENCE_NUMBER"), "list": child_text(el, "UN_LIST_TYPE")},
            )
        )
    return records, {
        "designator": "un_sanctions",
        "records": len(records),
        "skipped_individuals": skipped_people,
        "skipped_empty": skipped_empty,
    }


def ingest_un(include_individuals: bool = False) -> tuple[list, dict]:
    url = DESIGNATORS["un_sanctions"]["url"]
    try:
        blob = fetch(url)
    except Exception as err:  # noqa: BLE001
        return [], {"designator": "un_sanctions", "error": str(err)}
    try:
        return ingest_un_xml(blob, include_individuals=include_individuals)
    except ET.ParseError as err:
        return [], {"designator": "un_sanctions", "error": f"parse: {err}"}


def _cell(row: dict, col: str | None) -> str | None:
    if not col:
        return None
    val = (row.get(col) or "").strip()
    return val or None


def ingest_csv_rows(path: Path, designator: str, cols: dict) -> tuple[list, dict]:
    meta = DESIGNATORS.get(designator)
    if not meta:
        return [], {"error": f"unknown designator {designator}"}
    if meta.get("terms") == "no-bulk-redistribution":
        # Allowed as a local claims file. Never commit the CSV or jsonl to git.
        pass
    records, bad = [], 0
    with path.open(encoding="utf-8", errors="replace") as fh:
        for row in csv.DictReader(fh):
            name = (row.get(cols["name"]) or "").strip()
            if not name:
                bad += 1
                continue
            records.append(
                designation_record(
                    designator,
                    name,
                    state=_cell(row, cols.get("state")),
                    county_fips=_cell(row, cols.get("county")),
                    country=_cell(row, cols.get("country")) or ("US" if cols.get("state") else None),
                    street=_cell(row, cols.get("street")),
                    city=_cell(row, cols.get("city")),
                    zip_code=_cell(row, cols.get("zip")),
                    claim_type="ngo_designation" if meta["kind"] == "ngo" else "legal_designation",
                    source_url=_cell(row, cols.get("url")),
                    raw={"name": name, "state": _cell(row, cols.get("state"))},
                )
            )
    return records, {"designator": designator, "records": len(records), "skipped": bad}


def symmetry_report(records: list[dict]) -> list[str]:
    by_des = Counter(r["designator_id"] for r in records)
    by_orient = Counter(
        DESIGNATORS.get(r["designator_id"], {}).get("orientation", "unknown") for r in records
    )
    by_kind = Counter(r["designator_kind"] for r in records)
    lines = [
        "# Designation layer: symmetry report",
        "",
        "A designation layer is only factual if it is symmetric. If one "
        "designator supplies most of the entries, the layer is that "
        "organization's view with extra steps.",
        "",
        "| designator | kind | orientation | records |",
        "|---|---|---|---|",
    ]
    for des, n in by_des.most_common():
        meta = DESIGNATORS.get(des, {})
        lines.append(
            f"| {meta.get('name', des)} | {meta.get('kind', '?')} | "
            f"{meta.get('orientation', '?')} | {n:,} |"
        )
    total = sum(by_des.values()) or 1
    top_des, top_n = (by_des.most_common(1) or [("none", 0)])[0]
    share = 100.0 * top_n / total
    ngo = by_kind.get("ngo", 0)
    gov = by_kind.get("government", 0)
    lines += ["", "## Verdict", ""]
    if ngo and not by_orient.get("right", 0):
        lines.append(
            "**Asymmetric NGO catalog.** Left-oriented NGO lists are present "
            "without a counter-designator. Do not publish this as a description "
            "of who is designated. Name the single designator on every mark, "
            "or add InfluenceWatch (or equivalent) at equal fidelity."
        )
    elif ngo and not by_orient.get("left", 0):
        lines.append(
            "**Asymmetric NGO catalog.** Right-oriented lists only. Same problem, "
            "other direction."
        )
    elif ngo and share > 60:
        lines.append(
            f"**Asymmetric.** `{top_des}` supplies {share:.1f}% of records. "
            "Add counter-designators before this is presented as a description "
            "of who is designated."
        )
    elif gov and not ngo:
        lines.append(
            f"**Government lists only.** Top source `{top_des}` holds {share:.1f}%. "
            "Legal designations may publish with per-mark attribution. Do not "
            "mix these marks with NGO catalogs."
        )
    else:
        lines.append(
            f"**Symmetric enough to publish with per-mark attribution.** "
            f"Top designator holds {share:.1f}% of records."
        )
    lines += ["", "## By kind", ""]
    for kind, n in by_kind.most_common():
        lines.append(f"- {kind or 'unknown'}: {n:,}")
    lines += [
        "",
        "## Government designations versus NGO designations",
        "",
        "These are different variables and must not be summed. A government "
        "designation carries legal consequences and an appeal path. An NGO "
        "designation carries neither. A view that colors both the same way "
        "has merged a legal status with an opinion.",
        "",
        "Attributed violence (UCDP / ACLED) is a third variable. Not ingested here.",
        "",
    ]
    return lines


def render_map_layers(records: list[dict]) -> list[str]:
    by_key = defaultdict(list)
    for rec in records:
        loc = rec.get("location") or {}
        key = loc.get("county_fips") or loc.get("state") or loc.get("country") or "??"
        by_key[key].append(rec)
    lines = [
        "# Designation layer",
        "",
        "Every line names the designating body. Addresses the source published "
        "are kept on the record.",
        "",
    ]
    for key in sorted(by_key):
        group = by_key[key]
        des = Counter(r["designator_id"] for r in group)
        lines.append(f"## {key} — {len(group)} designation(s)")
        lines.append("")
        lines.append(
            "Designators: " + ", ".join(f"{d}({n})" for d, n in des.most_common())
        )
        lines.append("")
        for rec in sorted(group, key=lambda x: x["org_name"] or "")[:40]:
            loc = rec.get("location") or {}
            addr = ", ".join(
                p
                for p in (
                    loc.get("street"),
                    loc.get("city"),
                    loc.get("state"),
                    loc.get("country"),
                )
                if p
            )
            suffix = f" — {addr}" if addr else ""
            lines.append(
                f"- {rec['org_name']} — *{rec['designator_name']}*, "
                f"{rec['claim_type']}, {rec.get('status') or '?'}{suffix}"
            )
        lines.append("")
    return lines


def write_jsonl(path: Path, records: list[dict], append: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = "a" if append and path.exists() else "w"
    with path.open(mode, encoding="utf-8") as fh:
        for rec in records:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")


def load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ingest", choices=["un", "csv"])
    ap.add_argument("--csv")
    ap.add_argument("--designator", default=None)
    ap.add_argument("--name-col", default="Organization Name")
    ap.add_argument("--state-col", default="State")
    ap.add_argument("--county-col", default=None)
    ap.add_argument("--street-col", default="Street")
    ap.add_argument("--city-col", default="City")
    ap.add_argument("--zip-col", default="ZIP")
    ap.add_argument("--country-col", default="Country")
    ap.add_argument("--url-col", default=None)
    ap.add_argument("--include-individuals", action="store_true")
    ap.add_argument("--xml", help="Local UN XML instead of the live feed")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--list-designators", action="store_true")
    ap.add_argument("--out", default="data/designations")
    args = ap.parse_args(argv)

    outdir = Path(args.out)
    jsonl = outdir / "designations.jsonl"
    claims = outdir / "claims.jsonl"

    if args.list_designators:
        for key, meta in DESIGNATORS.items():
            print(f"{key:<16}{meta['kind']:<12}{meta['orientation']:<8}{meta['name']}")
            print(f"{'':<16}{meta['access']}")
            print(f"{'':<16}terms={meta['terms']}  {meta['url']}")
        return 0

    if args.ingest == "un":
        if args.xml:
            records, meta = ingest_un_xml(
                Path(args.xml).read_bytes(), include_individuals=args.include_individuals
            )
        else:
            records, meta = ingest_un(include_individuals=args.include_individuals)
        if not records:
            print(json.dumps(meta), file=sys.stderr)
            return 1
        write_jsonl(jsonl, records, append=False)
        write_jsonl(claims, records, append=False)
        print(json.dumps(meta))
        return 0

    if args.ingest == "csv":
        if not args.designator:
            print("--designator is required for csv ingest", file=sys.stderr)
            return 1
        if args.designator == "splc":
            print(
                "SPLC has no bulk redistribution license. CSV stays local; "
                "do not commit designations.jsonl built from it.",
                file=sys.stderr,
            )
        if not args.csv:
            print("--csv is required", file=sys.stderr)
            return 1
        cols = {
            "name": args.name_col,
            "state": args.state_col,
            "county": args.county_col,
            "street": args.street_col,
            "city": args.city_col,
            "zip": args.zip_col,
            "country": args.country_col,
            "url": args.url_col,
        }
        records, meta = ingest_csv_rows(Path(args.csv), args.designator, cols)
        if not records:
            print(json.dumps(meta), file=sys.stderr)
            return 1
        write_jsonl(jsonl, records, append=True)
        write_jsonl(claims, records, append=True)
        print(json.dumps(meta))
        return 0

    if args.report:
        records = load_jsonl(jsonl)
        if not records:
            print("no records; ingest something first", file=sys.stderr)
            return 1
        outdir.mkdir(parents=True, exist_ok=True)
        rep = symmetry_report(records)
        (outdir / "SYMMETRY.md").write_text("\n".join(rep) + "\n", encoding="utf-8")
        (outdir / "LAYER.md").write_text(
            "\n".join(render_map_layers(records)) + "\n", encoding="utf-8"
        )
        print("\n".join(rep))
        return 0

    ap.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
