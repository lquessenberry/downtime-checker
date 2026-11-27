#!/usr/bin/env python3
"""Empty-state illustrations, status/severity badges, and store screenshot frames."""
from mark import mark_group, DARK, svg
from text2path import text_path
from paths import UI, STORE
from raster import raster

NS = 'xmlns="http://www.w3.org/2000/svg"'
INK, DIM, BLUE, BG = "#d7e6ea", "#7f97a1", "#7ec8ff", "#070b10"
OUT = "#2a2e3c"


def T(txt, key, size, x, y, fill, track=0.0, anchor="start"):
    d, w = text_path(txt, key, size, 0, 0, track)
    if anchor == "middle":
        x -= w / 2
    elif anchor == "end":
        x -= w
    d, _ = text_path(txt, key, size, x, y, track)
    return f'<path d="{d}" fill="{fill}"/>', w


def empty_base(extra):
    # 512 canvas, faint globe, mark, caption supplied by caller
    s = f'<rect width="512" height="512" fill="{BG}"/>'
    s += '<g fill="none" stroke="#7ec8ff" stroke-opacity="0.14" stroke-width="1.6">'
    s += '<circle cx="256" cy="210" r="120"/>'
    s += '<ellipse cx="256" cy="210" rx="48" ry="120"/>'
    s += '<path d="M136 210 H376 M166 150 H346 M166 270 H346"/>'
    s += "</g>"
    s += mark_group(DARK, True, 256 - 40, 210 - 40, 80 / 64)
    s += extra
    return s


def build_empty():
    UI.mkdir(parents=True, exist_ok=True)
    (UI / "empty").mkdir(exist_ok=True)
    scenes = {
        "empty-layer": (
            '<g fill="none" stroke="#7f97a1" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="4 4">'
            '<circle cx="256" cy="210" r="18"/></g>'
            + T("NO POINTS IN THIS LAYER", "mono500", 16, 256, 400, DIM, 0.08, "middle")[0]
            + T("Try another layer, or widen the view.", "cond400", 18, 256, 430, INK, 0, "middle")[0]
        ),
        "empty-search": (
            '<g fill="none" stroke="#7ec8ff" stroke-width="2.4" stroke-linecap="round">'
            '<circle cx="318" cy="268" r="16"/><path d="M330 280 L348 298"/></g>'
            + T("NO MATCHES", "mono500", 16, 256, 400, DIM, 0.08, "middle")[0]
            + T("Nothing in the catalog matches that search.", "cond400", 18, 256, 430, INK, 0, "middle")[0]
        ),
        "offline": (
            '<g fill="none" stroke="#ff4d4d" stroke-width="2.4" stroke-linecap="round">'
            '<path d="M200 210 H226 M286 210 H312"/><path d="M214 248 L298 172"/></g>'
            + T("OFFLINE", "mono500", 16, 256, 400, DIM, 0.08, "middle")[0]
            + T("Live feeds will resume when you reconnect.", "cond400", 18, 256, 430, INK, 0, "middle")[0]
        ),
        "locating": (
            '<g fill="none" stroke="#3dff9a" stroke-width="2.2" stroke-linecap="round">'
            '<circle cx="256" cy="210" r="28" stroke-opacity="0.45"/>'
            '<circle cx="256" cy="210" r="8"/><path d="M256 168 V188 M256 232 V252 M214 210 H234 M278 210 H298"/>'
            '</g>'
            + T("FINDING YOUR POSITION", "mono500", 16, 256, 400, DIM, 0.08, "middle")[0]
            + T("The globe will center when a fix is ready.", "cond400", 18, 256, 430, INK, 0, "middle")[0]
        ),
        "no-permission": (
            '<g fill="none" stroke="#ffb020" stroke-width="2.2" stroke-linecap="round">'
            '<path d="M256 252 C256 252 230 230 230 210 A26 26 0 1 1 282 210 C282 230 256 252 256 252Z"/>'
            '<path d="M226 248 L286 172"/>'
            '</g>'
            + T("LOCATION OFF", "mono500", 16, 256, 400, DIM, 0.08, "middle")[0]
            + T("You can still explore the globe without a pin.", "cond400", 18, 256, 430, INK, 0, "middle")[0]
        ),
    }
    for name, extra in scenes.items():
        path = UI / "empty" / f"{name}.svg"
        path.write_text(svg(512, 512, empty_base(extra)))
        raster(path, UI / "empty" / f"{name}.png", 512, 512)


def pill(label, color, width_hint=None):
    size = 13
    p, w = T(label, "mono500", size, 0, 0, color, 0.08)
    pad = size * 1.2
    pw = w + pad * 2 + 14
    h = 28
    body = (
        f'<rect width="{pw:.1f}" height="{h}" rx="{h/2}" fill="{color}" fill-opacity="0.12" '
        f'stroke="{color}" stroke-opacity="0.7"/>'
        f'<circle cx="14" cy="{h/2}" r="4" fill="{color}"/>'
    )
    lab, _ = T(label, "mono500", size, 24, h / 2 + size * 0.36, color, 0.08)
    return svg(int(pw + 1), h, body + lab), int(pw + 1), h


def dot(color):
    return svg(24, 24, f'<circle cx="12" cy="12" r="8" fill="{color}" stroke="{OUT}" stroke-width="1.5"/>')


def build_badges():
    bdir = UI / "badges"
    bdir.mkdir(parents=True, exist_ok=True)
    status = {
        "up": "#3dff9a",
        "down": "#ff4d4d",
        "pending": "#ffb020",
        "stale": "#9aa8b2",
        "unknown": "#7f97a1",
    }
    severity = {
        "extreme": "#ff4d4d",
        "severe": "#ff7a3a",
        "moderate": "#ffb020",
        "minor": "#d4e06a",
        "info": "#7ec8ff",
    }
    extra = {
        "opt-in": ("#e0c36a", "OPT-IN"),
        "link-only": ("#e879f9", "LINK ONLY"),
        "caveat": ("#ffb020", "CAVEATED"),
    }
    for name, color in status.items():
        s, w, h = pill(name.upper(), color)
        (bdir / f"status-{name}.svg").write_text(s)
        raster(bdir / f"status-{name}.svg", bdir / f"status-{name}.png", w, h)
        (bdir / f"dot-{name}.svg").write_text(dot(color))
        raster(bdir / f"dot-{name}.svg", bdir / f"dot-{name}.png", 24, 24)
    for name, color in severity.items():
        s, w, h = pill(name.upper(), color)
        (bdir / f"severity-{name}.svg").write_text(s)
        raster(bdir / f"severity-{name}.svg", bdir / f"severity-{name}.png", w, h)
    for name, (color, label) in extra.items():
        s, w, h = pill(label, color)
        (bdir / f"badge-{name}.svg").write_text(s)
        raster(bdir / f"badge-{name}.svg", bdir / f"badge-{name}.png", w, h)


def frame(W, H, label):
    # Bezel with brand chrome and an empty well for a future screenshot.
    well_x, well_y = 48, 88
    well_w, well_h = W - 96, H - 176
    body = f'<rect width="{W}" height="{H}" fill="#0b121a"/>'
    body += f'<rect x="1" y="1" width="{W-2}" height="{H-2}" rx="28" fill="none" stroke="#7ec8ff" stroke-opacity="0.28" stroke-width="2"/>'
    body += mark_group(DARK, False, 36, 20, 48 / 64)
    title, _ = T("GLOBAL STATUS", "cond600", 28, 100, 56, INK, 0.04)
    sub, _ = T(label, "mono400", 14, W - 48, 54, DIM, 0.08, "end")
    body += title + sub
    body += (
        f'<rect x="{well_x}" y="{well_y}" width="{well_w}" height="{well_h}" rx="8" '
        f'fill="#070b10" stroke="rgba(120,190,210,.28)"/>'
    )
    hint, _ = T("DROP SCREENSHOT HERE", "mono500", 18, W / 2, well_y + well_h / 2, DIM, 0.12, "middle")
    body += hint
    foot, _ = T("globalstatus.app", "mono400", 14, W / 2, H - 36, DIM, 0.06, "middle")
    body += foot
    return svg(W, H, body)


def build_frames():
    fdir = STORE / "frames"
    fdir.mkdir(parents=True, exist_ok=True)
    for name, W, H, label in (
        ("frame-landscape-1920x1080", 1920, 1080, "16:9  ·  STORE SCREENSHOT"),
        ("frame-portrait-1080x1920", 1080, 1920, "9:16  ·  STORE SCREENSHOT"),
    ):
        path = fdir / f"{name}.svg"
        path.write_text(frame(W, H, label))
        raster(path, fdir / f"{name}.png", W, H)


def build():
    build_empty()
    build_badges()
    build_frames()
    print("ui ok")


if __name__ == "__main__":
    build()
