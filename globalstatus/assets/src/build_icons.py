import os, subprocess
from mark import *
from PIL import Image
from paths import ICONS
B = str(ICONS)
for d in ("png","android","android/mipmap","desktop","desktop/GlobalStatus.iconset","pwa","fdroid"): os.makedirs(f"{B}/{d}", exist_ok=True)
GRAD = '<defs><radialGradient id="g" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="#11202c"/><stop offset="1" stop-color="#070b10"/></radialGradient></defs>'
def icon(size=1024, rx_frac=0.2227, mark_frac=0.64, detail=True, inset=0.0, bg_fill="url(#g)"):
    S=1024; ins=S*inset; w=S-2*ins
    bg = f'<rect x="{ins}" y="{ins}" width="{w}" height="{w}" rx="{w*rx_frac}" fill="{bg_fill}"/>'
    if inset: bg += f'<rect x="{ins}" y="{ins}" width="{w}" height="{w}" rx="{w*rx_frac}" fill="none" stroke="#7ec8ff" stroke-opacity="0.18" stroke-width="4"/>'
    ms = w*mark_frac; o = (S-ms)/2
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}">{GRAD}{bg}{mark_group(DARK, detail, o, o, ms/64)}</svg>\n'
def W(name, s): open(f"{B}/{name}","w").write(s)
def R(svgf, px, out): subprocess.run(["rsvg-convert","-w",str(px),"-h",str(px),f"{B}/{svgf}","-o",f"{B}/{out}"],check=True)

W("icon-master.svg", icon())                                  # rounded, general purpose
W("icon-small.svg", icon(mark_frac=0.86, rx_frac=0.18, detail=False))  # <=32 px: heavier, no meridian
W("icon-fullbleed.svg", icon(rx_frac=0))                       # square, for stores / tiles
W("pwa/icon-maskable.svg", icon(rx_frac=0, mark_frac=0.52))     # mark inside 80% safe circle
W("desktop/icon-macos.svg", icon(inset=100/1024, rx_frac=0.2237, mark_frac=0.64))  # Apple 824 grid
# Android adaptive (108dp canvas, 66dp safe zone): foreground transparent, background separate
S=1024; ms=S*58/108; o=(S-ms)/2
W("android/ic_launcher_foreground.svg", f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}">{mark_group(DARK,True,o,o,ms/64)}</svg>\n')
W("android/ic_launcher_background.svg", f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}">{GRAD}<rect width="{S}" height="{S}" fill="url(#g)"/></svg>\n')
W("android/ic_launcher_monochrome.svg", f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}">{mark_group(MONO_W,True,o,o,ms/64)}</svg>\n')

for px in (16,24,32,48,64,128,180,192,256,512,1024):
    R("icon-small.svg" if px<=32 else "icon-master.svg", px, f"png/icon-{px}.png")
for px in (192,512): R("pwa/icon-maskable.svg", px, f"pwa/icon-maskable-{px}.png")
R("icon-fullbleed.svg", 180, "pwa/apple-touch-icon.png")
R("icon-fullbleed.svg", 512, "png/icon-fullbleed-512.png")
for part in ("foreground","background","monochrome"): R(f"android/ic_launcher_{part}.svg", 432, f"android/ic_launcher_{part}-432.png")
dens = {"mdpi":48,"hdpi":72,"xhdpi":96,"xxhdpi":144,"xxxhdpi":192}
for d,px in dens.items():
    os.makedirs(f"{B}/android/mipmap/mipmap-{d}",exist_ok=True)
    R("icon-master.svg", px, f"android/mipmap/mipmap-{d}/ic_launcher.png")
R("icon-fullbleed.svg", 512, "android/play-store-512.png")
W("android/mipmap/mipmap-anydpi-v26-ic_launcher.xml", '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n  <background android:drawable="@mipmap/ic_launcher_background"/>\n  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n  <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>\n</adaptive-icon>\n')
# macOS iconset + icns
os.makedirs(f"{B}/desktop/GlobalStatus.iconset",exist_ok=True)
for base in (16,32,128,256,512):
    for sc in (1,2):
        px=base*sc; nm=f"icon_{base}x{base}{'@2x' if sc==2 else ''}.png"
        R("desktop/icon-macos.svg" if px>32 else "icon-small.svg", px, f"desktop/GlobalStatus.iconset/{nm}")
R("desktop/icon-macos.svg",1024,"desktop/icon-macos-1024.png")
Image.open(f"{B}/desktop/icon-macos-1024.png").save(f"{B}/desktop/GlobalStatus.icns")
# Windows ico + tiles
imgs=[Image.open(f"{B}/png/icon-{p}.png") for p in (256,)]
Image.open(f"{B}/png/icon-256.png").save(f"{B}/desktop/globalstatus.ico", sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
# Use the small-mark artwork for the tiny ico frames
small = {p: Image.open(f"{B}/png/icon-{p}.png") for p in (16,24,32,48,64,128,256)}
small[256].save(f"{B}/desktop/globalstatus.ico", format="ICO", sizes=[(p,p) for p in small], append_images=[small[p] for p in (16,24,32,48,64,128)])
for px,nm in ((44,"Square44x44Logo"),(150,"Square150x150Logo"),(310,"Square310x310Logo")):
    R("icon-fullbleed.svg", px, f"desktop/{nm}.png")
R("icon-small.svg", 32, "favicon-32.png"); W("favicon.svg", icon(mark_frac=0.86, rx_frac=0.18, detail=False))
Image.open(f"{B}/png/icon-32.png").save(f"{B}/favicon.ico", sizes=[(16,16),(32,32)], append_images=[Image.open(f"{B}/png/icon-16.png")])
R("icon-master.svg", 256, "desktop/appimage-256.png")
R("icon-master.svg", 512, "desktop/appimage-512.png")
R("icon-fullbleed.svg", 512, "fdroid/icon-512.png")
print("icons ok")

