#!/usr/bin/env python3
"""Contact sheets for review (also copied to /workspace/asset-previews/)."""
import json
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from paths import ROOT, ICONS, MARKERS, SPLASH, STORE, UI, PREVIEW, LOGO

OUT_REPO = PREVIEW
OUT_REVIEW = Path("/workspace/asset-previews")
BG = (7, 11, 16, 255)
INK = (215, 230, 234, 255)
DIM = (127, 151, 161, 255)
BLUE = (126, 200, 255, 255)


def font(size, mono=False):
    path = (
        "/usr/share/fonts/truetype/sand-box/google/IBM Plex Mono/IBMPlexMono-Medium.ttf"
        if mono
        else "/usr/share/fonts/truetype/sand-box/google/IBM Plex Sans Condensed/IBMPlexSansCondensed-SemiBold.ttf"
    )
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


def canvas(w, h):
    return Image.new("RGBA", (w, h), BG)


def text(draw, xy, s, size=18, fill=INK, mono=False, anchor="lt"):
    draw.text(xy, s, font=font(size, mono), fill=fill, anchor=anchor)


def paste_fit(dst, src_path, box, pad=0):
    im = Image.open(src_path).convert("RGBA")
    bw, bh = box[2] - box[0] - pad * 2, box[3] - box[1] - pad * 2
    scale = min(bw / im.width, bh / im.height)
    nw, nh = max(1, int(im.width * scale)), max(1, int(im.height * scale))
    im = im.resize((nw, nh), Image.LANCZOS)
    x = box[0] + pad + (bw - nw) // 2
    y = box[1] + pad + (bh - nh) // 2
    dst.alpha_composite(im, (x, y))
    return im.size


def save(im, name):
    OUT_REPO.mkdir(parents=True, exist_ok=True)
    OUT_REVIEW.mkdir(parents=True, exist_ok=True)
    rgb = Image.new("RGB", im.size, (7, 11, 16))
    rgb.paste(im, mask=im.split()[-1] if im.mode == "RGBA" else None)
    for dest in (OUT_REPO / name, OUT_REVIEW / name):
        rgb.save(dest, "PNG", optimize=True)
        print(" sheet", dest, rgb.size)


def sheet_icons():
    im = canvas(1600, 900)
    d = ImageDraw.Draw(im)
    text(d, (48, 36), "SET 1  ·  APP ICONS", 28, BLUE, True)
    text(d, (48, 72), "PWA, maskable, Apple touch, Android adaptive, desktop, F-Droid", 18, DIM)
    # hero icons
    items = [
        (ICONS / "png/icon-1024.png", "Rounded"),
        (ICONS / "desktop/icon-macos-1024.png", "macOS grid"),
        (ICONS / "pwa/icon-maskable-512.png", "Maskable"),
        (ICONS / "android/ic_launcher_foreground-432.png", "Adaptive FG"),
    ]
    x = 48
    for path, label in items:
        box = (x, 120, x + 300, 420)
        d.rounded_rectangle(box, 16, fill=(16, 32, 44, 255))
        if "foreground" in path.name:
            bg = Image.open(ICONS / "android/ic_launcher_background-432.png").convert("RGBA").resize((260, 260), Image.LANCZOS)
            fg = Image.open(path).convert("RGBA").resize((260, 260), Image.LANCZOS)
            tmp = canvas(260, 260)
            tmp.alpha_composite(bg)
            tmp.alpha_composite(fg)
            mask = Image.new("L", (260, 260), 0)
            ImageDraw.Draw(mask).ellipse((0, 0, 260, 260), fill=255)
            clipped = Image.new("RGBA", (260, 260))
            clipped.paste(tmp, (0, 0), mask)
            im.alpha_composite(clipped, (x + 20, 140))
        else:
            paste_fit(im, path, box, 20)
        text(d, (x + 150, 436), label, 16, DIM, True, "mt")
        x += 380
    # size row
    x = 48
    text(d, (48, 500), "SIZE LADDER", 16, DIM, True)
    for p in (16, 24, 32, 48, 64, 128, 180, 192, 256):
        ip = ICONS / f"png/icon-{p}.png"
        if not ip.exists():
            continue
        a = Image.open(ip).convert("RGBA")
        show = min(p, 160)
        if a.size != (show, show):
            a = a.resize((show, show), Image.LANCZOS)
        im.alpha_composite(a, (x, 700 - show))
        text(d, (x + show // 2, 720), str(p), 12, DIM, True, "mt")
        x += show + 24
    save(im, "sheet-01-icons.png")


def sheet_markers():
    data = json.loads((MARKERS / "markers.json").read_text())
    layers = data["layers"]
    groups = data["groups"]
    cols = 9
    cell = 140
    header = 110
    group_h = 200
    rows = (len(layers) + cols - 1) // cols
    w = 48 + cols * cell + 48
    h = header + group_h + rows * cell + 48
    im = canvas(w, h)
    d = ImageDraw.Draw(im)
    text(d, (48, 32), "SET 2  ·  LAYER MARKERS", 28, BLUE, True)
    text(d, (48, 68), f"{len(layers)} layer badges (CSS swatch colors)  ·  {len(groups)} group marks  ·  pin variants for point layers", 16, DIM)
    # groups
    gx = 48
    for g in groups:
        p = ROOT / g["png64"]
        a = Image.open(p).convert("RGBA").resize((64, 64), Image.LANCZOS)
        im.alpha_composite(a, (gx, 110))
        text(d, (gx + 32, 184), g["id"].replace("-", " ")[:14], 11, DIM, True, "mt")
        gx += 90
    y0 = header + group_h
    for i, layer in enumerate(layers):
        r, c = divmod(i, cols)
        x = 48 + c * cell
        y = y0 + r * cell
        d.rounded_rectangle((x, y, x + cell - 12, y + cell - 16), 12, fill=(16, 32, 44, 255))
        p = ROOT / layer["png64"]
        a = Image.open(p).convert("RGBA")
        im.alpha_composite(a, (x + (cell - 12 - 64) // 2, y + 12))
        text(d, (x + (cell - 12) // 2, y + 86), layer["id"], 12, INK, True, "mt")
    save(im, "sheet-02-markers.png")


def sheet_splash_store():
    im = canvas(1800, 1400)
    d = ImageDraw.Draw(im)
    text(d, (48, 32), "SETS 3 & 4  ·  SPLASH AND STORE / SOCIAL", 28, BLUE, True)
    text(d, (48, 68), "Static splash + boot poster  ·  OG, GitHub, social, README, F-Droid feature graphic  ·  screenshot frames", 16, DIM)
    tiles = [
        (SPLASH / "boot-poster-1280x720.png", "Boot poster 1280×720", (48, 110, 900, 520)),
        (SPLASH / "splash-landscape-1920x1080.png", "Splash landscape 1920×1080", (920, 110, 1752, 520)),
        (SPLASH / "splash-portrait-1080x1920.png", "Splash portrait 1080×1920", (48, 550, 400, 1180)),
        (STORE / "og-image-1200x630.png", "Open Graph 1200×630", (420, 550, 1100, 900)),
        (STORE / "feature-graphic-1024x500.png", "F-Droid / Play 1024×500", (1120, 550, 1752, 900)),
        (STORE / "github-social-1280x640.png", "GitHub social 1280×640", (420, 920, 1100, 1180)),
        (STORE / "social-card-1080x1080.png", "Social card 1080×1080", (1120, 920, 1400, 1180)),
        (STORE / "readme-banner-1280x320.png", "README banner 1280×320", (1420, 920, 1752, 1180)),
    ]
    for path, label, box in tiles:
        d.rounded_rectangle(box, 14, fill=(16, 32, 44, 255))
        paste_fit(im, path, box, 12)
        text(d, ((box[0] + box[2]) // 2, box[3] + 8), label, 13, DIM, True, "mt")
    # loading marks
    for i, name in enumerate(("loading-mark-128.png", "loading-mark-ring-128.png")):
        a = Image.open(SPLASH / name).convert("RGBA")
        im.alpha_composite(a, (48 + i * 150, 1220))
    text(d, (48, 1360), "Loading marks", 13, DIM, True)
    save(im, "sheet-03-splash-store.png")


def sheet_ui():
    im = canvas(1600, 900)
    d = ImageDraw.Draw(im)
    text(d, (48, 32), "SET 5  ·  EMPTY STATES AND BADGES", 28, BLUE, True)
    empties = [
        "empty-layer.png",
        "empty-search.png",
        "offline.png",
        "locating.png",
        "no-permission.png",
    ]
    x = 48
    for name in empties:
        box = (x, 100, x + 280, 400)
        d.rounded_rectangle(box, 14, fill=(16, 32, 44, 255))
        paste_fit(im, UI / "empty" / name, box, 8)
        text(d, (x + 140, 416), name.replace(".png", "").replace("-", " "), 13, DIM, True, "mt")
        x += 300
    # badges
    y = 480
    text(d, (48, y), "STATUS  ·  SEVERITY  ·  CAVEATS", 16, DIM, True)
    x = 48
    y = 520
    badge_dir = UI / "badges"
    files = sorted(p for p in badge_dir.glob("*.png") if not p.name.startswith("dot-"))
    for p in files:
        a = Image.open(p).convert("RGBA")
        if x + a.width + 16 > 1550:
            x = 48
            y += 50
        im.alpha_composite(a, (x, y))
        x += a.width + 16
    # frames thumbs
    y += 80
    text(d, (48, y), "SCREENSHOT FRAMES", 16, DIM, True)
    y += 30
    for i, name in enumerate(("frame-landscape-1920x1080.png", "frame-portrait-1080x1920.png")):
        box = (48 + i * 500, y, 48 + i * 500 + 480, y + 250) if i == 0 else (560, y, 720, y + 250)
        if i == 1:
            box = (560, y, 720, y + 250)
        d.rounded_rectangle(box, 12, fill=(16, 32, 44, 255))
        paste_fit(im, STORE / "frames" / name, box, 8)
    save(im, "sheet-04-ui.png")


def build():
    sheet_icons()
    sheet_markers()
    sheet_splash_store()
    sheet_ui()
    print("sheets ok")


if __name__ == "__main__":
    build()
