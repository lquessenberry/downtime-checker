#!/usr/bin/env python3
"""Designation claims: named designator, never a fact about the org.

Government lists first. NGO lists are optional CSV or local scrapes and must
not ship without a symmetry report. Addresses the source published stay on
the record. Individuals are ingested by default; pass --entities-only to skip.

Every record is a CLAIM. legal_status is first-class so FTO/sanctions and
NGO catalogs cannot be colored the same. UCDP/ACLED events are a different
variable (class=violence).

Related: lquessenberry/downtime-checker#60 #59.

Usage:
  python3 scripts/designations/designations.py --list-designators
  python3 scripts/designations/designations.py --ingest un --out data/designations
  python3 scripts/designations/designations.py --ingest all --out data/designations
  python3 scripts/designations/designations.py --ingest csv --csv export.csv --designator influencewatch
  python3 scripts/designations/designations.py --report --out data/designations
  python3 scripts/designations/designations.py --pack --out data/designations --api globalstatus/api
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import html as html_lib
import io
import json
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter, defaultdict
from html.parser import HTMLParser
from pathlib import Path

HERE = Path(__file__).resolve().parent
UA = "globalstatus-designations/1.0 (+https://github.com/lquessenberry/downtime-checker)"
BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

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
        "access": "HTML table; Chrome User-Agent required",
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
        "url": "https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw",
        "access": "FSF XML bulk",
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
        "url": "https://www.gov.uk/government/publications/proscribed-terror-groups-or-organisations--2/proscribed-terrorist-groups-or-organisations-accessible-version",
        "access": "HTML accessible publication",
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
        "access": "public hatemap JSON; local jsonl only, do not commit",
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
    "ucdp": {
        "name": "Uppsala Conflict Data Program",
        "list": "Georeferenced Event Dataset",
        "kind": "research",
        "orientation": "academic",
        "basis": "coded news and NGO reports of organized violence",
        "legal_status": "none",
        "appeal": "UCDP codebook / errata",
        "url": "https://ucdp.uu.se/downloads/ged/ged241-csv.zip",
        "access": "public CSV zip with lat/lon",
        "terms": "ucdp-citation",
    },
    "acled": {
        "name": "Armed Conflict Location & Event Data Project",
        "list": "ACLED events",
        "kind": "research",
        "orientation": "academic",
        "basis": "coded political violence and protest events",
        "legal_status": "none",
        "appeal": "ACLED terms / key",
        "url": "https://api.acleddata.com/acled/read",
        "access": "API key; local CSV ingest if DNS/key fail",
        "terms": "acled-terms",
    },
}

RESTRICTED_TERMS = frozenset({"no-bulk-redistribution"})
VIOLENCE_DESIGNATORS = frozenset({"ucdp", "acled"})


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
    person: bool = False,
    lat: float | None = None,
    lon: float | None = None,
    rec_class: str = "designation",
) -> dict:
    meta = DESIGNATORS.get(designator, {})
    loc_country = country or None
    loc_state = state or None
    loc_fips = county_fips or None
    loc_street = street or None
    loc_city = city or None
    loc_zip = zip_code or None
    is_person = bool(person) or claim_type in ("sanctions_individual",)
    if loc_street:
        grain = "street"
    elif loc_city:
        grain = "city"
    elif loc_fips:
        grain = "county"
    elif loc_state:
        grain = "state"
    elif loc_country:
        grain = "country"
    else:
        grain = "name"
    loc = {
        "county_fips": loc_fips,
        "state": loc_state,
        "country": loc_country,
        "granularity": grain,
        "street": loc_street,
        "city": loc_city,
        "zip": loc_zip,
    }
    if lat is not None and lon is not None:
        loc["lat"] = float(lat)
        loc["lon"] = float(lon)
    return {
        "schema_version": "1.0",
        "class": rec_class,
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
        "person": is_person,
        "location": loc,
        "source_url": source_url or meta.get("url"),
        "retrieved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "raw_sha256": hashlib.sha256(
            json.dumps(raw, sort_keys=True).encode()
        ).hexdigest()
        if raw
        else None,
    }


def fetch(url: str, timeout: float = 180, browser: bool = False) -> bytes:
    ua = BROWSER_UA if browser else UA
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": ua,
            "Accept": "text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def strip_tags(blob: str) -> str:
    text = re.sub(r"<[^>]+>", " ", blob or "")
    return html_lib.unescape(re.sub(r"\s+", " ", text)).strip()


class HtmlTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tables: list[list[list[str]]] = []
        self._table: list[list[str]] | None = None
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self._table = []
            self.tables.append(self._table)
        elif tag == "tr" and self._table is not None:
            self._row = []
            self._table.append(self._row)
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []
        elif tag == "br" and self._cell is not None:
            self._cell.append(" ")

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._cell is not None and self._row is not None:
            self._row.append(html_lib.unescape(re.sub(r"\s+", " ", "".join(self._cell))).strip())
            self._cell = None
        elif tag == "tr":
            self._row = None
        elif tag == "table":
            self._table = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


def parse_html_tables(blob: bytes | str) -> list[list[list[str]]]:
    text = blob.decode("utf-8", "replace") if isinstance(blob, (bytes, bytearray)) else blob
    parser = HtmlTableParser()
    parser.feed(text)
    return parser.tables


def ingest_un_xml(blob: bytes, include_individuals: bool = True) -> tuple[list, dict]:
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
            person = False
        else:
            addr = address_block(el, "INDIVIDUAL_ADDRESS")
            if not addr.get("country"):
                addr["country"] = nested_text(el, "NATIONALITY", "VALUE")
            claim = "sanctions_individual"
            person = True
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
                person=person,
                raw={"ref": child_text(el, "REFERENCE_NUMBER"), "list": child_text(el, "UN_LIST_TYPE")},
            )
        )
    return records, {
        "designator": "un_sanctions",
        "records": len(records),
        "skipped_individuals": skipped_people,
        "skipped_empty": skipped_empty,
    }


def ingest_un(include_individuals: bool = True) -> tuple[list, dict]:
    url = DESIGNATORS["un_sanctions"]["url"]
    try:
        blob = fetch(url)
    except Exception as err:  # noqa: BLE001
        return [], {"designator": "un_sanctions", "error": str(err)}
    try:
        return ingest_un_xml(blob, include_individuals=include_individuals)
    except ET.ParseError as err:
        return [], {"designator": "un_sanctions", "error": f"parse: {err}"}


def ingest_fto_html(blob: bytes | str) -> tuple[list, dict]:
    tables = parse_html_tables(blob)
    records: list[dict] = []
    skipped = 0
    if not tables:
        return [], {"designator": "state_fto", "error": "no tables in FTO page"}
    current = tables[0]
    removed = tables[1] if len(tables) > 1 else []
    header = [c.lower() for c in (current[0] if current else [])]
    name_i = next((i for i, h in enumerate(header) if "name" in h), 1)
    date_i = next((i for i, h in enumerate(header) if "date" in h), 0)
    for row in current[1:]:
        if len(row) <= name_i:
            skipped += 1
            continue
        name = row[name_i].strip()
        if not name or name.lower() == "name":
            skipped += 1
            continue
        asserted = row[date_i].strip() if len(row) > date_i else None
        records.append(
            designation_record(
                "state_fto",
                name,
                country=None,
                claim_type="legal_designation",
                asserted=asserted,
                status="listed",
                raw={"date": asserted, "name": name},
            )
        )
    if removed:
        rheader = [c.lower() for c in removed[0]]
        rname = next((i for i, h in enumerate(rheader) if h == "name" or "name" in h), 1)
        rdate = next((i for i, h in enumerate(rheader) if "removed" in h), 0)
        orig = next((i for i, h in enumerate(rheader) if "originally" in h), None)
        for row in removed[1:]:
            if len(row) <= rname:
                continue
            name = row[rname].strip()
            if not name:
                continue
            records.append(
                designation_record(
                    "state_fto",
                    name,
                    country=None,
                    claim_type="legal_designation",
                    asserted=row[orig].strip() if orig is not None and len(row) > orig else None,
                    status="removed",
                    raw={"removed": row[rdate] if len(row) > rdate else None, "name": name},
                )
            )
    return records, {
        "designator": "state_fto",
        "records": len(records),
        "skipped": skipped,
        "listed": sum(1 for r in records if r["status"] == "listed"),
        "removed": sum(1 for r in records if r["status"] == "removed"),
    }


def ingest_fto() -> tuple[list, dict]:
    url = DESIGNATORS["state_fto"]["url"]
    try:
        blob = fetch(url, browser=True)
    except Exception as err:  # noqa: BLE001
        return [], {"designator": "state_fto", "error": str(err)}
    return ingest_fto_html(blob)


UK_PROSCRIBED_RE = re.compile(
    r"^(?P<name>.+):\s*Proscribed\s+(?P<when>.+)$", re.I
)


def ingest_uk_html(blob: bytes | str) -> tuple[list, dict]:
    text = blob.decode("utf-8", "replace") if isinstance(blob, (bytes, bytearray)) else blob
    records = []
    skipped = 0
    for raw in re.findall(r"<h3[^>]*>(.*?)</h3>", text, re.I | re.S):
        title = strip_tags(raw)
        match = UK_PROSCRIBED_RE.match(title)
        if not match:
            continue
        name = match.group("name").strip()
        when = match.group("when").strip()
        if not name:
            skipped += 1
            continue
        records.append(
            designation_record(
                "uk_proscribed",
                name,
                country="United Kingdom",
                claim_type="legal_designation",
                asserted=when,
                status="listed",
                raw={"heading": title},
            )
        )
    return records, {
        "designator": "uk_proscribed",
        "records": len(records),
        "skipped": skipped,
    }


def ingest_uk() -> tuple[list, dict]:
    url = DESIGNATORS["uk_proscribed"]["url"]
    try:
        blob = fetch(url)
    except Exception as err:  # noqa: BLE001
        return [], {"designator": "uk_proscribed", "error": str(err)}
    return ingest_uk_html(blob)


def _eu_attr(el: ET.Element, name: str) -> str:
    if name in el.attrib:
        return (el.attrib.get(name) or "").strip()
    for key, val in el.attrib.items():
        if key.split("}")[-1] == name and val:
            return val.strip()
    return ""


def ingest_eu_xml(blob: bytes, include_individuals: bool = True) -> tuple[list, dict]:
    records = []
    skipped_people = 0
    skipped_empty = 0
    try:
        root = ET.fromstring(blob)
    except ET.ParseError as err:
        return [], {"designator": "eu_sanctions", "error": f"parse: {err}"}
    for el in root.iter():
        if local_tag(el) != "sanctionEntity":
            continue
        subject = "enterprise"
        names: list[str] = []
        street = city = state = country = zip_code = None
        for child in el:
            tag = local_tag(child)
            if tag == "subjectType":
                subject = (_eu_attr(child, "code") or child_text(child, "code") or subject).lower()
            elif tag == "nameAlias":
                whole = _eu_attr(child, "wholeName")
                if whole:
                    names.append(whole)
            elif tag == "address":
                street = street or _eu_attr(child, "street") or None
                city = city or _eu_attr(child, "city") or None
                state = state or _eu_attr(child, "region") or None
                zip_code = zip_code or _eu_attr(child, "zipCode") or None
                country = (
                    country
                    or _eu_attr(child, "countryDescription")
                    or _eu_attr(child, "countryIso2Code")
                    or None
                )
        is_person = subject in ("person", "individual")
        if is_person and not include_individuals:
            skipped_people += 1
            continue
        name = names[0] if names else ""
        if not name:
            skipped_empty += 1
            continue
        records.append(
            designation_record(
                "eu_sanctions",
                name,
                country=country,
                state=state,
                street=street,
                city=city,
                zip_code=zip_code,
                claim_type="sanctions_individual" if is_person else "sanctions_entity",
                status="listed",
                person=is_person,
                ref=_eu_attr(el, "euReferenceNumber") or None,
                raw={"subject": subject, "ref": _eu_attr(el, "euReferenceNumber")},
            )
        )
    return records, {
        "designator": "eu_sanctions",
        "records": len(records),
        "skipped_individuals": skipped_people,
        "skipped_empty": skipped_empty,
    }


def ingest_eu(include_individuals: bool = True) -> tuple[list, dict]:
    url = DESIGNATORS["eu_sanctions"]["url"]
    try:
        blob = fetch(url, timeout=300)
    except Exception as err:  # noqa: BLE001
        return [], {"designator": "eu_sanctions", "error": str(err)}
    return ingest_eu_xml(blob, include_individuals=include_individuals)


def ingest_ucdp_csv(
    blob: bytes | str,
    year_min: int = 2020,
    deaths_min: int = 1,
    cap: int = 8000,
) -> tuple[list, dict]:
    text = blob.decode("utf-8", "replace") if isinstance(blob, (bytes, bytearray)) else blob
    reader = csv.DictReader(io.StringIO(text))
    ranked: list[tuple[int, dict]] = []
    skipped = 0
    for row in reader:
        try:
            year = int(float(row.get("year") or 0))
            deaths = int(float(row.get("best") or 0))
            lat = float(row["latitude"])
            lon = float(row["longitude"])
        except (TypeError, ValueError, KeyError):
            skipped += 1
            continue
        if year < year_min or deaths < deaths_min:
            continue
        name = (row.get("conflict_name") or row.get("dyad_name") or "event").strip()
        rec = designation_record(
            "ucdp",
            name,
            country=row.get("country") or None,
            state=row.get("adm_1") or None,
            city=row.get("where_coordinates") or row.get("adm_2") or None,
            claim_type="attributed_violence",
            asserted=row.get("date_start") or str(year),
            status="event",
            ref=row.get("id") or row.get("relid"),
            lat=lat,
            lon=lon,
            rec_class="violence",
            raw={
                "year": year,
                "best": deaths,
                "type": row.get("type_of_violence"),
                "side_a": row.get("side_a"),
                "side_b": row.get("side_b"),
            },
        )
        rec["deaths"] = deaths
        rec["year"] = year
        ranked.append((deaths, rec))
    ranked.sort(key=lambda item: item[0], reverse=True)
    records = [rec for _, rec in ranked[:cap]]
    return records, {
        "designator": "ucdp",
        "records": len(records),
        "skipped": skipped,
        "year_min": year_min,
        "cap": cap,
    }


def ingest_ucdp_zip(blob: bytes, **kwargs) -> tuple[list, dict]:
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
        if not names:
            return [], {"designator": "ucdp", "error": "zip has no csv"}
        return ingest_ucdp_csv(zf.read(names[0]), **kwargs)


def ingest_ucdp(**kwargs) -> tuple[list, dict]:
    url = DESIGNATORS["ucdp"]["url"]
    try:
        blob = fetch(url, timeout=300)
    except Exception as err:  # noqa: BLE001
        return [], {"designator": "ucdp", "error": str(err)}
    if blob[:2] == b"PK":
        return ingest_ucdp_zip(blob, **kwargs)
    return ingest_ucdp_csv(blob, **kwargs)


def ingest_splc_hatemap(blob: bytes | str) -> tuple[list, dict]:
    data = json.loads(blob if isinstance(blob, str) else blob.decode("utf-8"))
    chapters = data.get("hate_chapters") or data.get("chapters") or []
    records = []
    skipped = 0
    for ch in chapters:
        name = (ch.get("name") or "").strip()
        if not name:
            skipped += 1
            continue
        lat = lon = None
        try:
            if ch.get("latitude") not in (None, "") and ch.get("longitude") not in (None, ""):
                lat = float(ch["latitude"])
                lon = float(ch["longitude"])
        except (TypeError, ValueError):
            lat = lon = None
        rec = designation_record(
            "splc",
            name,
            state=ch.get("state") or ch.get("state_name"),
            city=ch.get("city_name") or ch.get("city"),
            country="US",
            claim_type="ngo_designation",
            lat=lat,
            lon=lon,
            raw={
                "ideology": ch.get("ideology_name") or ch.get("ideology"),
                "city": ch.get("city_name"),
            },
        )
        rec["ideology"] = ch.get("ideology_name") or ch.get("ideology")
        records.append(rec)
    return records, {
        "designator": "splc",
        "records": len(records),
        "skipped": skipped,
        "redistribute": False,
    }


def ingest_splc(year: int = 2024) -> tuple[list, dict]:
    url = f"https://www.splcenter.org/wp-json/splc/v1/hatemap?year={year}&lang_code=en"
    try:
        blob = fetch(url, browser=True)
    except Exception as err:  # noqa: BLE001
        return [], {"designator": "splc", "error": str(err)}
    records, meta = ingest_splc_hatemap(blob)
    meta["year"] = year
    return records, meta


def ingest_acled_csv(blob: bytes | str, cap: int = 8000) -> tuple[list, dict]:
    text = blob.decode("utf-8", "replace") if isinstance(blob, (bytes, bytearray)) else blob
    reader = csv.DictReader(io.StringIO(text))
    records = []
    skipped = 0
    for row in reader:
        if len(records) >= cap:
            break
        try:
            lat = float(row.get("latitude") or row.get("lat"))
            lon = float(row.get("longitude") or row.get("lon"))
        except (TypeError, ValueError):
            skipped += 1
            continue
        name = (row.get("actor1") or row.get("event_type") or "event").strip()
        rec = designation_record(
            "acled",
            name,
            country=row.get("country") or None,
            state=row.get("admin1") or None,
            city=row.get("location") or None,
            claim_type="attributed_violence",
            asserted=row.get("event_date"),
            status="event",
            lat=lat,
            lon=lon,
            rec_class="violence",
            raw={"event_type": row.get("event_type"), "fatalities": row.get("fatalities")},
        )
        records.append(rec)
    return records, {"designator": "acled", "records": len(records), "skipped": skipped}


def ingest_acled() -> tuple[list, dict]:
    url = DESIGNATORS["acled"]["url"]
    try:
        blob = fetch(url, timeout=60)
    except Exception as err:  # noqa: BLE001
        return [], {"designator": "acled", "error": str(err)}
    try:
        data = json.loads(blob.decode("utf-8"))
    except json.JSONDecodeError:
        return ingest_acled_csv(blob)
    rows = data.get("data") or data.get("results") or []
    if not rows:
        return [], {"designator": "acled", "error": "empty ACLED payload", "raw_keys": list(data)[:8]}
    records = []
    for row in rows[:8000]:
        try:
            lat = float(row.get("latitude"))
            lon = float(row.get("longitude"))
        except (TypeError, ValueError):
            continue
        rec = designation_record(
            "acled",
            (row.get("actor1") or row.get("event_type") or "event").strip(),
            country=row.get("country"),
            state=row.get("admin1"),
            city=row.get("location"),
            claim_type="attributed_violence",
            asserted=row.get("event_date"),
            status="event",
            lat=lat,
            lon=lon,
            rec_class="violence",
        )
        records.append(rec)
    return records, {"designator": "acled", "records": len(records)}


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
        "Attributed violence (UCDP / ACLED) is a third variable. Those records "
        "use class=violence and a separate globe layer.",
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


def compact_point(rec: dict, geo: dict | None = None) -> dict | None:
    loc = rec.get("location") or {}
    geo = geo or {}
    lat = geo.get("lat", loc.get("lat"))
    lon = geo.get("lon", loc.get("lon"))
    try:
        lat_f = float(lat)
        lon_f = float(lon)
    except (TypeError, ValueError):
        return None
    addr = ", ".join(
        p
        for p in (loc.get("street"), loc.get("city"), loc.get("state"), loc.get("country"))
        if p
    )
    return {
        "id": rec.get("ref") or rec.get("org_key"),
        "name": rec.get("org_name"),
        "lat": lat_f,
        "lon": lon_f,
        "designator": rec.get("designator_name"),
        "designator_id": rec.get("designator_id"),
        "designator_kind": rec.get("designator_kind"),
        "legal_status": rec.get("legal_status"),
        "claim_type": rec.get("claim_type"),
        "precision": geo.get("precision") or loc.get("granularity"),
        "address": addr,
        "url": rec.get("source_url"),
        "person": bool(rec.get("person")),
        "status": rec.get("status"),
        "deaths": rec.get("deaths"),
        "year": rec.get("year"),
    }


def pack_globe(
    records: list[dict],
    path: Path,
    *,
    include_restricted: bool = False,
    eu_people: bool = False,
    rec_class: str = "designation",
) -> dict:
    points = []
    skipped_restricted = 0
    skipped_eu_people = 0
    skipped_nogeo = 0
    for rec in records:
        if rec.get("class", "designation") != rec_class:
            continue
        meta = DESIGNATORS.get(rec.get("designator_id"), {})
        if meta.get("terms") in RESTRICTED_TERMS and not include_restricted:
            skipped_restricted += 1
            continue
        if (
            rec.get("designator_id") == "eu_sanctions"
            and rec.get("person")
            and not eu_people
        ):
            skipped_eu_people += 1
            continue
        point = compact_point(rec)
        if not point:
            skipped_nogeo += 1
            continue
        points.append(point)
    doc = {
        "source": "scripts/designations/designations.py",
        "class": rec_class,
        "count": len(points),
        "points": points,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "skipped": {
            "restricted": skipped_restricted,
            "eu_people": skipped_eu_people,
            "no_geo": skipped_nogeo,
        },
        "policy": "data/designations/geo/README.md",
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    return {"path": str(path), "count": len(points), "skipped": doc["skipped"]}


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


def _include_people(args) -> bool:
    return not args.entities_only


def _write_split(outdir: Path, records: list[dict], append: bool) -> None:
    designations = [r for r in records if r.get("class", "designation") == "designation"]
    violence = [r for r in records if r.get("class") == "violence"]
    if designations:
        write_jsonl(outdir / "designations.jsonl", designations, append=append)
        write_jsonl(outdir / "claims.jsonl", designations, append=append)
    if violence:
        write_jsonl(outdir / "violence.jsonl", violence, append=append)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument(
        "--ingest",
        choices=["un", "csv", "fto", "uk", "eu", "ucdp", "splc", "acled", "all"],
    )
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
    ap.add_argument("--include-individuals", action="store_true", help="deprecated; people are included by default")
    ap.add_argument("--entities-only", action="store_true", help="skip individuals")
    ap.add_argument("--xml", help="Local UN or EU XML instead of the live feed")
    ap.add_argument("--html", help="Local FTO or UK HTML instead of the live page")
    ap.add_argument("--year-min", type=int, default=2020)
    ap.add_argument("--cap", type=int, default=8000)
    ap.add_argument("--splc-year", type=int, default=2024)
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--pack", action="store_true")
    ap.add_argument("--api", default="globalstatus/api")
    ap.add_argument("--include-restricted", action="store_true")
    ap.add_argument("--eu-people", action="store_true")
    ap.add_argument("--list-designators", action="store_true")
    ap.add_argument("--out", default="data/designations")
    ap.add_argument("--append", action="store_true")
    args = ap.parse_args(argv)

    outdir = Path(args.out)
    jsonl = outdir / "designations.jsonl"
    people = _include_people(args)

    if args.list_designators:
        for key, meta in DESIGNATORS.items():
            print(f"{key:<16}{meta['kind']:<12}{meta['orientation']:<8}{meta['name']}")
            print(f"{'':<16}{meta['access']}")
            print(f"{'':<16}terms={meta['terms']}  {meta['url']}")
        return 0

    def run_one(kind: str) -> tuple[list, dict]:
        if kind == "un":
            if args.xml:
                return ingest_un_xml(Path(args.xml).read_bytes(), include_individuals=people)
            return ingest_un(include_individuals=people)
        if kind == "fto":
            if args.html:
                return ingest_fto_html(Path(args.html).read_bytes())
            return ingest_fto()
        if kind == "uk":
            if args.html:
                return ingest_uk_html(Path(args.html).read_bytes())
            return ingest_uk()
        if kind == "eu":
            if args.xml:
                return ingest_eu_xml(Path(args.xml).read_bytes(), include_individuals=people)
            return ingest_eu(include_individuals=people)
        if kind == "ucdp":
            return ingest_ucdp(year_min=args.year_min, cap=args.cap)
        if kind == "splc":
            print(
                "SPLC has no bulk redistribution license. jsonl stays local; "
                "do not commit designations.jsonl built from it.",
                file=sys.stderr,
            )
            if args.csv:
                return ingest_splc_hatemap(Path(args.csv).read_bytes())
            return ingest_splc(year=args.splc_year)
        if kind == "acled":
            if args.csv:
                return ingest_acled_csv(Path(args.csv).read_bytes(), cap=args.cap)
            return ingest_acled()
        return [], {"error": f"unknown ingest {kind}"}

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
        _write_split(outdir, records, append=True)
        print(json.dumps(meta))
        return 0

    if args.ingest:
        kinds = ["un", "fto", "uk", "eu", "ucdp", "splc", "acled"] if args.ingest == "all" else [args.ingest]
        metas = []
        first = not args.append
        for kind in kinds:
            records, meta = run_one(kind)
            metas.append(meta)
            if records:
                _write_split(outdir, records, append=not first)
                first = False
            print(json.dumps(meta))
        if first:
            return 1
        return 0 if any(m.get("records") for m in metas) else 1

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

    if args.pack:
        records = load_jsonl(jsonl) + load_jsonl(outdir / "violence.jsonl")
        if not records:
            print("no records; ingest something first", file=sys.stderr)
            return 1
        api = Path(args.api)
        des = pack_globe(
            records,
            api / "designations.json",
            include_restricted=args.include_restricted,
            eu_people=args.eu_people,
            rec_class="designation",
        )
        vio = pack_globe(
            records,
            api / "violence.json",
            include_restricted=args.include_restricted,
            rec_class="violence",
        )
        print(json.dumps({"designations": des, "violence": vio}))
        return 0

    ap.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
