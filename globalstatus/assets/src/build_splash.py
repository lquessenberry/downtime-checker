#!/usr/bin/env python3
"""Static splash / loading screens. The live site still uses start-satellite.mp4;
these are the poster, PWA/Android fallbacks, and a loading mark."""
from mark import mark_group, DARK, svg
from text2path import text_path, cap_height
from paths import SPLASH
from raster import raster
from build_marketing import backdrop, lockup, T, INK, DIM, BLUE, HEAD, HEAD2, SUB

SPLASH.mkdir(parents=True, exist_ok=True)


def compose_portrait(W, H):
    # Globe sits in the upper two-thirds; lockup and copy in the lower third.
    gx, gy, gr = W * 0.5, H * 0.38, min(W, H) * 0.42
    b = backdrop(W, H, gx, gy, gr)
    # Centered lockup
    l, lw = lockup(0, 0, int(W * 0.14))
    ly = int(H * 0.68)
    b += f'<g transform="translate({(W-lw)/2:.1f} {ly})">{l}</g>'
    by = ly + int(W * 0.14) + int(H * 0.03)
    b += T(HEAD, "cond600", int(W * 0.055), W / 2, by, INK, 0, "middle")[0]
    b += T(HEAD2, "cond600", int(W * 0.055), W / 2, by + int(W * 0.07), BLUE, 0, "middle")[0]
    b += T(SUB, "cond400", int(W * 0.028), W / 2, by + int(W * 0.13), DIM, 0, "middle")[0]
    b += T("globalstatus.app", "mono500", int(W * 0.028), W / 2, H - int(H * 0.06), INK, 0.02, "middle")[0]
    return b


def compose_landscape(W, H):
    gx, gy, gr = W * 0.72, H * 0.5, H * 0.48
    b = backdrop(W, H, gx, gy, gr)
    l, _ = lockup(int(W * 0.06), int(H * 0.14), int(H * 0.18))
    b += l
    b += T(HEAD, "cond600", int(H * 0.11), int(W * 0.065), int(H * 0.52), INK)[0]
    b += T(HEAD2, "cond600", int(H * 0.11), int(W * 0.065), int(H * 0.64), BLUE)[0]
    b += T(SUB, "cond400", int(H * 0.042), int(W * 0.065), int(H * 0.75), DIM)[0]
    b += T("globalstatus.app", "mono500", int(H * 0.036), int(W * 0.065), int(H * 0.88), INK, 0.02)[0]
    return b


def write(name, W, H, body):
    path = SPLASH / f"{name}.svg"
    path.write_text(svg(W, H, body))
    raster(path, SPLASH / f"{name}.png", W, H)
    print(" ", name, W, H)


def build():
    write("splash-portrait-1080x1920", 1080, 1920, compose_portrait(1080, 1920))
    write("splash-portrait-1290x2796", 1290, 2796, compose_portrait(1290, 2796))
    write("splash-landscape-1920x1080", 1920, 1080, compose_landscape(1920, 1080))
    write("boot-poster-1280x720", 1280, 720, compose_landscape(1280, 720))
    # Android 9:16 uses the same portrait composition.
    # Loading mark: just the globe + pulse, transparent, for an in-app spinner.
    mark = svg(128, 128, mark_group(DARK, True, 0, 0, 2.0))
    (SPLASH / "loading-mark.svg").write_text(mark)
    raster(SPLASH / "loading-mark.svg", SPLASH / "loading-mark-128.png", 128, 128)
    raster(SPLASH / "loading-mark.svg", SPLASH / "loading-mark-256.png", 256, 256)
    # Subtle pulse ring companion (static; motion is left to CSS).
    pulse = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">'
        '<circle cx="64" cy="64" r="58" fill="none" stroke="#7ec8ff" stroke-opacity="0.28" stroke-width="3"/>'
        + mark_group(DARK, True, 16, 16, 1.5)
        + "</svg>\n"
    )
    (SPLASH / "loading-mark-ring.svg").write_text(pulse)
    raster(SPLASH / "loading-mark-ring.svg", SPLASH / "loading-mark-ring-128.png", 128, 128)
    print("splash ok")


if __name__ == "__main__":
    build()
