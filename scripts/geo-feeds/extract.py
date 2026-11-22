#!/usr/bin/env python3
"""Coordinate extraction helpers for fetch_all.py (from the geo-feeds probe)."""
from __future__ import annotations

import csv
import json
import re
from datetime import datetime
from typing import Any
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

UA = "GeoFeedsCatalog/1.0 (research catalog for Lee Quessenberry; +https://github.com/lquessenberry/downtime-checker)"
BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
CT = ZoneInfo("America/Chicago")
TIMEOUT = 25
MAX_BYTES = 2_000_000
SAMPLE_BYTES = 24_000
WORKERS = 6

# Providers that often require a browser UA
BROWSER_IDS = {
    "healthmap-alerts", "gideon-animal-events", "meshmap-nodes",
    "hydroquebec-bisversion", "ornl-odin", "openmhz-systems",
    "gpsinterference-latest", "adsb-lol-mil", "adsb-lol-memphis",
    "airplanes-live-memphis", "adsb-fi-memphis", "websdr-list",
    "hearham-repeaters", "calfire-incidents",
}

# Never fetch these (licence, ToS, or explicit link-out).
def is_forbidden(c: dict) -> bool:
    if c.get("link_only"):
        return True
    if c.get("category") == "registries-linkout":
        return True
    if c["id"] in {"nsopw", "ar-sex-offender-registry", "tn-sex-offender-registry", "broadcastify-listen"}:
        return True
    return False


def now_ct() -> str:
    return datetime.now(CT).strftime("%Y-%m-%d %H:%M %Z")


def headers_for(c: dict) -> dict:
    h = {"User-Agent": BROWSER_UA if c["id"] in BROWSER_IDS else UA, "Accept": "*/*"}
    if c["format"] in {"GeoJSON", "JSON"} or "geojson" in c["endpoint"].lower():
        h["Accept"] = "application/geo+json, application/json, */*"
    if c["id"].startswith("nws-") or "api.weather.gov" in c["endpoint"]:
        h["User-Agent"] = UA
        h["Accept"] = "application/geo+json"
    if c["id"].startswith("metno"):
        h["User-Agent"] = UA
    if "aviationweather.gov" in c["endpoint"]:
        h["User-Agent"] = UA
    return h


def looks_like_lat(v: Any) -> bool:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return False
    return -90.0 <= f <= 90.0 and abs(f) > 0.00001 or f == 0.0


def looks_like_lon(v: Any) -> bool:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return False
    return -180.0 <= f <= 180.0


def pair_ok(lat, lon) -> bool:
    try:
        la, lo = float(lat), float(lon)
    except (TypeError, ValueError):
        return False
    if not (-90 <= la <= 90 and -180 <= lo <= 180):
        return False
    if la == 0 and lo == 0:
        return False
    return True


LAT_KEYS = ("lat", "latitude", "Latitude", "LAT", "LATITUDE", "dec_lat_va",
            "obsLat", "station_lat", "site_lat", "y", "geo_lat", "gs_lat",
            "senderLat", "receiverLat", "sLat", "rlat", "location_lat",
            "sr_location_lat", "decimalLatitude", "position_lat")
LON_KEYS = ("lon", "lng", "long", "longitude", "Longitude", "LON", "LONG",
            "LONGITUDE", "dec_long_va", "obsLon", "station_lon", "site_lon",
            "x", "geo_lon", "gs_lon", "senderLon", "receiverLon", "sLng",
            "rlon", "location_long", "sr_location_long", "decimalLongitude",
            "position_lon", "lng")


def from_mapping(obj: dict) -> tuple | None:
    # direct keys
    lower = {str(k).lower(): v for k, v in obj.items()}
    lat = lon = None
    for k in ("lat", "latitude", "dec_lat_va", "declat", "obs_lat", "gs_lat",
              "decimalLatitude".lower(), "senderlat", "latitude_deg", "y",
              "geo_lat", "location_latitude", "sr_location_lat", "reclat",
              "stationlat", "latitude_measure"):
        if k in lower and looks_like_lat(lower[k]):
            lat = lower[k]
            break
    for k in ("lon", "lng", "long", "longitude", "dec_long_va", "declon",
              "obs_lon", "gs_lon", "decimallongitude", "senderlon",
              "longitude_deg", "x", "geo_long", "geo_lon", "location_longitude",
              "sr_location_long", "reclon", "stationlon", "longitude_measure"):
        if k in lower and looks_like_lon(lower[k]):
            lon = lower[k]
            break
    if pair_ok(lat, lon):
        return float(lat), float(lon), "object.lat/lon (or aliases)"
    # nested coordinates
    for key in ("coordinates", "coord", "position", "location", "geopoint", "geo"):
        val = obj.get(key) or lower.get(key)
        if isinstance(val, dict):
            got = from_mapping(val)
            if got:
                return got[0], got[1], f"{key}." + got[2]
        if isinstance(val, (list, tuple)) and len(val) >= 2:
            a, b = val[0], val[1]
            # GeoJSON is lon,lat
            if pair_ok(b, a):
                return float(b), float(a), f"{key}[lon,lat]"
            if pair_ok(a, b):
                return float(a), float(b), f"{key}[lat,lon]"
        if isinstance(val, str) and "," in val:
            parts = [p.strip() for p in val.replace("(", "").replace(")", "").split(",")]
            if len(parts) >= 2:
                if pair_ok(parts[0], parts[1]):
                    return float(parts[0]), float(parts[1]), f"{key} 'lat,lon' string"
                if pair_ok(parts[1], parts[0]):
                    return float(parts[1]), float(parts[0]), f"{key} 'lon,lat' string"
    # ISS style
    if "iss_position" in obj and isinstance(obj["iss_position"], dict):
        got = from_mapping(obj["iss_position"])
        if got:
            return got
    if "geometry" in obj and isinstance(obj["geometry"], dict):
        got = extract_geojson_geom(obj["geometry"])
        if got:
            return got
    return None


def extract_geojson_geom(geom: dict) -> tuple | None:
    if not isinstance(geom, dict):
        return None
    coords = geom.get("coordinates")
    if not coords:
        return None
    gtype = (geom.get("type") or "").lower()
    def first_point(c):
        if isinstance(c, (list, tuple)) and c and isinstance(c[0], (int, float, str)):
            return c
        if isinstance(c, (list, tuple)) and c:
            return first_point(c[0])
        return None
    pt = first_point(coords)
    if pt and len(pt) >= 2 and pair_ok(pt[1], pt[0]):
        path = "geometry.coordinates[lon,lat]" if gtype in {"point", ""} else "geometry.coordinates (first point of %s)" % (gtype or "geometry")
        return float(pt[1]), float(pt[0]), path
    return None


def walk(obj: Any, depth: int = 0, max_depth: int = 8) -> tuple | None:
    if depth > max_depth:
        return None
    if isinstance(obj, dict):
        # GeoJSON FeatureCollection
        if obj.get("type") == "FeatureCollection" and isinstance(obj.get("features"), list):
            for feat in obj["features"]:
                got = walk(feat, depth + 1, max_depth)
                if got:
                    return got[0], got[1], "features[]." + got[2]
        if obj.get("type") == "Feature":
            if isinstance(obj.get("geometry"), dict):
                got = extract_geojson_geom(obj["geometry"])
                if got:
                    return got
            if isinstance(obj.get("properties"), dict):
                got = from_mapping(obj["properties"])
                if got:
                    return got[0], got[1], "properties." + got[2]
        got = from_mapping(obj)
        if got:
            return got
        # Meshtastic / meshmap integer microdegrees
        lower = {str(k).lower(): v for k, v in obj.items()}
        if "latitude" in lower and "longitude" in lower:
            scaled = scale_meshmap(lower["latitude"], lower["longitude"])
            if scaled:
                return scaled[0], scaled[1], "latitude/longitude (Meshtastic 1e-7 deg)"
        if "the_geom" in lower and isinstance(lower["the_geom"], str):
            ew = decode_ewkb_point(lower["the_geom"])
            if ew:
                return ew[0], ew[1], "the_geom EWKB point"
        for key in ("receiverlocator", "senderlocator", "locator", "grid", "gridsquare"):
            if key in lower and isinstance(lower[key], str):
                mh = maidenhead_to_ll(lower[key])
                if mh:
                    return mh[0], mh[1], f"{key} Maidenhead locator"
        # common containers
        for key in ("features", "data", "results", "records", "items", "events",
                    "stations", "value", "timeSeries", "ac", "aircraft", "states",
                    "markers", "pois", "observations", "rows", "result", "content",
                    "alerts", "entities", "sondes", "boxes", "notes", "list",
                    "vehicles", "bus", "queries", "geometries"):
            if key in obj:
                got = walk(obj[key], depth + 1, max_depth)
                if got:
                    return got[0], got[1], f"{key}[]." + got[2] if isinstance(obj[key], list) else f"{key}." + got[2]
        # walk values limited
        for i, (k, v) in enumerate(obj.items()):
            if i > 40:
                break
            if k in ("type", "crs", "metadata", "pagination", "links"):
                continue
            got = walk(v, depth + 1, max_depth)
            if got:
                return got[0], got[1], f"{k}." + got[2]
    elif isinstance(obj, list):
        if obj and all(isinstance(x, (int, float)) for x in obj[:2]) and len(obj) >= 2:
            a, b = obj[0], obj[1]
            if pair_ok(b, a):
                return float(b), float(a), "[lon,lat] numeric pair"
            if pair_ok(a, b):
                return float(a), float(b), "[lat,lon] numeric pair"
        for item in obj[:80]:
            got = walk(item, depth + 1, max_depth)
            if got:
                return got
    return None


def extract_opensky(obj: dict) -> tuple | None:
    states = obj.get("states")
    if isinstance(states, list) and states:
        s = states[0]
        if isinstance(s, list) and len(s) > 6 and pair_ok(s[6], s[5]):
            # OpenSky: [icao, callsign, origin, time, last, lon, lat, ...]
            return float(s[6]), float(s[5]), "states[][6]=lat, states[][5]=lon"
        if isinstance(s, list) and len(s) > 6 and pair_ok(s[5], s[6]):
            return float(s[5]), float(s[6]), "states[][5]=lat, states[][6]=lon"
    return None


def extract_ndbc(text: str) -> tuple | None:
    # skip comment lines starting with #
    for line in text.splitlines():
        if not line or line.startswith("#") or line.startswith("STN"):
            continue
        parts = line.split()
        # typically STN LAT LON ...
        if len(parts) >= 3 and pair_ok(parts[1], parts[2]):
            return float(parts[1]), float(parts[2]), "column 2=lat, column 3=lon (whitespace TXT)"
    return None


def extract_csv(text: str) -> tuple | None:
    lines = [ln for ln in text.splitlines() if ln.strip() and not ln.startswith("#")]
    if len(lines) < 2:
        return None
    try:
        reader = csv.DictReader(lines)
        rows = []
        for i, row in enumerate(reader):
            rows.append(row)
            if i >= 30:
                break
    except Exception:
        return None
    if not rows:
        return None
    for row in rows:
        got = from_mapping(row)
        if got:
            keys = list(row.keys())
            return got[0], got[1], "CSV columns " + ",".join(keys[:12])
    # FIRMS: latitude,longitude
    return None


def extract_rdb(text: str) -> tuple | None:
    # USGS RDB: comments #, then header, then dashes, then rows
    lines = [ln for ln in text.splitlines() if not ln.startswith("#") and ln.strip()]
    if len(lines) < 3:
        return None
    header = lines[0].split("\t")
    for line in lines[2:]:
        cols = line.split("\t")
        row = {header[i]: cols[i] if i < len(cols) else "" for i in range(len(header))}
        got = from_mapping(row)
        if got:
            return got[0], got[1], "RDB fields dec_lat_va, dec_long_va"
    return None


def extract_xml(text: str) -> tuple | None:
    # GeoRSS, Atom, CAP, PSKReporter, KML
    # georss:point>lat lon
    m = re.search(r"<georss:point>\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*</georss:point>", text, re.I)
    if m and pair_ok(m.group(1), m.group(2)):
        return float(m.group(1)), float(m.group(2)), "georss:point (lat lon)"
    m = re.search(r"<geo:lat>\s*([+-]?\d+(?:\.\d+)?)\s*</geo:lat>.*?<geo:long>\s*([+-]?\d+(?:\.\d+)?)\s*</geo:long>", text, re.I | re.S)
    if m and pair_ok(m.group(1), m.group(2)):
        return float(m.group(1)), float(m.group(2)), "geo:lat / geo:long"
    m = re.search(r"<lat>\s*([+-]?\d+(?:\.\d+)?)\s*</lat>.*?<(?:lon|long|lng)>\s*([+-]?\d+(?:\.\d+)?)\s*</(?:lon|long|lng)>", text, re.I | re.S)
    if m and pair_ok(m.group(1), m.group(2)):
        return float(m.group(1)), float(m.group(2)), "XML <lat>/<lon>"
    m = re.search(r"<coordinates>\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)", text, re.I)
    if m:
        # KML is lon,lat
        if pair_ok(m.group(2), m.group(1)):
            return float(m.group(2)), float(m.group(1)), "KML/XML <coordinates> lon,lat"
    # PSKReporter: senderLatitude senderLongitude as attributes or elements
    m = re.search(r'senderLatitude="([+-]?\d+(?:\.\d+)?)"[^>]*senderLongitude="([+-]?\d+(?:\.\d+)?)"', text, re.I)
    if m and pair_ok(m.group(1), m.group(2)):
        return float(m.group(1)), float(m.group(2)), "PSKReporter @senderLatitude/@senderLongitude"
    m = re.search(r"<receiverLat>\s*([+-]?\d+(?:\.\d+)?)\s*</receiverLat>.*?<receiverLon>\s*([+-]?\d+(?:\.\d+)?)\s*</receiverLon>", text, re.I | re.S)
    if m and pair_ok(m.group(1), m.group(2)):
        return float(m.group(1)), float(m.group(2)), "XML receiverLat/receiverLon"
    # CAP polygon / circle
    m = re.search(r"<circle>\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)", text, re.I)
    if m and pair_ok(m.group(1), m.group(2)):
        return float(m.group(1)), float(m.group(2)), "CAP <circle> lat,lon radius"
    m = re.search(r"<polygon>\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)", text, re.I)
    if m and pair_ok(m.group(1), m.group(2)):
        return float(m.group(1)), float(m.group(2)), "CAP <polygon> first lat,lon"
    # TfL cycle hire: lat="..." long="..."
    m = re.search(r'\blat="([+-]?\d+(?:\.\d+)?)"[^>]*\blong="([+-]?\d+(?:\.\d+)?)"', text, re.I)
    if m and pair_ok(m.group(1), m.group(2)):
        return float(m.group(1)), float(m.group(2)), "XML attributes lat/long"
    m = re.search(r'\blatitude="([+-]?\d+(?:\.\d+)?)"[^>]*\blongitude="([+-]?\d+(?:\.\d+)?)"', text, re.I)
    if m and pair_ok(m.group(1), m.group(2)):
        return float(m.group(1)), float(m.group(2)), "XML attributes latitude/longitude"
    return None


def extract_websdr(text: str) -> tuple | None:
    # Various historic formats; often q=lat,lon or lat/lon fields
    m = re.search(r"\blat[=:][ ]*([+-]?\d+(?:\.\d+)?)[,\s]+lon[=:][ ]*([+-]?\d+(?:\.\d+)?)", text, re.I)
    if m and pair_ok(m.group(1), m.group(2)):
        return float(m.group(1)), float(m.group(2)), "WebSDR list lat=/lon="
    m = re.search(r"\b([+-]?\d{1,2}\.\d{2,})[,/ ]([+-]?\d{1,3}\.\d{2,})\b", text)
    if m and pair_ok(m.group(1), m.group(2)):
        return float(m.group(1)), float(m.group(2)), "WebSDR list first lat,lon-like pair"
    return None


def extract_usgs_iv(obj: dict) -> tuple | None:
    # value.timeSeries[].sourceInfo.geoLocation.geogLocation.latitude
    try:
        ts = obj["value"]["timeSeries"]
        geo = ts[0]["sourceInfo"]["geoLocation"]["geogLocation"]
        lat, lon = geo["latitude"], geo["longitude"]
        if pair_ok(lat, lon):
            return float(lat), float(lon), "value.timeSeries[].sourceInfo.geoLocation.geogLocation.latitude/longitude"
    except (KeyError, IndexError, TypeError):
        pass
    return None


def extract_celestrak_tle(obj) -> tuple | None:
    # No lat/lon in TLE; return a sentinel so caller can try SGP4
    rec = None
    if isinstance(obj, list) and obj and isinstance(obj[0], dict):
        rec = obj[0]
    elif isinstance(obj, dict) and ("TLE_LINE1" in obj or "OBJECT_NAME" in obj or "MEAN_MOTION" in obj):
        rec = obj
    if not rec:
        return None
    # Try sgp4
    try:
        from sgp4.api import Satrec, jday
        from datetime import datetime, timezone
        l1 = rec.get("TLE_LINE1") or rec.get("TLE_LINE1".lower())
        l2 = rec.get("TLE_LINE2") or rec.get("TLE_LINE2".lower())
        # GP format may use MEAN_MOTION etc without TLE lines
        if not l1:
            # CelesTrak JSON GP often includes "TLE_LINE0/1/2" or only Keplerian
            return None  # handled later
        sat = Satrec.twoline2rv(l1, l2)
        now = datetime.now(timezone.utc)
        jd, fr = jday(now.year, now.month, now.day, now.hour, now.minute, now.second + now.microsecond / 1e6)
        e, r, v = sat.sgp4(jd, fr)
        if e != 0:
            return None
        # r is ECI km; convert roughly to lat/lon via simple ECEF approx (ignoring sidereal time is WRONG)
        # Use pymap3d or astropy if available; otherwise a proper GMST conversion:
        import math
        x, y, z = r
        # Greenwich sidereal
        t = (jd - 2451545.0) / 36525.0
        gmst = 280.46061837 + 360.98564736629 * ((jd - 2451545.0) + fr) + 0.000387933 * t * t
        gmst = math.radians(gmst % 360.0)
        lon = math.degrees(math.atan2(y, x) - gmst)
        lon = (lon + 180) % 360 - 180
        hyp = math.sqrt(x * x + y * y)
        lat = math.degrees(math.atan2(z, hyp))
        if pair_ok(lat, lon):
            return float(lat), float(lon), "derived from TLE via SGP4 (sub-satellite point)"
    except Exception:
        return None
    return None



def maidenhead_to_ll(locator: str):
    loc = (locator or "").strip().upper()
    if len(loc) < 4 or not loc[0].isalpha() or not loc[1].isalpha() or not loc[2].isdigit() or not loc[3].isdigit():
        return None
    lon = (ord(loc[0]) - ord("A")) * 20 - 180 + int(loc[2]) * 2
    lat = (ord(loc[1]) - ord("A")) * 10 - 90 + int(loc[3]) * 1
    if len(loc) >= 6 and loc[4].isalpha() and loc[5].isalpha():
        lon += (ord(loc[4]) - ord("A")) * (2 / 24) + (1 / 24)
        lat += (ord(loc[5]) - ord("A")) * (1 / 24) + (0.5 / 24)
    else:
        lon += 1.0
        lat += 0.5
    if pair_ok(lat, lon):
        return float(lat), float(lon)
    return None


def decode_ewkb_point(hexstr: str):
    """Decode a little-endian WGS84 EWKB point (PostGIS hex)."""
    import binascii, struct
    try:
        h = hexstr.strip()
        if len(h) < 42:
            return None
        raw = binascii.unhexlify(h[:50])
        # 01 endian, 01000020 type+srid flag, 4 byte srid, then two doubles
        if raw[0] != 1:
            return None
        lon, lat = struct.unpack_from("<dd", raw, len(raw) - 16)
        if pair_ok(lat, lon):
            return float(lat), float(lon)
    except Exception:
        return None
    return None


def loads_partial(text: str):
    """Parse JSON, or the leading complete objects of a truncated array/object."""
    try:
        return json.loads(text)
    except Exception:
        pass
    s = text.lstrip()
    dec = json.JSONDecoder()
    if s.startswith("["):
        items = []
        i = 1
        n = len(s)
        while i < n and len(items) < 80:
            while i < n and s[i] in " \n\r\t,":
                i += 1
            if i >= n or s[i] == "]":
                break
            try:
                obj, end = dec.raw_decode(s, i)
            except Exception:
                break
            items.append(obj)
            i = end
        return items if items else None
    if s.startswith("{"):
        # truncated object: try to close open braces after last complete key
        try:
            obj, _ = dec.raw_decode(s)
            return obj
        except Exception:
            pass
        # common pattern {"data":[ ... truncated
        m = re.search(r'"(markers|data|results|records|stations|features|items|ac|hexes|outage)"\s*:\s*\[', s)
        if m:
            start = m.end() - 1
            sub = s[start:]
            arr = loads_partial(sub)
            if arr:
                return {m.group(1): arr}
    return None


def regex_latlon(text: str):
    patterns = [
        r'"geo_lat"\s*:\s*([+-]?\d+(?:\.\d+)?)\s*,\s*"geo_long"\s*:\s*([+-]?\d+(?:\.\d+)?)',
        r'"latitude"\s*:\s*"?([+-]?\d+(?:\.\d+)?)"?\s*,\s*"longitude"\s*:\s*"?([+-]?\d+(?:\.\d+))"?',
        r'"lat"\s*:\s*"?([+-]?\d+(?:\.\d+)?)"?\s*,\s*"lon(?:g|gitude)?"\s*:\s*"?([+-]?\d+(?:\.\d+))"?',
        r'"location_latitude"\s*:\s*"?([+-]?\d+(?:\.\d+)?)"?\s*,\s*"location_longitude"\s*:\s*"?([+-]?\d+(?:\.\d+))"?',
        r'latitude[=:]["\s]*([+-]?\d+(?:\.\d+)?)[^\d\-+]+longitude[=:]["\s]*([+-]?\d+(?:\.\d+)?)',
    ]
    for pat in patterns:
        m = re.search(pat, text, re.I)
        if m and pair_ok(m.group(1), m.group(2)):
            return float(m.group(1)), float(m.group(2)), "regex " + pat[:40]
    return None


def scale_meshmap(lat, lon):
    # Meshtastic stores deg * 1e7 as ints
    try:
        la, lo = float(lat), float(lon)
    except (TypeError, ValueError):
        return None
    if abs(la) > 90 and abs(la) < 90_0000_000 and abs(lo) > 180 and abs(lo) < 180_0000_000:
        la, lo = la / 1e7, lo / 1e7
    if pair_ok(la, lo):
        return la, lo
    return None


def extract_cneos(obj: dict):
    fields = obj.get("fields")
    data = obj.get("data")
    if not isinstance(fields, list) or not isinstance(data, list):
        return None
    for row in data:
        if not isinstance(row, list):
            continue
        rec = {fields[i]: row[i] if i < len(row) else None for i in range(len(fields))}
        got = from_mapping(rec)
        if got:
            return got[0], got[1], "data[] zipped with fields (lat/lon)"
    return None




def extract_tle_text(text: str):
    try:
        from sgp4.api import Satrec, jday
        from datetime import datetime, timezone
        import math
    except Exception:
        return None
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    l1 = l2 = None
    for i, ln in enumerate(lines):
        if ln.startswith("1 ") and i+1 < len(lines) and lines[i+1].startswith("2 "):
            l1, l2 = ln, lines[i+1]
            break
    if not l1:
        return None
    try:
        sat = Satrec.twoline2rv(l1, l2)
        now = datetime.now(timezone.utc)
        jd, fr = jday(now.year, now.month, now.day, now.hour, now.minute, now.second + now.microsecond / 1e6)
        e, r, v = sat.sgp4(jd, fr)
        if e != 0:
            return None
        x, y, z = r
        tt = (jd - 2451545.0) / 36525.0
        gmst = 280.46061837 + 360.98564736629 * ((jd - 2451545.0) + fr) + 0.000387933 * tt * tt
        gmst = math.radians(gmst % 360.0)
        lon = math.degrees(math.atan2(y, x) - gmst)
        lon = (lon + 180) % 360 - 180
        hyp = math.sqrt(x * x + y * y)
        lat = math.degrees(math.atan2(z, hyp))
        if pair_ok(lat, lon):
            name = lines[0] if not lines[0].startswith("1 ") else "satellite"
            return float(lat), float(lon), "derived from TLE via SGP4 (sub-satellite point)"
    except Exception:
        return None
    return None


def extract_coords(c: dict, content: bytes, content_type: str) -> tuple:
    """Return (lat, lon, path) or (None, None, reason)."""
    text = None
    try:
        text = content.decode("utf-8", errors="replace")
    except Exception:
        text = content.decode("latin-1", errors="replace")
    text_strip = text.lstrip()
    ctype = (content_type or "").lower()

    # OpenSky
    if c["id"].startswith("opensky"):
        try:
            obj = json.loads(text)
            got = extract_opensky(obj)
            if got:
                return got
        except Exception:
            pass

    # USGS IV
    if c["id"].startswith("usgs-iv"):
        try:
            got = extract_usgs_iv(json.loads(text))
            if got:
                return got
        except Exception:
            pass

    # NDBC
    if c["id"].startswith("ndbc") or c["endpoint"].endswith("latest_obs.txt"):
        got = extract_ndbc(text)
        if got:
            return got

    # USGS RDB
    if c["format"] == "RDB" or "format=rdb" in c["endpoint"]:
        got = extract_rdb(text)
        if got:
            return got

    # WebSDR custom list
    if c["id"] == "websdr-list":
        got = extract_websdr(text)
        if got:
            return got

    # Two-line element sets
    if text.lstrip().startswith("1 ") or "\n1 " in text:
        got = extract_tle_text(text)
        if got:
            return got

    # JSON / GeoJSON
    if text_strip[:1] in "{[":
        try:
            obj = loads_partial(text)
        except Exception:
            obj = None
        if obj is not None:
            if isinstance(obj, dict) and obj.get("fields") and obj.get("data"):
                got = extract_cneos(obj)
                if got:
                    return got
            if c["id"].startswith("celestrak") or c["format"] == "JSON/TLE":
                got = extract_celestrak_tle(obj)
                if got:
                    return got
                # endpoint is live but coords are derived
                return None, None, "TLE/GP JSON live; lat/lon derived via SGP4 (no sgp4 result in probe)"
            got = walk(obj)
            if got:
                return got
            # Open-Meteo / MET Norway geometry
            if isinstance(obj, dict) and "latitude" in obj and "longitude" in obj and pair_ok(obj["latitude"], obj["longitude"]):
                return float(obj["latitude"]), float(obj["longitude"]), "latitude / longitude (query echo)"

    # XML / RSS / KML / CAP
    if text_strip.startswith("<?xml") or text_strip.startswith("<") or "xml" in ctype or "rss" in ctype or "atom" in ctype or "kml" in ctype:
        got = extract_xml(text)
        if got:
            return got

    # CSV / TXT
    if c["format"] in {"CSV", "TXT/CSV", "CSV/TXT"} or "csv" in ctype or c["endpoint"].endswith(".csv") or c["endpoint"].endswith(".txt"):
        got = extract_csv(text)
        if got:
            return got
        got = extract_ndbc(text)
        if got:
            return got

    # last chance csv/xml
    got = extract_csv(text) or extract_xml(text)
    if got:
        return got
    got = regex_latlon(text)
    if got:
        return got
    # PSKReporter / ham locators in attributes
    m = re.search(r'(?:receiverLocator|senderLocator|locator)="([A-Ra-r]{2}\d{2}[A-Xa-x]{0,2})"', text)
    if m:
        mh = maidenhead_to_ll(m.group(1))
        if mh:
            return mh[0], mh[1], f"{m.group(0)} Maidenhead"
    return None, None, "no coordinates found in sample"
