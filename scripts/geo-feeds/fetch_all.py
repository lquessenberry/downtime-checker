#!/usr/bin/env python3
"""Fetch catalog feeds and write each layer in the shared envelope.

Envelope (schemaVersion 2):
  id, schemaVersion, source, sourceUrl, licence, credit, commercialUse,
  cadenceSeconds, fetchedAt (Unix seconds), stale, error, count, points

Aliases (same payload):
  license, attribution, fetched_at, ttl, features

Keys are read from the environment only. Never log or write secret values.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import extract  # noqa: E402

CATALOG_PATH = ROOT / "catalog.json"
MAX_FEATURES = 80
TIMEOUT = 25
MAX_BYTES = 2_500_000
SCHEMA_VERSION = 2

SECRET_QUERY_PARAMS = {
    "token",
    "key",
    "api_key",
    "apikey",
    "access_token",
    "auth",
    "secret",
    "password",
}

# id -> how the env key is applied. Values are never printed.
KEYED_FEEDS: dict[str, dict[str, str]] = {
    "waqi-bounds": {"env": "WAQI_TOKEN", "query": "token"},
    "openaq-locations": {"env": "OPENAQ_API_KEY", "header": "X-API-Key"},
    "open-charge-map": {"env": "OCM_API_KEY", "header": "X-API-Key"},
}

# Known but unprovisioned on this fork — skip unless the env var is present.
OPTIONAL_KEYED_FEEDS: dict[str, dict[str, str]] = {
    "ucdp-ged": {"env": "UCDP_ACCESS_TOKEN", "header": "Authorization"},
    "ucdp-ged-24": {"env": "UCDP_ACCESS_TOKEN", "header": "Authorization"},
    "healthsites-facilities": {"env": "HEALTHSITES_API_KEY", "header": "X-API-KEY"},
}


def load_catalog(path: Path | None = None) -> list[dict[str, Any]]:
    return json.loads((path or CATALOG_PATH).read_text(encoding="utf-8"))


def now_unix() -> int:
    return int(datetime.now(timezone.utc).timestamp())


def strip_secrets_from_url(url: str) -> str:
    parsed = urlparse(url)
    kept = [
        (k, v)
        for k, v in parse_qsl(parsed.query, keep_blank_values=True)
        if k.lower() not in SECRET_QUERY_PARAMS
    ]
    return urlunparse(parsed._replace(query=urlencode(kept, doseq=True)))


def ttl_seconds(cadence: str | None) -> int:
    text = (cadence or "").lower()
    if any(word in text for word in ("second", "real-time (seconds)")):
        return 300
    if "15" in text and "minute" in text:
        return 900
    if any(word in text for word in ("minute", "near real-time", "real-time", "as issued", "as events", "continuous")):
        return 300
    if "hour" in text:
        return 3600
    if "daily" in text or text.startswith("day") or "times daily" in text:
        return 86400
    if "week" in text:
        return 86400 * 7
    if "annual" in text or "edition" in text or "published" in text:
        return 86400 * 7
    if "community" in text:
        return 3600
    return 300


def env_for(row: dict[str, Any]) -> dict[str, str] | None:
    return KEYED_FEEDS.get(row["id"]) or OPTIONAL_KEYED_FEEDS.get(row["id"])


def missing_key_env(row: dict[str, Any]) -> str | None:
    cfg = env_for(row)
    if not cfg:
        return None
    value = os.environ.get(cfg["env"], "")
    if not str(value).strip():
        return cfg["env"]
    return None


def apply_auth(url: str, headers: dict[str, str], row: dict[str, Any]) -> tuple[str, dict[str, str], str | None]:
    """Attach a key from env. Returns (url, headers, skipped_env_name)."""
    cfg = env_for(row)
    if not cfg:
        return url, headers, None
    raw = os.environ.get(cfg["env"], "")
    value = str(raw).strip()
    if not value:
        return url, headers, cfg["env"]
    if "query" in cfg:
        parsed = urlparse(url)
        pairs = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True) if k.lower() != cfg["query"].lower()]
        pairs.append((cfg["query"], value))
        url = urlunparse(parsed._replace(query=urlencode(pairs, doseq=True)))
    if "header" in cfg:
        header_name = cfg["header"]
        if header_name.lower() == "authorization" and not value.lower().startswith(("bearer ", "token ")):
            headers[header_name] = f"Bearer {value}"
        else:
            headers[header_name] = value
    return url, headers, None


def eligible(row: dict[str, Any], ids: set[str] | None = None) -> bool:
    if ids and row["id"] not in ids:
        return False
    if row.get("link_only") or row.get("auth") in {"link-only", "paid"}:
        return False
    if row.get("category") == "registries-linkout":
        return False
    if extract.is_forbidden(row):
        return False
    if env_for(row) and missing_key_env(row):
        return False
    return True


def title_from(obj: Any, fallback: str) -> str:
    if not isinstance(obj, dict):
        return fallback
    props = obj.get("properties") if isinstance(obj.get("properties"), dict) else {}
    for key in ("title", "name", "place", "headline", "PLACE", "NAME", "incidentName", "IncidentName"):
        if props.get(key) not in (None, ""):
            return str(props[key])[:160]
    for key in (
        "title",
        "name",
        "place",
        "incidentName",
        "IncidentName",
        "callsign",
        "OBJECT_NAME",
        "place_name",
        "label",
        "station_id",
        "longName",
        "id",
    ):
        value = obj.get(key)
        if isinstance(value, dict):
            continue
        if value not in (None, ""):
            return str(value)[:160]
    return fallback


def as_feature(fid: str, kind: str, name: str, lon: float, lat: float, source: str, url: str, extra: dict | None = None) -> dict[str, Any]:
    props = {
        "id": fid,
        "kind": kind,
        "name": name,
        "source": source,
        "url": url,
        "category": kind,
        "title": name,
    }
    if extra:
        props.update(extra)
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [float(lon), float(lat)]},
        "properties": props,
    }


def point_from_feature(feat: dict[str, Any]) -> dict[str, Any]:
    props = feat.get("properties") or {}
    coords = (feat.get("geometry") or {}).get("coordinates") or [None, None]
    lon, lat = coords[0], coords[1]
    return {
        "id": props.get("id"),
        "kind": props.get("kind"),
        "name": props.get("name"),
        "lat": lat,
        "lon": lon,
        "status": props.get("status") or "ok",
        "url": props.get("url"),
        "description": props.get("description") or "",
    }


def extract_many(catalog_row: dict[str, Any], content: bytes, content_type: str, limit: int):
    """Reuse extract.extract_coords for a first point; also walk obvious lists."""
    points: list[tuple] = []
    lat, lon, path = extract.extract_coords(catalog_row, content, content_type)
    text = content.decode("utf-8", errors="replace")
    obj = None
    try:
        obj = extract.loads_partial(text)
    except Exception:
        obj = None

    def add(lat_, lon_, name, ident=None):
        if not extract.pair_ok(lat_, lon_):
            scaled = extract.scale_meshmap(lat_, lon_)
            if not scaled:
                return
            lat_, lon_ = scaled
        points.append((float(lat_), float(lon_), name, ident or name))

    def walk_items(items, kind_hint=""):  # noqa: ARG001
        if not isinstance(items, list):
            return
        for item in items[: limit * 2]:
            if len(points) >= limit:
                return
            if not isinstance(item, dict):
                continue
            got = extract.from_mapping(item) or extract.walk(item)
            if not got:
                continue
            add(
                got[0],
                got[1],
                title_from(item, catalog_row["name"]),
                str(item.get("id") or item.get("callsign") or "") or None,
            )

    if isinstance(obj, dict):
        for key in (
            "features",
            "data",
            "results",
            "records",
            "stations",
            "items",
            "ac",
            "aircraft",
            "markers",
            "events",
            "value",
            "hexes",
            "outage",
        ):
            if key not in obj:
                continue
            val = obj[key]
            if key == "features" and isinstance(val, list):
                for feat in val[:limit]:
                    if len(points) >= limit:
                        break
                    got = extract.walk(feat)
                    if got:
                        add(got[0], got[1], title_from(feat, catalog_row["name"]), (feat.get("id") if isinstance(feat, dict) else None))
            elif key == "value" and isinstance(val, dict) and "timeSeries" in val:
                for ts in val.get("timeSeries") or []:
                    if len(points) >= limit:
                        break
                    got = extract.extract_usgs_iv({"value": {"timeSeries": [ts]}})
                    if got:
                        name = ((ts.get("sourceInfo") or {}).get("siteName") or catalog_row["name"])
                        add(got[0], got[1], name)
            else:
                walk_items(val if isinstance(val, list) else [val])
        if not points and not any(isinstance(v, list) for v in obj.values()):
            for key, item in list(obj.items())[: limit * 2]:
                if len(points) >= limit:
                    break
                if not isinstance(item, dict):
                    continue
                got = extract.walk(item) or extract.from_mapping(item)
                if not got and "latitude" in item:
                    scaled = extract.scale_meshmap(item.get("latitude"), item.get("longitude"))
                    if scaled:
                        add(scaled[0], scaled[1], item.get("longName") or key, key)
                        continue
                if got:
                    add(got[0], got[1], title_from(item, key), key)
    elif isinstance(obj, list):
        walk_items(obj)

    if not points and lat is not None:
        add(lat, lon, catalog_row["name"], catalog_row["id"])
    if not points and (catalog_row.get("format") == "text" or "format=text" in catalog_row.get("endpoint", "")):
        for line in text.splitlines():
            if not line or line.startswith("#"):
                continue
            parts = line.split("|")
            if len(parts) >= 4:
                try:
                    la, lo = float(parts[2]), float(parts[3])
                except ValueError:
                    continue
                if extract.pair_ok(la, lo):
                    add(la, lo, parts[-1] if parts else catalog_row["name"], parts[0])
                    if len(points) >= limit:
                        break
    return points, path


def make_envelope(
    row: dict[str, Any],
    features: list[dict[str, Any]],
    fetched_at: int,
    error: str | None = None,
    stale: bool = False,
) -> dict[str, Any]:
    ttl = ttl_seconds(row.get("cadence"))
    source_url = strip_secrets_from_url(row.get("docs") or row.get("endpoint") or "")
    endpoint = strip_secrets_from_url(row.get("endpoint") or "")
    attribution = row.get("attribution") or row.get("provider") or ""
    licence = row.get("licence") or ""
    points = [point_from_feature(feat) for feat in features]
    return {
        "id": row["id"],
        "schemaVersion": SCHEMA_VERSION,
        "source": row.get("provider") or row["id"],
        "sourceUrl": endpoint or source_url,
        "licence": licence,
        "license": licence,
        "credit": attribution,
        "attribution": attribution,
        "commercialUse": row.get("commercial_use"),
        "cadenceSeconds": ttl,
        "ttl": ttl,
        "fetchedAt": int(fetched_at),
        "fetched_at": int(fetched_at),
        "stale": bool(stale),
        "error": error,
        "count": len(points),
        "points": points,
        "features": features,
    }


def http_get(url: str, headers: dict[str, str]) -> tuple[int, bytes, str]:
    req = Request(url, headers=headers, method="GET")
    try:
        with urlopen(req, timeout=TIMEOUT) as resp:
            chunks: list[bytes] = []
            total = 0
            while True:
                chunk = resp.read(16_384)
                if not chunk:
                    break
                chunks.append(chunk)
                total += len(chunk)
                if total >= MAX_BYTES:
                    break
            content_type = resp.headers.get("Content-Type", "")
            return int(getattr(resp, "status", 200) or 200), b"".join(chunks), content_type
    except HTTPError as exc:
        body = exc.read() if exc.fp else b""
        return int(exc.code), body[:MAX_BYTES], exc.headers.get("Content-Type", "") if exc.headers else ""


def fetch_row(row: dict[str, Any], limit: int, fetched_at: int) -> dict[str, Any]:
    cid = row["id"]
    safe_row = dict(row)
    safe_row["endpoint"] = strip_secrets_from_url(row["endpoint"])
    headers = dict(extract.headers_for({"id": cid, "format": row.get("format"), "endpoint": safe_row["endpoint"]}))
    url, headers, skipped = apply_auth(safe_row["endpoint"], headers, row)
    if skipped:
        return make_envelope(row, [], fetched_at, error=f"skipped: missing env {skipped}", stale=True)
    try:
        status, content, content_type = http_get(url, headers)
    except (URLError, TimeoutError, OSError) as exc:
        return make_envelope(row, [], fetched_at, error=f"{type(exc).__name__}", stale=True)
    if status >= 400:
        return make_envelope(row, [], fetched_at, error=f"HTTP {status}", stale=True)
    pts, path = extract_many(safe_row, content, content_type, limit)
    if not pts and row.get("sample_lat") is not None:
        pts = [(row["sample_lat"], row["sample_lon"], row["name"], cid)]
        path = row.get("coord_field_path") or "catalog sample"
    docs_url = strip_secrets_from_url(row.get("docs") or row["endpoint"])
    features = []
    for i, (lat, lon, name, ident) in enumerate(pts[:limit]):
        feat_id = f"{cid}:{ident or i}"
        features.append(
            as_feature(
                feat_id,
                row.get("category") or "layer",
                name,
                lon,
                lat,
                row.get("provider") or cid,
                docs_url,
                extra={
                    "feed": cid,
                    "coordPath": path or row.get("coord_field_path"),
                    "status": "ok",
                    "description": f"{row.get('provider')} · {path or row.get('coord_field_path')}",
                },
            )
        )
    return make_envelope(row, features, fetched_at)


def write_layer(layer_dir: Path, envelope: dict[str, Any]) -> Path:
    layer_dir.mkdir(parents=True, exist_ok=True)
    path = layer_dir / f"{envelope['id']}.json"
    path.write_text(json.dumps(envelope, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Fetch catalog feeds into the shared layer envelope.")
    parser.add_argument("--limit", type=int, default=MAX_FEATURES)
    parser.add_argument("--ids", default="", help="comma-separated catalog ids")
    parser.add_argument("--catalog", default=str(CATALOG_PATH))
    parser.add_argument("--out", default=str(ROOT / "layers"))
    parser.add_argument("--all-points", default=str(ROOT / "all_points.geojson"))
    args = parser.parse_args(argv)
    catalog = load_catalog(Path(args.catalog))
    ids = {part.strip() for part in args.ids.split(",") if part.strip()}
    feeds = [row for row in catalog if eligible(row, ids or None)]
    skipped_keyed = [
        row["id"]
        for row in catalog
        if (not ids or row["id"] in ids) and env_for(row) and missing_key_env(row)
    ]
    print(f"fetching {len(feeds)} feeds, cap {args.limit} features each", flush=True)
    if skipped_keyed:
        # Env var *names* only — never values.
        names = sorted({(env_for(row) or {}).get("env", "") for row in catalog if row["id"] in skipped_keyed})
        print(f"skipping {len(skipped_keyed)} keyed feeds (unset: {', '.join(n for n in names if n)})", flush=True)
    fetched_at = now_unix()
    layer_dir = Path(args.out)
    all_features: list[dict[str, Any]] = []

    for row in feeds:
        cid = row["id"]
        try:
            envelope = fetch_row(row, args.limit, fetched_at)
        except Exception as exc:  # noqa: BLE001 — keep a layer file even on unexpected errors
            envelope = make_envelope(row, [], fetched_at, error=type(exc).__name__, stale=True)
        write_layer(layer_dir, envelope)
        count = envelope["count"]
        err = envelope.get("error")
        status = "FAIL" if err else ("OK" if count else "NO")
        suffix = f" {err}" if err else ""
        print(f"  [{status}] {cid} {count} pts{suffix}", flush=True)
        all_features.extend(envelope.get("features") or [])

    collection = {
        "type": "FeatureCollection",
        "features": all_features,
        "properties": {
            "fetchedAt": fetched_at,
            "count": len(all_features),
            "feeds": len({feat.get("properties", {}).get("feed") for feat in all_features}),
        },
    }
    Path(args.all_points).write_text(json.dumps(collection, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote {len(all_features)} features from {collection['properties']['feeds']} feeds to {args.all_points}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
