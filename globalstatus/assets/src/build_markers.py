#!/usr/bin/env python3
"""Hand-authored SVG map markers for every Global Status layer.

Colors follow the live Cesium CSS swatches so the glyphs match the rail if
wired later. Brand-token differences are noted in ASSETS.md.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from paths import MARKERS
from raster import raster

NS = 'xmlns="http://www.w3.org/2000/svg"'
BG = "#10202c"
OUTLINE = "#2a2e3c"
SW = 1.7

# Live CSS swatch colors (cesium.css). Multi-stop layers use a primary.
LAYERS = [
    # id, label, group, color, kind (point|line|area|sim|link), glyph
    ("effects", "Nuke simulator", "simulators", "#ff8f1f", "sim", "trefoil"),
    ("aircraft", "ADS-B aircraft", "transportation", "#7ec8ff", "point", "aircraft"),
    ("ships", "AIS ships", "transportation", "#3dffd0", "point", "ship"),
    ("airports", "Airports", "transportation", "#cfd8e3", "point", "airport"),
    ("tfr", "FAA TFRs", "transportation", "#ff4d4d", "area", "tfr"),
    ("delays", "Flight delays", "transportation", "#ff8c1a", "point", "clock"),
    ("iss", "ISS", "space", "#ffffff", "point", "iss"),
    ("sats", "Satellites", "space", "#7fe0ff", "point", "satellite"),
    ("aurora", "Aurora", "space", "#28ff78", "area", "aurora"),
    ("daynight", "Day / night", "space", "#ffe9a8", "area", "daynight"),
    ("radar", "Radar", "weather", "#39c0ff", "area", "radar"),
    ("nwsalerts", "NWS alerts", "weather", "#f08a24", "area", "warning"),
    ("hurricanes", "Hurricanes", "weather", "#7fe7ff", "area", "hurricane"),
    ("quakes", "Earthquakes", "natural-disasters", "#e25b12", "point", "seismograph"),
    ("volcanoes", "Volcanoes", "natural-disasters", "#f08a24", "point", "volcano"),
    ("tsunami", "Tsunami", "floods-water", "#e0262a", "area", "wave"),
    ("wildfires", "Wildfires", "natural-disasters", "#ff6a1a", "area", "flame"),
    ("disasters", "Disaster events", "natural-disasters", "#f08a24", "point", "diamond"),
    ("rivers", "Rivers / gauges", "floods-water", "#3aa6ff", "line", "river"),
    ("coastal", "Coastal flood", "floods-water", "#3aa6ff", "area", "coast"),
    ("outages", "USA power outages", "power-comms", "#f08a24", "area", "bolt_slash"),
    ("ukout", "UK power outages", "power-comms", "#f08a24", "area", "bolt_slash"),
    ("caout", "Canada power outages", "power-comms", "#f08a24", "area", "bolt_slash"),
    ("auout", "Australia power outages", "power-comms", "#f08a24", "area", "bolt_slash"),
    ("inetusa", "USA internet outages", "power-comms", "#ff3b3b", "area", "globe_slash"),
    ("inetglobal", "Global internet outages", "power-comms", "#ff9b2f", "area", "globe_slash"),
    ("stream", "Streams / scanners", "power-comms", "#c084fc", "point", "broadcast"),
    ("amfm", "AM / FM towers", "power-comms", "#7aa2ff", "point", "radio_tower"),
    ("celltowers", "USA cell towers", "power-comms", "#3fd0c9", "point", "cell_tower"),
    ("powerlines", "USA power lines", "power-comms", "#35d08a", "line", "pylon"),
    ("powerplants", "Power plants", "power-comms", "#ff8c2a", "point", "plant"),
    ("mesh", "Mesh networks", "power-comms", "#8fe04a", "point", "mesh"),
    ("jamming", "GPS jamming", "power-comms", "#ff7a3a", "area", "jam"),
    ("radio", "Ham / WebSDR", "power-comms", "#f5c542", "point", "radio"),
    ("police", "Police", "emergency", "#2f6bff", "point", "shield"),
    ("sheriff", "Sheriff", "emergency", "#ffc233", "point", "star"),
    ("fire", "Fire departments", "emergency", "#e8261c", "point", "hydrant"),
    ("hospitals", "Hospitals", "emergency", "#ff2d2d", "point", "cross"),
    ("conflicts", "Conflicts", "conflict-military", "#d65b29", "point", "burst"),
    ("bases", "Military bases", "conflict-military", "#c58cff", "point", "chevron"),
    ("designations", "Designations (opt-in)", "conflict-military", "#e0c36a", "point", "seal"),
    ("disease", "Disease outbreaks", "health", "#ff4d6a", "point", "virus"),
    ("animal", "Animal disease", "health", "#e2b340", "point", "paw"),
    ("hunger", "Hunger / food insecurity", "health", "#af4729", "point", "wheat"),
    ("airquality", "Air quality", "health", "#00e400", "area", "wind"),
    ("gunsusa", "USA firearms", "firearms", "#d4a84b", "point", "firearm"),
    ("gunsworld", "World firearms", "firearms", "#c45a2e", "point", "firearm_globe"),
    ("ccw", "CCW reciprocity", "firearms", "#2f7bff", "area", "card"),
    ("militianational", "National militia groups", "militias", "#e07040", "point", "flag"),
    ("militiastate", "Statewide militia groups", "militias", "#e0b04a", "point", "figures"),
    ("militialocal", "Local militia groups", "militias", "#5aad7a", "point", "figures"),
    ("militiainactive", "Inactive militia groups", "militias", "#8b8498", "point", "figures"),
    ("ufo", "UFO reports", "paranormal", "#9fd4e2", "point", "ufo"),
    ("bigfoot", "Bigfoot reports", "paranormal", "#c4a574", "point", "footprint"),
]

GROUPS = [
    ("simulators", "Simulators & games", "#ff8f1f", "trefoil"),
    ("transportation", "Transportation", "#7ec8ff", "aircraft"),
    ("space", "Space", "#7fe0ff", "satellite"),
    ("weather", "Weather", "#39c0ff", "radar"),
    ("natural-disasters", "Natural disasters", "#e25b12", "warning"),
    ("floods-water", "Floods & water", "#3aa6ff", "wave"),
    ("power-comms", "Power & communications", "#35d08a", "bolt"),
    ("emergency", "Emergency services", "#ff2d2d", "cross"),
    ("conflict-military", "Conflict & military", "#d65b29", "burst"),
    ("health", "Health & humanitarian", "#ff4d6a", "cross"),
    ("firearms", "Firearms", "#d4a84b", "firearm"),
    ("militias", "Militias", "#e07040", "flag"),
    ("paranormal", "Paranormal", "#9fd4e2", "ufo"),
]


def g(inner: str, color: str, filled: bool = False) -> str:
    fill = color if filled else "none"
    return (
        f'<g fill="{fill}" stroke="{color}" stroke-width="{SW}" '
        f'stroke-linecap="round" stroke-linejoin="round">{inner}</g>'
    )


def glyph(name: str, color: str) -> str:
    """Return inner SVG for a 32x32 canvas, already wrapped in a stroke group."""
    c = color
    if name == "trefoil":
        blade = "M0-3.1C-4.6-3.1-6.6-8.2-3.1-10.8C0.4-13.4 4.7-11.1 4.7-7.2C4.7-4.1 2.1-3.1 0-3.1Z"
        blades = "".join(
            f'<path d="{blade}" transform="translate(16 16) rotate({a})"/>' for a in (0, 120, 240)
        )
        return f'<g fill="{c}" stroke="none">{blades}<circle cx="16" cy="16" r="1.8"/></g>'
    if name == "aircraft":
        return g(
            '<path d="M16 7 L18.4 13.6 L25.5 15.2 V17 L18.4 16.4 L17.6 22.2 L20.2 24.2 V25.5 L16 24.2 L11.8 25.5 V24.2 L14.4 22.2 L13.6 16.4 L6.5 17 V15.2 L13.6 13.6 Z"/>',
            c,
            True,
        )
    if name == "ship":
        return g(
            '<path d="M8 18 L12 14.5 H20.5 L24 18 V21 H8 Z"/><path d="M15 14.5 V11 H18.5 V14.5"/><path d="M7 23 H25"/>',
            c,
        )
    if name == "airport":
        return g(
            # runway with threshold ticks, plane above
            '<path d="M7.5 22 H24.5" stroke-width="2.2"/>'
            '<path d="M10 20.4 V23.6 M13 20.4 V23.6 M16 20.4 V23.6 M19 20.4 V23.6 M22 20.4 V23.6"/>'
            '<path d="M16 6.8 L17.8 12.4 L24 13.6 V14.8 L17.8 14.2 L17.2 18.6 L19.4 20 V21 L16 19.8 L12.6 21 V20 L14.8 18.6 L14.2 14.2 L8 14.8 V13.6 L14.2 12.4 Z"/>',
            c,
        )
    if name == "tfr":
        return g(
            '<rect x="9" y="9" width="14" height="14" rx="1.6" stroke-dasharray="2.6 1.8"/><path d="M12 12 L20 20 M20 12 L12 20"/>',
            c,
        )
    if name == "clock":
        return g('<circle cx="16" cy="16" r="7.2"/><path d="M16 11.2 V16.2 L20 18.2"/>', c)
    if name == "iss":
        return g(
            '<rect x="13" y="13" width="6" height="6" rx="0.6"/>'
            '<rect x="5" y="14.2" width="7.2" height="3.6" rx="0.3"/>'
            '<rect x="19.8" y="14.2" width="7.2" height="3.6" rx="0.3"/>'
            '<path d="M8.6 14.2 V17.8 M16 13 V10.2"/>',
            c,
        )
    if name == "satellite":
        return g(
            '<rect x="13.6" y="13.6" width="4.8" height="4.8" transform="rotate(45 16 16)"/>'
            '<path d="M7.5 16 H12.2 M19.8 16 H24.5"/>'
            '<path d="M18.2 11.5 L20.5 8.4"/>'
            '<circle cx="21" cy="7.8" r="1.1"/>',
            c,
        )
    if name == "aurora":
        return g(
            '<path d="M7 21 C11 13, 15 18, 19 11 C21 15, 24 13, 26 15"/>'
            '<path d="M7 23.5 C12 17, 16 21, 25 14"/>',
            c,
        )
    if name == "daynight":
        return (
            f'<g fill="none" stroke="{c}" stroke-width="{SW}" stroke-linecap="round">'
            f'<circle cx="16" cy="16" r="7.2"/>'
            f'<path d="M16 8.8 A7.2 7.2 0 0 1 16 23.2 Z" fill="{c}" stroke="none"/>'
            f'</g>'
        )
    if name == "radar":
        return g(
            '<circle cx="16" cy="16" r="7.4"/><circle cx="16" cy="16" r="4"/>'
            '<path d="M16 16 L22.2 9.8"/><circle cx="16" cy="16" r="1.1"/>',
            c,
        )
    if name == "warning":
        return g(
            '<path d="M16 8 L25.5 24.2 H6.5 Z"/><path d="M16 14.2 V19.2"/><circle cx="16" cy="21.6" r="0.7" fill="{c}" stroke="none"/>'.replace("{c}", c),
            c,
        )
    if name == "hurricane":
        return g(
            '<circle cx="16" cy="16" r="1.8"/>'
            '<path d="M17.8 13.2 C23 7.5, 28 12.5, 25 19.5"/>'
            '<path d="M14.2 18.8 C9 24.5, 4 19.5, 7 12.5"/>',
            c,
        )
    if name == "seismograph":
        return g('<path d="M6 16 H10.2 L12.6 9.5 L16 23 L19.4 11.2 L21.8 16 H26"/>', c)
    if name == "volcano":
        return g(
            '<path d="M6.5 24 L12.2 14.5 L15.8 20.2 L20 12.2 L25.5 24 Z"/>'
            '<path d="M16.6 12 C15.2 8.2, 19.4 7, 17.6 5.2"/>',
            c,
        )
    if name == "wave":
        return g(
            '<path d="M6 18 C10 18, 10 12.5, 16 12.5 C22 12.5, 22 18, 26 18"/>'
            '<path d="M6 23 C10 23, 10 17.5, 16 17.5 C22 17.5, 22 23, 26 23"/>',
            c,
        )
    if name == "flame":
        return g(
            '<path d="M16 25 C9.5 25, 9.2 16.5, 16 8.2 C14.2 15.5, 22.2 16.8, 16 25 Z"/>',
            c,
            True,
        )
    if name == "diamond":
        return g('<path d="M16 8 L24.2 16 L16 24 L7.8 16 Z"/>', c)
    if name == "river":
        return g(
            '<path d="M8 8 C12 8, 12 16, 16 16 C20 16, 20 24, 24 24"/>'
            '<path d="M6.5 11 C10.5 11, 10.5 19, 16 19 C21.5 19, 21.5 26, 25.5 26"/>',
            c,
        )
    if name == "coast":
        return g(
            '<path d="M6 15 L13.5 15 L16 11.5 L18.5 18 L22 13.5 L26 15"/>'
            '<path d="M6 20 C10 18, 14 22, 18 20 C22 18, 24 22, 26 20"/>',
            c,
        )
    if name == "bolt":
        return g('<path d="M18.2 7 L10.5 16.2 H16.1 L13.8 25 L22.2 14.2 H16.5 Z"/>', c, True)
    if name == "bolt_slash":
        return g(
            '<path d="M18.2 7 L10.5 16.2 H16.1 L13.8 25 L22.2 14.2 H16.5 Z"/>'
            '<path d="M9 23 L23 9"/>',
            c,
        )
    if name == "globe_slash":
        return g(
            '<circle cx="16" cy="16" r="7.2"/>'
            '<ellipse cx="16" cy="16" rx="3.1" ry="7.2"/>'
            '<path d="M8.8 16 H23.2"/>'
            '<path d="M9 23 L23 9"/>',
            c,
        )
    if name == "broadcast":
        return g(
            '<circle cx="11.5" cy="16" r="1.6"/>'
            '<path d="M15 12.2 A5.6 5.6 0 0 1 15 19.8"/>'
            '<path d="M18.4 9.4 A9.2 9.2 0 0 1 18.4 22.6"/>',
            c,
        )
    if name == "radio_tower":
        return g(
            '<path d="M16 24 V10.5"/>'
            '<path d="M16 10.5 L11.5 24 M16 10.5 L20.5 24"/>'
            '<path d="M13 18.5 H19"/>'
            '<path d="M12.2 10.2 A4.2 4.2 0 0 1 19.8 10.2"/>',
            c,
        )
    if name == "cell_tower":
        return g(
            '<path d="M16 24 V9"/>'
            '<path d="M13 24 H19"/>'
            '<path d="M16 12 L11.8 24 M16 12 L20.2 24"/>'
            '<path d="M16 9 A4.5 4.5 0 0 1 20.2 11.4"/>'
            '<path d="M16 9 A4.5 4.5 0 0 0 11.8 11.4"/>',
            c,
        )
    if name == "pylon":
        return g(
            '<path d="M10.2 24 L14.2 8 H17.8 L21.8 24"/>'
            '<path d="M12.2 14 H19.8 M11.4 19 H20.6"/>'
            '<path d="M8 8.2 H24"/>',
            c,
        )
    if name == "plant":
        return g(
            # hyperboloid cooling tower: slight waist, wide base, steam
            '<path d="M11.2 9 C12.4 13.5, 12.2 18.5, 9.2 24 H22.8 C19.8 18.5, 19.6 13.5, 20.8 9 Z"/>'
            '<path d="M11.2 9 H20.8"/>'
            '<path d="M13.8 8.2 C12.8 5, 16.2 4.8, 15.4 8.2 M17 8.2 C16 4.6, 19.6 5, 18.4 8.2"/>',
            c,
        )
    if name == "mesh":
        nodes = [(10, 10), (22, 10), (10, 22), (22, 22), (16, 16)]
        lines = '<path d="M10 10 L22 10 L22 22 L10 22 Z M10 10 L22 22 M22 10 L10 22"/>'
        dots = "".join(f'<circle cx="{x}" cy="{y}" r="1.5"/>' for x, y in nodes)
        return g(lines + dots, c)
    if name == "jam":
        return g(
            '<path d="M10.2 16 A7.2 7.2 0 0 1 21.8 16"/>'
            '<path d="M12.4 18.2 A4.6 4.6 0 0 1 19.6 18.2"/>'
            '<circle cx="16" cy="21.2" r="1.15"/>'
            '<path d="M9 23 L23 9"/>',
            c,
        )
    if name == "radio":
        return g(
            '<rect x="8" y="14.2" width="16" height="9.2" rx="1.2"/>'
            '<circle cx="13.2" cy="18.8" r="2"/>'
            '<path d="M19.5 14.2 V8.2 H15.5"/>',
            c,
        )
    if name == "shield":
        return g(
            '<path d="M16 7.2 L24 10.2 V17 C24 21.6, 16 24.8, 16 24.8 C16 24.8, 8 21.6, 8 17 V10.2 Z"/>',
            c,
        )
    if name == "star":
        pts = []
        for i in range(5):
            a = math.radians(-90 + i * 72)
            pts.append((16 + 8.2 * math.cos(a), 16 + 8.2 * math.sin(a)))
            a2 = math.radians(-90 + i * 72 + 36)
            pts.append((16 + 3.4 * math.cos(a2), 16 + 3.4 * math.sin(a2)))
        d = "M" + " L".join(f"{x:.2f} {y:.2f}" for x, y in pts) + " Z"
        return g(f'<path d="{d}"/>', c, True)
    if name == "hydrant":
        return g(
            '<path d="M12.2 24 V16.2 A3.8 3.8 0 0 1 19.8 16.2 V24"/>'
            '<path d="M10 16.4 H22"/>'
            '<path d="M16 12.5 V16.2"/>'
            '<path d="M13.5 24 H18.5"/>',
            c,
        )
    if name == "cross":
        return g(
            '<path d="M13.2 8.2 H18.8 V13.2 H23.8 V18.8 H18.8 V23.8 H13.2 V18.8 H8.2 V13.2 H13.2 Z"/>',
            c,
            True,
        )
    if name == "burst":
        return g(
            '<path d="M16 7.5 L17.4 13.2 L23.2 11.2 L19 16 L24.5 19.2 L18.2 18.6 L19.6 24.5 L16 20 L12.4 24.5 L13.8 18.6 L7.5 19.2 L13 16 L8.8 11.2 L14.6 13.2 Z"/>',
            c,
            True,
        )
    if name == "chevron":
        return g(
            '<path d="M8.5 20.5 L16 9 L23.5 20.5"/>'
            '<path d="M11.5 20.5 V24 H20.5 V20.5"/>',
            c,
        )
    if name == "seal":
        return g(
            '<circle cx="16" cy="16" r="7.4"/>'
            '<circle cx="16" cy="16" r="4.6"/>'
            '<path d="M16 12.2 L17.1 14.8 L20 15 L17.8 16.8 L18.5 19.6 L16 18.2 L13.5 19.6 L14.2 16.8 L12 15 L14.9 14.8 Z"/>',
            c,
        )
    if name == "virus":
        spikes = []
        for i in range(8):
            a = math.radians(i * 45)
            x1, y1 = 16 + 5 * math.cos(a), 16 + 5 * math.sin(a)
            x2, y2 = 16 + 8.6 * math.cos(a), 16 + 8.6 * math.sin(a)
            spikes.append(f'<path d="M{x1:.2f} {y1:.2f} L{x2:.2f} {y2:.2f}"/>')
        return g(f'<circle cx="16" cy="16" r="5"/>' + "".join(spikes), c)
    if name == "paw":
        pads = [(16, 19.5, 3.2, 2.6), (10.8, 13.2, 1.7, 2.1), (14, 10.6, 1.7, 2.1), (18, 10.6, 1.7, 2.1), (21.2, 13.2, 1.7, 2.1)]
        ell = "".join(
            f'<ellipse cx="{x}" cy="{y}" rx="{rx}" ry="{ry}"/>' for x, y, rx, ry in pads
        )
        return g(ell, c, True)
    if name == "wheat":
        grains = "".join(
            f'<path d="M16 {y} L13 {y-1.6} L16 {y-3.2} L19 {y-1.6} Z"/>'
            for y in (12, 15, 18, 21)
        )
        return g(f'<path d="M16 24 V9"/>{grains}', c)
    if name == "wind":
        return g(
            '<path d="M8 12.2 H20.2 A2.8 2.8 0 1 0 20.2 12.2"/>'
            '<path d="M8 16.2 H22.5"/>'
            '<path d="M8 20.2 H18.2 A2.8 2.8 0 1 1 18.2 20.2"/>',
            c,
        )
    if name == "firearm":
        # Schematic side view: barrel + receiver + grip. Legend-scale, no detail.
        return g(
            '<path d="M6.5 13.6 H22.8 V15.8 H14.6 V22.4 H11.6 V15.8 H6.5 Z"/>'
            '<path d="M22.8 13.6 H25.2 V15.2"/>',
            c,
        )
    if name == "firearm_globe":
        return g(
            '<path d="M6.5 13.6 H20.2 V15.8 H13.8 V22.4 H11 V15.8 H6.5 Z"/>'
            '<circle cx="22.4" cy="20.2" r="3.6"/>'
            '<ellipse cx="22.4" cy="20.2" rx="1.5" ry="3.6"/>'
            '<path d="M18.8 20.2 H26"/>',
            c,
        )
    if name == "card":
        return g(
            '<rect x="8.2" y="10" width="15.6" height="12" rx="1.4"/>'
            '<path d="M11.5 16.2 L14.4 19 L20.2 13.2"/>',
            c,
        )
    if name == "flag":
        return g(
            '<path d="M11 8.2 V24"/>'
            '<path d="M11 8.2 H22.5 L19.8 12.4 L22.5 16.6 H11"/>',
            c,
        )
    if name == "figures":
        heads = '<circle cx="10.2" cy="11" r="1.7"/><circle cx="16" cy="10.2" r="1.7"/><circle cx="21.8" cy="11" r="1.7"/>'
        bodies = '<path d="M10.2 13.4 V22 M7.8 16.2 H12.6 M16 12.6 V22 M13.4 16 H18.6 M21.8 13.4 V22 M19.4 16.2 H24.2"/>'
        return g(heads + bodies, c)
    if name == "ufo":
        return g(
            '<ellipse cx="16" cy="17.2" rx="10" ry="3.4"/>'
            '<path d="M11.2 17 A5.2 3.2 0 0 1 20.8 17"/>'
            '<circle cx="12.5" cy="17.2" r="0.7"/><circle cx="16" cy="17.2" r="0.7"/><circle cx="19.5" cy="17.2" r="0.7"/>',
            c,
        )
    if name == "footprint":
        return g(
            '<ellipse cx="16" cy="19.4" rx="4.2" ry="5.4"/>'
            + "".join(
                f'<ellipse cx="{x}" cy="{y}" rx="1.15" ry="1.55"/>'
                for x, y in ((11.6, 12.2), (14, 10.4), (16.8, 10), (19.4, 11.2), (21.2, 13.4))
            ),
            c,
            True,
        )
    raise KeyError(name)


def badge_svg(inner: str) -> str:
    return (
        f'<svg {NS} viewBox="0 0 32 32" width="32" height="32">'
        f'<circle cx="16" cy="16" r="15" fill="{BG}" stroke="{OUTLINE}" stroke-width="1.5"/>'
        f"{inner}</svg>\n"
    )


def pin_svg(inner: str, color: str) -> str:
    # Teardrop pin; glyph sits in the 32x32 head (center 16,16).
    return (
        f'<svg {NS} viewBox="0 0 32 44" width="32" height="44">'
        f'<path d="M16 42 C16 42 3.8 28.5 3.8 16 A12.2 12.2 0 1 1 28.2 16 C28.2 28.5 16 42 16 42Z" '
        f'fill="{BG}" stroke="{OUTLINE}" stroke-width="1.5" stroke-linejoin="round"/>'
        f'<circle cx="16" cy="16" r="11.2" fill="none" stroke="{color}" stroke-opacity="0.22" stroke-width="1.2"/>'
        f"{inner}</svg>\n"
    )


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def build():
    svg_dir = MARKERS / "svg"
    png_dir = MARKERS / "png"
    svg_dir.mkdir(parents=True, exist_ok=True)
    png_dir.mkdir(parents=True, exist_ok=True)

    catalog = []
    for lid, label, group, color, kind, gname in LAYERS:
        inner = glyph(gname, color)
        badge = badge_svg(inner)
        bpath = svg_dir / f"{lid}.svg"
        write(bpath, badge)
        raster(bpath, png_dir / f"{lid}-32.png", 32, 32)
        raster(bpath, png_dir / f"{lid}-64.png", 64, 64)
        entry = {
            "id": lid,
            "label": label,
            "group": group,
            "color": color,
            "kind": kind,
            "glyph": gname,
            "svg": f"markers/svg/{lid}.svg",
            "png32": f"markers/png/{lid}-32.png",
            "png64": f"markers/png/{lid}-64.png",
        }
        if kind in {"point", "sim"}:
            ppath = svg_dir / f"{lid}-pin.svg"
            write(ppath, pin_svg(inner, color))
            raster(ppath, png_dir / f"{lid}-pin-64.png", 48, 66)
            entry["pin_svg"] = f"markers/svg/{lid}-pin.svg"
            entry["pin_png64"] = f"markers/png/{lid}-pin-64.png"
        catalog.append(entry)

    groups = []
    gdir_svg = svg_dir / "groups"
    gdir_png = png_dir / "groups"
    for gid, label, color, gname in GROUPS:
        inner = glyph(gname, color)
        # Group marks use a rounded square so they read as folders, not pins.
        body = (
            f'<svg {NS} viewBox="0 0 32 32" width="32" height="32">'
            f'<rect x="1.2" y="1.2" width="29.6" height="29.6" rx="7" fill="{BG}" '
            f'stroke="{OUTLINE}" stroke-width="1.5"/>'
            f"{inner}</svg>\n"
        )
        p = gdir_svg / f"{gid}.svg"
        write(p, body)
        raster(p, gdir_png / f"{gid}-64.png", 64, 64)
        groups.append({
            "id": gid,
            "label": label,
            "color": color,
            "glyph": gname,
            "svg": f"markers/svg/groups/{gid}.svg",
            "png64": f"markers/png/groups/{gid}-64.png",
        })

    (MARKERS / "markers.json").write_text(json.dumps({
        "layers": catalog,
        "groups": groups,
        "notes": {
            "color_source": "Live Cesium CSS swatches in globalstatus/cesium.css, not always the WOR-5 brand tokens.",
            "disease_color": "CSS #ff4d6a; brand token color.layer.disease is #b78bff. Confirm before wiring.",
            "hunger_color": "CSS #af4729; brand token color.layer.food is #d9b44a.",
            "conflicts_color": "CSS #d65b29; brand token color.layer.conflict is #ff5a5f.",
            "designations_radio": "designations and radio/ham are not in the current layer rail; glyphs are ready for a later toggle.",
        },
    }, indent=2) + "\n")
    print(f"markers: {len(catalog)} layers, {len(groups)} groups")


if __name__ == "__main__":
    build()
