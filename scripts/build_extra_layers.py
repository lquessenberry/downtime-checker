#!/usr/bin/env python3
"""Build the ClimateViewer-equivalent layer set for Global Status App.

Inputs (outside the repo, built earlier):
  /workspace/custom-layers/pack-[1-9]-*.json        170 custom open-data layers
  /workspace/gs-567-work/gibs_final.json           NASA GIBS layers that passed a live tile test
  /workspace/gs-567-work/snap/*                    raw downloads for static snapshots
Outputs (inside the repo):
  globalstatus/layers-data/pack-N.json             compact pin packs, fetched on first toggle
  globalstatus/layers-data/snapshots/*.json        static snapshots of feeds with no CORS
  globalstatus/extra-layers-registry.js            sidebar registry for every new layer
  /workspace/gs-567-work/status.json               per-layer status for the test report
"""
import glob, json, os, re, datetime, xml.etree.ElementTree as ET

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GS = os.path.join(REPO, "globalstatus")
OUT = os.path.join(GS, "layers-data")
WORK = "/workspace/gs-567-work"
os.makedirs(os.path.join(OUT, "snapshots"), exist_ok=True)
TODAY = datetime.date.today().isoformat()
URL = re.compile(r"https?://\S+|www\.\S+|tel:\S+", re.I)

def plain(s, limit=None):
    s = re.sub(r"<[^>]+>", " ", str(s or ""))
    s = URL.sub("", s)
    s = re.sub(r"\s+", " ", s).strip()
    if limit and len(s) > limit:
        cut = s[:limit]
        dot = cut.rfind(". ")
        s = (cut[:dot + 1] if dot > limit * 0.5 else cut.rstrip() + "…")
    return s

def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")

# ---------------------------------------------------------------- groups
NEW_GROUPS = [
    ("history-archaeology", "HISTORY & ARCHAEOLOGY"),
    ("environment-energy", "ENVIRONMENT & ENERGY"),
    ("earth-oceans", "EARTH & OCEANS"),
    ("government-infrastructure", "GOVERNMENT & INFRASTRUCTURE"),
]
CAT_TO_GROUP = {
    "HISTORY & ARCHAEOLOGY": "history-archaeology",
    "ENVIRONMENT & ENERGY": "environment-energy",
    "EARTH & OCEANS": "earth-oceans",
    "GOVERNMENT & INFRASTRUCTURE": "government-infrastructure",
    "CONFLICT & MILITARY": "conflict-military",
    "HEALTH & HUMANITARIAN": "health",
    "POWER & COMMUNICATIONS": "power-comms",
    "SPACE": "space",
    "TRANSPORTATION": "transportation",
    "FIREARMS": "firearms",
}
# Non-green marker colours per group (warm / cool / neutral).
GROUP_COLOR = {
    "history-archaeology": "#d8b27a", "environment-energy": "#e0915f", "earth-oceans": "#7fb2e5",
    "government-infrastructure": "#b3a6dc", "conflict-military": "#e07a7a", "health": "#e79bbd",
    "power-comms": "#a9c4d6", "space": "#c3b2f0", "transportation": "#9cc0e6", "firearms": "#d2a383",
    "natural-disasters": "#f0a35e", "floods-water": "#6fb7ff", "weather": "#b9d3e6",
}

def pack_subgroup(group, name, pack):
    n = name.lower()
    if group == "history-archaeology":
        if pack == 1: return "Ancient Ruins, Castles & Ghost Towns"
        if any(k in n for k in ("ship", "sunken", "wreck")): return "Shipwrecks & Maritime History"
        if any(k in n for k in ("battle", "war", "revolution", "alexander", "wwii")): return "Battles, Wars & Conquerors"
        if "fossil" in n: return "Fossil Sites"
        if any(k in n for k in ("trail", "route", "migration", "beringia", "evolution", "exodus", "amistad", "civilizations", "camino")): return "Migration & Human History"
        if any(k in n for k in ("fair", "olympic")): return "Fairs & Olympics"
        if "dead" in n or "necropol" in n: return "Cities of the Dead"
        return "Explorers & Expeditions"
    if group == "environment-energy":
        if pack == 5: return "Geoengineering & Weather Modification"
        if any(k in n for k in ("radioactive", "meltdown", "fallout", "nuclear", "uranium", "uf6", "hibakusha")): return "Nuclear Disasters & Tests"
        if any(k in n for k in ("frack", "shale", "oil", "methane", "sinkhole", "coal")): return "Oil, Gas, Coal & Fracking"
        return "Pollution & Toxic Sites"
    if group == "earth-oceans":
        if "antarctic" in n: return "Polar Research"
        if any(k in n for k in ("ocean", "whale", "vent", "trench", "wave", "thermohaline", "el nino")): return "Oceans"
        return "Climate, Biomes & Geology"
    if group == "government-infrastructure": return "Government, Borders & Society"
    if group == "conflict-military": return "Radar, Air Defense & Drones"
    if group == "health": return "Historic Disease Outbreaks"
    if group == "power-comms":
        if any(k in n for k in ("coal", "solar", "waste-to-energy", "submarine", "cable")): return "Energy & Telecom Infrastructure"
        return "Atmospheric Sensors & EMF Sites"
    if group == "space": return "Space Centers & Radio Telescopes"
    if group == "transportation":
        if "ship route" in n: return "Shipping Routes & Chokepoints"
        return "Historic Air & Rail Disasters"
    if group == "firearms": return "State Firearm Policy"
    return "More Layers"

layers = []
status = []
# Pack layers whose pins span the globe: the name must say "Global".
GLOBAL_RENAME = {
    "Charles Darwin's Voyage of the Beagle (1831-1836)": "Global Voyage of the Beagle: Charles Darwin (1831-1836)",
    "Darwin's The Origin of Species": "Global Origins of Darwin's The Origin of Species",
    "Five Eyes STONEGHOST Surveillance Network": "Global Five Eyes STONEGHOST Surveillance Network",
    "Plane Wrecks and Boneyards Seen by Satellite": "Global Plane Wrecks and Boneyards Seen by Satellite",
    "Great Train Wrecks (1930-1949)": "Global Great Train Wrecks (1930-1949)",
}
for _d in ("1961-1970", "1971-1980", "1981-1990", "1991-2000", "2001-2010", "2011-2013"):
    GLOBAL_RENAME["Commercial Aviation Crashes (%s)" % _d] = "Global Commercial Aviation Crashes (%s)" % _d

# ---------------------------------------------------------------- Phase 1: packs
PACK1_DESC = {
    "Global Ancient Pyramids": "Major ancient pyramid sites across Egypt, Nubia, Mesoamerica, South America and Asia.",
}
for path in sorted(glob.glob("/workspace/custom-layers/pack-[1-9]-*.json")):
    pack_no = int(re.search(r"pack-(\d)", path).group(1))
    d = json.load(open(path, encoding="utf-8"))
    compact = {}
    for L in d["layers"]:
        name = L["layer_name"]
        cat = L.get("category") or "HISTORY & ARCHAEOLOGY"
        lid = L.get("layer_id") or slug(name)
        group = CAT_TO_GROUP[cat]
        name = GLOBAL_RENAME.get(name, name)
        key = "cp-" + lid
        pins = []
        for p in L["pins"]:
            pins.append([round(p["lat"], 5), round(p["lon"], 5), plain(p["name"]), plain(p["region"]),
                         plain(p["era_or_date"]), plain(p["summary"]), plain(p["details"])])
        compact[key] = pins
        layers.append(dict(
            key=key, name=name, group=group, sub=pack_subgroup(group, name, pack_no), kind="pack",
            pack="pack-%d.json" % pack_no, color=GROUP_COLOR[group], count=len(pins),
            desc=plain(L.get("description") or PACK1_DESC.get(name) or ("%s: notable sites from public historical records." % name)),
            credit=plain(L.get("source") or "Wikidata (CC0) / UNESCO / public historical records"),
            phase=1))
        status.append(dict(phase=1, title=name, status="wired", key=key, group=group))
    with open(os.path.join(OUT, "pack-%d.json" % pack_no), "w", encoding="utf-8") as f:
        json.dump({"pack": pack_no, "layers": compact}, f, ensure_ascii=False, separators=(",", ":"))

# ---------------------------------------------------------------- Phase 2: NASA GIBS
GIBS_GROUP = {"health": "health", "weather": "weather", "floods-water": "floods-water", "space": "space"}
g = json.load(open(os.path.join(WORK, "gibs_final.json")))
for row in g["rows"]:
    if row["status"] != "ok":
        status.append(dict(phase=2, title=row["title"], status=row["status"],
                           reason={"retired": "No longer published by NASA GIBS (not in the live WMTS capabilities)",
                                   "dead": "Listed by NASA GIBS but tiles return HTTP 404 (product retired)",
                                   "duplicate": "Same NASA GIBS product as another listed layer (merged)"}[row["status"]]))
        continue
    cvt = row["title"].replace("NASA ", "").strip()
    exact = True
    # When a substitute GIBS product was used, name it after the real product.
    gt = row["gibs_title"]
    if any(x in row["title"] for x in ("G1SST", "Total Column (Day)", "Total Column (Night)", "Rain Rate (Early)")):
        exact = False
    if exact:
        name = "Global " + re.sub(r"\s+-\s+", " · ", cvt, count=1)
    else:
        name = "Global " + gt
    name = name.replace("Suomi-NPP", "Suomi NPP")
    key = "gibs-" + slug(row["id"])[:60]
    sub = row["subgroup"]
    layers.append(dict(
        key=key, name=name, group=row["category"], sub=sub, kind="wmts",
        layer=row["id"], tms=row["tms"], maxLevel=row["maxLevel"], fmt=row["fmt"], time=bool(row["hasTime"]),
        desc=plain(gt) + " from NASA GIBS (Global Imagery Browse Services).",
        credit="NASA EOSDIS GIBS (public domain)", phase=2,
        note=("Replaces the retired ClimateViewer layer: " + row["title"]) if not exact else ""))
    status.append(dict(phase=2, title=row["title"], status="wired", key=key, gibs=row["id"], substitute=not exact))

# ---------------------------------------------------------------- Phase 3/4 helpers
NC = "https://nowcoast.noaa.gov/geoserver/ows"
MS = "https://mapservices.weather.noaa.gov"
EUM = "https://view.eumetsat.int/geoserver/ows"
USGS = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/"

def add(phase, cv_title, key, name, group, sub, kind, credit, desc, **kw):
    e = dict(key=key, name=name, group=group, sub=sub, kind=kind, credit=credit, desc=desc, phase=phase,
             color=kw.pop("color", GROUP_COLOR.get(group, "#b9d3e6")))
    e.update(kw)
    layers.append(e)
    status.append(dict(phase=phase, title=cv_title, status="wired", key=key, kind=kind))

def skip(phase, cv_title, st, reason, covered_by=None):
    status.append(dict(phase=phase, title=cv_title, status=st, reason=reason, covered_by=covered_by))

# ---- Phase 3: alerts & weather
SUB_Q = "USGS Earthquake Feeds (Live)"
for cv, feed, nm in [
    ("USGS - All Earthquakes (Last Hour)", "all_hour", "Global USGS Earthquakes: All, Last Hour"),
    ("USGS - All Earthquakes (Today)", "all_day", "Global USGS Earthquakes: All, Last 24 Hours"),
    ("USGS - M1.0+ Earthquakes (Last Week)", "1.0_week", "Global USGS Earthquakes: M1.0+, Last 7 Days"),
    ("USGS - M2.5+ Earthquakes (Last Month)", "2.5_month", "Global USGS Earthquakes: M2.5+, Last 30 Days"),
    ("USGS - M2.5+ Earthquakes (Last Week)", "2.5_week", "Global USGS Earthquakes: M2.5+, Last 7 Days"),
    ("USGS - M4.5+ Earthquakes (Last Month)", "4.5_month", "Global USGS Earthquakes: M4.5+, Last 30 Days"),
    ("USGS - M4.5+ Earthquakes (Last Week)", "4.5_week", "Global USGS Earthquakes: M4.5+, Last 7 Days"),
    ("USGS - M4.5+ Earthquakes (Today)", "4.5_day", "Global USGS Earthquakes: M4.5+, Last 24 Hours"),
]:
    add(3, cv, "usgs-" + slug(feed), nm, "natural-disasters", SUB_Q, "points",
        "USGS Earthquake Hazards Program (public domain)", "Live USGS GeoJSON summary feed, refreshed while on.",
        url=USGS + feed + ".geojson", fmt="geojson", refresh=300, color="#f0a35e",
        fields=[["mag", "Magnitude"], ["place", "Place"], ["time", "Time", "ms"], ["depth", "Depth (km)"]], title="place")
skip(3, "USGS - M2.5+ Earthquakes (Today)", "duplicate", "Same USGS 2.5_day feed as existing GLOBAL EARTHQUAKES", "GLOBAL EARTHQUAKES")
add(3, "USGS - Tectonic Plate Boundaries", "usgs-plates", "Global Tectonic Plate Boundaries (USGS)", "natural-disasters",
    "Plates & Volcanoes", "arcgis", "USGS (public domain)", "Plate boundary lines from the USGS map service.",
    url="https://earthquake.usgs.gov/arcgis/rest/services/eq/map_plateboundaries/MapServer", show="")
add(3, "Global Volcanoes (Holocene Period)", "gvp-holocene", "Global Volcanoes: Holocene Period", "natural-disasters",
    "Plates & Volcanoes", "points", "Smithsonian Global Volcanism Program, Volcanoes of the World (snapshot %s)" % TODAY,
    "Volcanoes with eruptions or unrest in roughly the last 12,000 years.", url="/layers-data/snapshots/gvp-holocene.json",
    fmt="snap", color="#f08a5a")
add(3, "Global Volcanoes (Pleistocene Period)", "gvp-pleistocene", "Global Volcanoes: Pleistocene Period", "natural-disasters",
    "Plates & Volcanoes", "points", "Smithsonian Global Volcanism Program, Volcanoes of the World (snapshot %s)" % TODAY,
    "Volcanoes active in the Pleistocene with no confirmed Holocene eruptions.", url="/layers-data/snapshots/gvp-pleistocene.json",
    fmt="snap", color="#c98a6a")
skip(3, "Active Volcanoes and Eruptions (This Week)", "duplicate", "Current volcanic unrest is already shown by existing VOLCANO ALERTS (USGS)", "VOLCANO ALERTS")
skip(3, "Fire Detection - NOAA Hazard Mapping System", "duplicate", "Satellite fire detections already shown by existing GLOBAL WILDFIRES", "GLOBAL WILDFIRES")
skip(3, "Smoke Detection - NOAA Hazard Mapping System", "duplicate", "NOAA HMS smoke already drawn by existing USA AIR QUALITY", "USA AIR QUALITY")
add(3, "InciWeb Incident Information System", "wfigs-incidents", "US Wildland Fire Incidents (NIFC WFIGS, InciWeb Equivalent)",
    "natural-disasters", "Wildfire Incidents", "points", "National Interagency Fire Center WFIGS (public domain)",
    "Current wildland fire incident locations reported through IRWIN / WFIGS.",
    url="https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0",
    fmt="arcgis", outFields="IncidentName,IncidentSize,FireCause,FireDiscoveryDateTime,POOCounty,POOState,IncidentTypeCategory,PercentContained",
    fields=[["IncidentName", "Incident"], ["IncidentTypeCategory", "Type"], ["IncidentSize", "Size (acres)"], ["PercentContained", "Contained (%)"],
            ["FireCause", "Cause"], ["FireDiscoveryDateTime", "Discovered", "ms"], ["POOCounty", "County"], ["POOState", "State"]],
    title="IncidentName", refresh=600, color="#ff8a5c")
SUB_TC = "Tropical Cyclones (NOAA nowCOAST)"
for cv, lyr in [("Tropical Cyclone Current Wind Extent", "tropical_cyclones:tropical_cyclone_current_wind_extent"),
                ("Tropical Cyclone Observed Track Line", "tropical_cyclones:tropical_cyclone_observed_track"),
                ("Tropical Cyclone Track Line Forecasts", "tropical_cyclones:tropical_cyclone_track_forecast")]:
    add(3, cv, "nc-" + slug(lyr.split(":")[1]), cv, "weather", SUB_TC, "wms", "NOAA nowCOAST / National Hurricane Center (public domain)",
        "Live NHC tropical cyclone product served by NOAA nowCOAST.", url=NC, layers=lyr)
skip(3, "Tropical Cyclone Observed Center Positions", "duplicate", "Storm center positions already shown by existing HURRICANES (NHC)", "HURRICANES")
skip(3, "Tropical Storm Tracking (U.S. Naval Oceanography Portal)", "not-wired", "The Naval Oceanography Portal / JTWC publishes no public CORS-enabled map or GeoJSON feed")
add(3, "Lightning Strike Density", "nc-lightning", "Lightning Strike Density (NOAA nowCOAST)", "weather", "Lightning & Radar",
    "wms", "NOAA nowCOAST (public domain)", "Recent lightning strike density from NOAA nowCOAST.", url=NC, layers="lightning_detection:ldn_lightning_strike_density")
add(3, "Rainfall Atlantic Ocean - MET0D", "eum-h60b", "Meteosat 0° Blended Precipitation Rate (EUMETSAT H SAF)", "weather",
    "EUMETSAT Meteosat (CC BY 4.0)", "wms", "Contains modified EUMETSAT Meteosat data %d (CC BY 4.0)" % datetime.date.today().year,
    "H SAF blended SEVIRI / microwave precipitation rate, successor to the retired Meteosat MPE product.", url=EUM, layers="msg_fes:h60b", eumetsat=True)
add(3, "Rainfall Indian Ocean - IODC", "eum-h63", "Meteosat Indian Ocean Precipitation Rate (EUMETSAT H SAF)", "weather",
    "EUMETSAT Meteosat (CC BY 4.0)", "wms", "Contains modified EUMETSAT Meteosat data %d (CC BY 4.0)" % datetime.date.today().year,
    "H SAF precipitation rate over the Indian Ocean disc, successor to the retired Meteosat MPE product.", url=EUM, layers="msg_iodc:h63", eumetsat=True)
add(3, "U.S. Drought Monitor", "usdm", "U.S. Drought Monitor (Current Week)", "floods-water", "Drought, Floods & Rivers (Live)",
    "shapes", "U.S. Drought Monitor: NDMC, USDA, NOAA", "Weekly drought intensity polygons (D0 abnormally dry to D4 exceptional).",
    url="https://services5.arcgis.com/0OTVzJS4K09zlixn/ArcGIS/rest/services/USDM_current/FeatureServer/0", fmt="arcgis", outFields="DM", styleBy="DM",
    fields=[["DM", "Drought category"]], title="DM",
    palette={"0": "#ffff00", "1": "#fcd37f", "2": "#ffaa00", "3": "#e60000", "4": "#730000"})
SUB_P = "Precipitation Forecasts & Snow (NOAA)"
for cv, show, nm in [("U.S. Rainfall - 6 Hour Forecast", "7", "U.S. Rainfall: 6 Hour Forecast (WPC QPF)"),
                     ("U.S. Rainfall - 24 Hour Forecast", "1", "U.S. Rainfall: 24 Hour Forecast (WPC QPF)"),
                     ("U.S. Rainfall - 5 Day Forecast", "10", "U.S. Rainfall: 5 Day Forecast (WPC QPF)")]:
    add(3, cv, "wpc-qpf-" + show, nm, "weather", SUB_P, "arcgis", "NOAA Weather Prediction Center (public domain)",
        "Quantitative precipitation forecast from NOAA WPC.", url=MS + "/vector/rest/services/precip/wpc_qpf/MapServer", show=show)
add(3, "U.S. Rainfall - Multi-Radar/Multi-Sensor (MRMS) System NEXRAD Weather Radar", "mrms-qpe", "U.S. Rainfall: MRMS Radar Estimate (NOAA)",
    "weather", SUB_P, "arcgis-image", "NOAA NSSL / NWS MRMS (public domain)", "Multi-Radar/Multi-Sensor quantitative precipitation estimate.",
    url=MS + "/raster/rest/services/obs/mrms_qpe/ImageServer")
skip(3, "U.S. Rainfall - NEXRAD Radar, Base Reflectivity", "duplicate", "Radar reflectivity is already shown by existing GLOBAL WEATHER RADAR", "GLOBAL WEATHER RADAR")
skip(3, "U.S. River Flood Levels", "duplicate", "Flooding river gauges are already shown by existing RIVER GAUGES IN FLOOD (US)", "RIVER GAUGES IN FLOOD (US)")
add(3, "U.S. River Gauges", "riv-gauges", "U.S. River Gauges: Observed Stages (NOAA NWPS)", "floods-water", "Drought, Floods & Rivers (Live)",
    "arcgis", "NOAA National Water Prediction Service (public domain)", "Observed stage category for every NWS river forecast point.",
    url=MS + "/eventdriven/rest/services/water/riv_gauges/MapServer", show="0")
add(3, "U.S. Significant Flood Risk", "sig-flood", "U.S. Significant River Flood Outlook (NOAA)", "floods-water", "Drought, Floods & Rivers (Live)",
    "arcgis", "NOAA NWS (public domain)", "Areas with significant river flood potential in the coming days.",
    url=MS + "/vector/rest/services/outlooks/sig_riv_fld_outlk/MapServer", show="0")
add(3, "U.S. Snow Depth", "nohrsc-depth", "U.S. Snow Depth (NOAA NOHRSC)", "weather", SUB_P, "arcgis", "NOAA NOHRSC (public domain)",
    "Modeled snow depth from the National Operational Hydrologic Remote Sensing Center.", url=MS + "/raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer", show="0")
add(3, "U.S. Snow Water Equivalent", "nohrsc-swe", "U.S. Snow Water Equivalent (NOAA NOHRSC)", "weather", SUB_P, "arcgis", "NOAA NOHRSC (public domain)",
    "Modeled snow water equivalent from NOHRSC.", url=MS + "/raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer", show="4")
skip(3, "NOAA Watches, Warnings, Advisories, Statements", "duplicate", "Same NWS watches/warnings as existing US WEATHER ALERTS", "US WEATHER ALERTS")
add(3, "NOAA Ocean Buoys", "ndbc-buoys", "Global NOAA NDBC Ocean Buoys & Stations", "floods-water", "Ocean Observations",
    "points", "NOAA National Data Buoy Center active station list (snapshot %s)" % TODAY,
    "Active NDBC buoys, C-MAN and partner ocean stations.", url="/layers-data/snapshots/ndbc-stations.json", fmt="snap", color="#7fc4ff")
skip(3, "Air Quality Index (Current)", "duplicate", "Current AirNow monitor readings are already shown by existing USA AIR QUALITY", "USA AIR QUALITY")
add(3, "Air Quality Index (Today)", "ndgd-ozone", "U.S. Ozone Forecast: 8-Hour Max (NOAA NAQFC)", "health", "Air Quality Forecasts (NOAA)",
    "arcgis-image", "NOAA National Air Quality Forecast Capability (public domain)",
    "Gridded surface ozone forecast. AirNow's own AQI forecast needs an API key, so the public NOAA model forecast is used.",
    url=MS + "/raster/rest/services/air_quality/ndgd_ozone_8hr_max_time/ImageServer", timeAware=True)
add(3, "Air Quality Index (Tomorrow)", "ndgd-pm25", "U.S. PM2.5 Forecast: 24-Hour Average (NOAA NAQFC)", "health", "Air Quality Forecasts (NOAA)",
    "arcgis-image", "NOAA National Air Quality Forecast Capability (public domain)",
    "Gridded fine particulate forecast from the NOAA air quality model.", url=MS + "/raster/rest/services/air_quality/ndgd_apm25_hr24/ImageServer", timeAware=True)
skip(3, "Air Quality Index (Yesterday)", "not-wired", "AirNow historical AQI maps need a private API key; no public keyless tile or GeoJSON endpoint exists")

# ---- Phase 3: history-and-science government datasets
SUB_R = "Weather Radar & Sensor Networks"
add(3, "NEXRAD Doppler Radar Stations", "nws-nexrad", "NEXRAD Doppler Radar Stations (WSR-88D)", "power-comms", SUB_R, "points",
    "NOAA National Weather Service API (public domain)", "Every WSR-88D NEXRAD radar site, live from the NWS radar station API.",
    url="https://api.weather.gov/radar/stations?stationType=WSR-88D", fmt="geojson",
    fields=[["id", "Station"], ["name", "Name"], ["stationType", "Type"]], title="name", color="#a9c4d6")
add(3, "Terminal Doppler Weather Radar (TDWR) Stations", "nws-tdwr", "Terminal Doppler Weather Radar (TDWR) Stations", "power-comms", SUB_R, "points",
    "NOAA National Weather Service API (public domain)", "FAA Terminal Doppler Weather Radars near major airports.",
    url="https://api.weather.gov/radar/stations?stationType=TDWR", fmt="geojson",
    fields=[["id", "Station"], ["name", "Name"], ["stationType", "Type"]], title="name", color="#c7b7e8")
skip(3, "NEXRAD Doppler Radar Stations (Alternative)", "duplicate", "Same WSR-88D station list as the NEXRAD Doppler Radar Stations layer", "NEXRAD Doppler Radar Stations (WSR-88D)")
for cv in ["NEXRAD Doppler Radar Stations (Coverage 10,000 ft Above Ground)", "NEXRAD Doppler Radar Stations (Coverage 4,000 ft Above Ground)",
           "NEXRAD Doppler Radar Stations (Coverage 6,000 ft Above Ground)", "NEXRAD Doppler Radar Stations (Maximum Coverage)"]:
    skip(3, cv, "not-wired", "NOAA ROC publishes terrain-blocked coverage only as downloadable KMZ files, with no public CORS map service")
add(3, "Aerosol Robotic Network (AERONET)", "aeronet", "Global AERONET Aerosol Robotic Network Sites (NASA)", "power-comms", SUB_R, "points",
    "NASA AERONET site list (snapshot %s)" % TODAY, "Ground sun photometers that measure aerosol optical depth.",
    url="/layers-data/snapshots/aeronet-sites.json", fmt="snap", color="#d7c39a")
for cv, why in [("Baseline Surface Radiation Network (BSRN)", "The BSRN station list is only published as an HTML page with no machine-readable or CORS endpoint"),
                ("Earth Systems Research Lab (ESRL) Instruments", "NOAA GML/ESRL no longer publishes a combined instrument site feed (the site page returns HTML only)"),
                ("Integrated Ocean Observing System (IOOS) Doppler Radars", "IOOS HF radar site metadata has no public CORS JSON endpoint"),
                ("Joint Surveillance System (JSS) Air Route Surveillance Radar (ARSR-4)", "No public government dataset of ARSR-4 site coordinates is published"),
                ("MADIS CAP Wind Radar", "MADIS profiler metadata requires a registered MADIS account"),
                ("NOAA Profiler Network (NPN) Wind Radar", "The NOAA Profiler Network was decommissioned in 2014 and its site list is no longer served")]:
    skip(3, cv, "not-wired", why)
add(3, "Superfund Sites (EPA TOXMAP)", "epa-superfund", "EPA Superfund National Priorities List Sites", "environment-energy", "EPA Toxic Sites (Live)",
    "points", "U.S. EPA (public domain)", "Current, proposed and deleted Superfund National Priorities List sites.",
    url="https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Superfund_National_Priorities_List_(NPL)_Sites_with_Status_Information/FeatureServer/0",
    fmt="arcgis", outFields="Site_Name,Status,City,County,State,Site_Score,Listing_Date,Site_EPA_ID",
    fields=[["Site_Name", "Site"], ["Status", "Status"], ["City", "City"], ["State", "State"], ["Site_Score", "Hazard score"],
            ["Listing_Date", "Listed"], ["Site_EPA_ID", "EPA ID"]], title="Site_Name", color="#e0915f")
add(3, "Toxic Release Inventory Facilities (EPA TOXMAP, 1988-2016)", "epa-tri", "EPA Toxics Release Inventory Facilities (Reporting Since 2023)",
    "environment-energy", "EPA Toxic Sites (Live)", "points", "U.S. EPA Facility Registry Service (public domain)",
    "Facilities that reported to the Toxics Release Inventory since January 2023 (about 16,700 sites).",
    url="https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/FRS_INTERESTS_TRI/FeatureServer/0", fmt="arcgis",
    where="LAST_REPORTED_DATE >= date '2023-01-01'", outFields="PRIMARY_NAME,CITY_NAME,COUNTY_NAME,STATE_CODE,ACTIVE_STATUS,LAST_REPORTED_DATE",
    fields=[["PRIMARY_NAME", "Facility"], ["CITY_NAME", "City"], ["COUNTY_NAME", "County"], ["STATE_CODE", "State"],
            ["ACTIVE_STATUS", "Status"], ["LAST_REPORTED_DATE", "Last reported", "ms"]], title="PRIMARY_NAME", color="#d9825b")
skip(3, "Toxic Release Inventory Facilities, NPRI Canada (EPA TOXMAP)", "not-wired", "EPA TOXMAP (which carried Canada's NPRI) was retired in 2019; no US public-domain replacement")
for y in range(2004, 2013):
    skip(3, "%d NOAA Reported Weather Modification Activities in the USA" % y, "not-wired",
         "NOAA's weather modification reports are scanned text forms with no coordinates or map service")
for cv in ["Nuclear Reactors (Boiling Water)", "Nuclear Reactors (Gas Cooled)", "Nuclear Reactors (Light Water Graphite)",
           "Nuclear Reactors (Other)", "Nuclear Reactors (Pressurized Heavy Water)", "Nuclear Reactors (Pressurized Water)"]:
    skip(3, cv, "duplicate", "Nuclear plants are already shown by existing GLOBAL POWER PLANTS; per-reactor-type data (IAEA PRIS) is not openly licensed", "GLOBAL POWER PLANTS")
skip(3, "Coal Power Plants (Current)", "duplicate", "Coal plants are already shown by existing GLOBAL POWER PLANTS (WRI + EIA)", "GLOBAL POWER PLANTS")
skip(3, "Department of Homeland Security (DHS) Fusion Centers", "not-wired", "DHS publishes fusion centers only as a name list with no coordinates or map service")
add(3, "Native American Indian Lands of the United States", "tiger-aiannh", "Native American Lands of the United States (Census TIGER)",
    "government-infrastructure", "Federal Map Services (Live)", "arcgis", "U.S. Census Bureau TIGERweb (public domain)",
    "American Indian, Alaska Native and Native Hawaiian areas.", url="https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/AIANNHA/MapServer", show="")
add(3, "UAV Drone No-Fly Zones in the USA", "faa-uas-nofly", "UAV Drone No-Fly Zones: FAA Prohibited & National Security Areas", "government-infrastructure",
    "Federal Map Services (Live)", "shapes", "Federal Aviation Administration (public domain)",
    "FAA prohibited airspace and part-time national security UAS flight restrictions.",
    sources=["https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Prohibited_Areas/FeatureServer/0",
             "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Part_Time_National_Security_UAS_Flight_Restrictions/FeatureServer/0"],
    fmt="arcgis", fill="#e07a7a", fields=[["NAME", "Name"], ["CITY", "Area"], ["STATE", "State"], ["TIMESOFUSE", "Times of use"]], title="NAME")
add(3, "Flight Routes in the USA", "faa-ats", "Flight Routes in the USA (FAA ATS Routes)", "transportation", "FAA Airspace (Live)", "lines",
    "Federal Aviation Administration (public domain)", "Published air traffic service routes (Victor, Jet, RNAV and oceanic).",
    url="https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/ATS_Route/FeatureServer/0", fmt="arcgis", stroke="#9cc0e6")
add(3, "ICAO Flight Navigation Aids (VOR/NDB)", "faa-navaids", "US Flight Navigation Aids: VOR, NDB & DME (FAA)", "transportation", "FAA Airspace (Live)",
    "points", "Federal Aviation Administration (public domain)", "FAA NAVAID systems in the United States and territories.",
    url="https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/NAVAIDSystem/FeatureServer/0", fmt="arcgis",
    outFields="IDENT,NAME_TXT,CLASS_TXT,CITY,STATE,STATUS", fields=[["IDENT", "Ident"], ["NAME_TXT", "Name"], ["CLASS_TXT", "Class"],
    ["CITY", "City"], ["STATE", "State"], ["STATUS", "Status"]], title="NAME_TXT", color="#9cc0e6")
add(3, "U.S. Ports", "bts-ports", "U.S. Principal Ports (USACE / BTS)", "transportation", "Shipping Routes & Chokepoints", "points",
    "U.S. Army Corps of Engineers / Bureau of Transportation Statistics (public domain)", "Top US ports ranked by total tonnage.",
    url="https://services7.arcgis.com/n1YM8pTrFmm7L4hs/ArcGIS/rest/services/Principal_Ports/FeatureServer/0", fmt="arcgis",
    outFields="PORTNAME,RANK,TYPE,TOTAL,FOREIGN_,DOMESTIC", fields=[["PORTNAME", "Port"], ["RANK", "Rank"], ["TYPE", "Type"],
    ["TOTAL", "Total tons", "num"], ["FOREIGN_", "Foreign tons", "num"], ["DOMESTIC", "Domestic tons", "num"]], title="PORTNAME", color="#7fb2e5")
skip(3, "World Major Airport Runways", "duplicate", "Airports are already shown by existing GLOBAL AIRPORTS", "GLOBAL AIRPORTS")

# ---- Phase 3: GOES + NRL
SUB_G = "GOES & Global Satellite Mosaics (NOAA)"
for cv, lyr, nm in [("Global Longwave Infrared Mosaic", "satellite:global_longwave_imagery_mosaic", "Global Satellite Longwave Infrared Mosaic"),
                    ("Global Shortwave Infrared Mosaic", "satellite:global_shortwave_imagery_mosaic", "Global Satellite Shortwave Infrared Mosaic"),
                    ("Global Visible Imagery Mosaic", "satellite:global_visible_imagery_mosaic", "Global Satellite Visible Imagery Mosaic"),
                    ("Northern Hemisphere Longwave Infrared Composite", "satellite:goes_longwave_imagery", "GOES East & West Longwave Infrared"),
                    ("Northern Hemisphere Shortwave Infrared Composite", "satellite:goes_shortwave_imagery", "GOES East & West Shortwave Infrared"),
                    ("Northern Hemisphere Visible Imagery Composite", "satellite:goes_visible_imagery", "GOES East & West Visible Imagery"),
                    ("Northern Hemisphere Water Vapor Imagery Composite", "satellite:goes_water_vapor_imagery", "GOES East & West Water Vapor Imagery")]:
    add(3, cv, "nc-" + slug(lyr.split(":")[1]), nm, "weather", SUB_G, "wms", "NOAA nowCOAST / NESDIS (public domain)",
        "Latest geostationary satellite imagery from NOAA nowCOAST.", url=NC, layers=lyr)
add(3, "Water Vapor", "nc-global-wv", "Global Satellite Water Vapor Mosaic (NRL Equivalent)", "weather", SUB_G, "wms",
    "NOAA nowCOAST / NESDIS (public domain)", "Global water vapor mosaic. U.S. Naval Research Lab imagery has no public map tile service.",
    url=NC, layers="satellite:global_water_vapor_imagery_mosaic")
skip(3, "Infrared Clouds", "duplicate", "NRL infrared cloud imagery has no tile service; covered by the Global Satellite Longwave Infrared Mosaic", "Global Satellite Longwave Infrared Mosaic")
skip(3, "Visible Clouds", "duplicate", "NRL visible cloud imagery has no tile service; covered by the Global Satellite Visible Imagery Mosaic", "Global Satellite Visible Imagery Mosaic")
skip(3, "Convective Cloud Top Heights", "not-wired", "NRL Monterey publishes this only as static web images with no georeferenced or CORS endpoint")

# ---- Phase 4: EUMETSAT, CIMSS, EMSC
YEAR = datetime.date.today().year
EUM_CREDIT = "Contains modified EUMETSAT Meteosat data %d (CC BY 4.0)" % YEAR
EUM_MAP = [("Airmass", "rgb_airmass"), ("Cloud Mask", "clm"), ("Cloud Top Height", "cth"), ("Convection", "rgb_convection"),
           ("Day Microphysics", "rgb_microphysics"), ("Dust", "rgb_dust"), ("European HRV (E-View)", "rgb_eview"),
           ("Fog & Low Clouds", "rgb_fog"), ("Infrared 0.39", "ir039"), ("Infrared 10.8", "ir108"), ("Natural Color", "rgb_natural"),
           ("Snow", "rgb_snow"), ("Visual", "vis006"), ("Volcanic Ash", "rgb_ash"), ("Water Vapor", "wv062")]
for prod, lyr in EUM_MAP:
    for deg, ns, label in [("0 Degree", "msg_fes", "Meteosat 0°"), ("41.5 Degree", "msg_iodc", "Meteosat Indian Ocean")]:
        pretty = {"Infrared 0.39": "Infrared 3.9 µm", "Infrared 10.8": "Infrared 10.8 µm", "Visual": "Visible 0.6 µm", "Water Vapor": "Water Vapor 6.2 µm"}.get(prod, prod)
        add(4, "%s - %s" % (prod, deg), "eum-%s-%s" % (ns.split("_")[1], slug(lyr)), "%s %s" % (label, pretty), "weather",
            "EUMETSAT Meteosat (CC BY 4.0)", "wms", EUM_CREDIT,
            "EUMETView WMS image, requested at least one hour old so it falls under EUMETSAT's free CC BY 4.0 core data terms.",
            url=EUM, layers="%s:%s" % (ns, lyr), eumetsat=True)
for deg in ("0 Degree", "41.5 Degree"):
    skip(4, "Cloud Analysis - " + deg, "not-wired", "EUMETSAT retired the Cloud Analysis product; EUMETView no longer serves it")
    skip(4, "Multi-Sensor Precipitation Estimate - " + deg, "duplicate", "MPE was retired; its H SAF successor is wired once under Phase 3 (Meteosat precipitation rate)",
         "Meteosat 0° / Indian Ocean Precipitation Rate (EUMETSAT H SAF)")
inv = json.load(open(os.path.join(WORK, "inventory.json")))
for o in inv:
    if o["cv"] == "CIMSS MIMIC":
        skip(4, o["title"], "not-wired", "UW-Madison SSEC/CIMSS imagery is licensed for noncommercial use only, and MIMIC is published as static GIF/PNG images with no CORS or georeferenced tiles")
add(4, "Euro-Med Earthquakes - CSEM/EMSC", "emsc-quakes", "Global Euro-Med Earthquakes (EMSC-CSEM)", "natural-disasters", SUB_Q, "points",
    "Credit: EMSC-CSEM SeismicPortal (CC BY 4.0)", "Latest earthquakes from the European-Mediterranean Seismological Centre catalogue.",
    url="https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=500&orderby=time", fmt="geojson", refresh=300, color="#f2bd7a",
    fields=[["mag", "Magnitude"], ["flynn_region", "Region"], ["time", "Time", "iso"], ["depth", "Depth (km)"], ["auth", "Agency"]], title="flynn_region")

# ---------------------------------------------------------------- static snapshots
def write_snap(name, pins):
    with open(os.path.join(OUT, "snapshots", name), "w", encoding="utf-8") as f:
        json.dump(pins, f, ensure_ascii=False, separators=(",", ":"))
    return len(pins)

def gvp(fn):
    out = []
    for ft in json.load(open(os.path.join(WORK, "snap", fn)))["features"]:
        p = ft["properties"]
        lat, lon = p.get("Latitude"), p.get("Longitude")
        if lat is None or lon is None: continue
        ly = p.get("Last_Eruption_Year")
        era = ("Last eruption: %s" % (("%d BCE" % -ly) if ly < 0 else ("%d CE" % ly))) if isinstance(ly, int) else ("Epoch: %s" % p.get("Geologic_Epoch", ""))
        det = "; ".join(x for x in [p.get("Primary_Volcano_Type") and "Type: " + p["Primary_Volcano_Type"],
                                     p.get("Elevation") is not None and "Elevation: %s m" % p["Elevation"],
                                     p.get("Tectonic_Setting") and "Setting: " + p["Tectonic_Setting"]] if x)
        out.append([round(lat, 4), round(lon, 4), plain(p.get("Volcano_Name")), plain(", ".join(x for x in [p.get("Subregion"), p.get("Country")] if x)),
                    plain(era), plain(p.get("Geological_Summary"), 320), plain(det)])
    return out
counts = {}
counts["gvp-holocene"] = write_snap("gvp-holocene.json", gvp("gvp_holo.json"))
counts["gvp-pleistocene"] = write_snap("gvp-pleistocene.json", gvp("gvp_pleis.json"))
nd = []
for s in ET.parse(os.path.join(WORK, "snap", "ndbc.xml")).getroot():
    try: lat, lon = float(s.get("lat")), float(s.get("lon"))
    except (TypeError, ValueError): continue
    nd.append([lat, lon, plain("Station %s: %s" % (s.get("id"), s.get("name") or "")), plain(s.get("owner") or ""),
               plain("Type: %s" % (s.get("type") or "")), plain("Program: %s" % (s.get("pgm") or "")),
               plain("Meteorology: %s; currents: %s; water quality: %s; DART tsunami: %s" % tuple(
                   {"y": "yes", "n": "no"}.get(s.get(k), "n/a") for k in ("met", "currents", "waterquality", "dart")))])
counts["ndbc-buoys"] = write_snap("ndbc-stations.json", nd)
ae = []
for line in open(os.path.join(WORK, "snap", "aeronet.txt")).read().splitlines()[2:]:
    parts = line.split(",")
    if len(parts) < 4: continue
    try: lon, lat, el = float(parts[1]), float(parts[2]), float(parts[3])
    except ValueError: continue
    ae.append([round(lat, 4), round(lon, 4), plain(parts[0].replace("_", " ")), "", "AERONET sun photometer site",
               "Ground-based sun photometer in NASA's Aerosol Robotic Network.", "Elevation: %d m" % el])
counts["aeronet"] = write_snap("aeronet-sites.json", ae)
for L in layers:
    if L["key"] in counts: L["count"] = counts[L["key"]]

# ---------------------------------------------------------------- checks + write
names = [L["name"] for L in layers]
assert len(names) == len(set(names)), [n for n in names if names.count(n) > 1]
keys = [L["key"] for L in layers]
assert len(keys) == len(set(keys)), [k for k in keys if keys.count(k) > 1]
for L in layers:
    assert not re.search(r"\bworld(wide)?\b", L["name"], re.I), L["name"]
    for k in ("name", "desc", "credit", "sub", "note"):
        if k in L: assert not URL.search(str(L[k])), (L["key"], k, L[k])
groups_order = [k for k, _ in NEW_GROUPS]
reg = {"version": TODAY, "newGroups": [{"id": k, "label": v} for k, v in NEW_GROUPS], "layers": layers}
js = ("/* Global Status · extra layer registry (generated by scripts/build_extra_layers.py, do not edit by hand).\n"
      " * Phase 1: 170 custom open-data pin layers (layers-data/pack-N.json, fetched on first toggle).\n"
      " * Phase 2: NASA GIBS WMTS imagery. Phase 3: NOAA / USGS / EPA / FAA / Census feeds.\n"
      " * Phase 4: EUMETSAT (CC BY 4.0) and EMSC (CC BY 4.0). Cards and credits are plain text only.\n */\n"
      "window.GSX_REGISTRY = " + json.dumps(reg, ensure_ascii=False, separators=(",", ":")) + ";\n")
open(os.path.join(GS, "extra-layers-registry.js"), "w", encoding="utf-8").write(js)
json.dump(status, open(os.path.join(WORK, "status.json"), "w"), indent=1)
from collections import Counter
print("layers:", len(layers), Counter(L["phase"] for L in layers))
print("status:", Counter((s["phase"], s["status"]) for s in status))
print("inventory rows accounted:", len(status))
