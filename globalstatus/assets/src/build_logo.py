from paths import LOGO
from mark import *
from text2path import text_path, cap_height
OUT = str(LOGO)
INK_D, INK_L = "#eef5f8", "#0b1620"
SUB_D, SUB_L = "#7ec8ff", "#0b5fa5"

def wordmark(ink, accent, x, base, size, two_tone=True):
    d1, w1 = text_path("GLOBAL", "cond600", size, x, base, tracking=0.04)
    gap = size*0.28
    d2, w2 = text_path("STATUS", "cond400", size, x+w1+gap, base, tracking=0.04)
    p = f'<path d="{d1}" fill="{ink}"/><path d="{d2}" fill="{accent if two_tone else ink}"/>'
    return p, w1+gap+w2

def horizontal(theme):
    c = DARK if theme=="dark" else LIGHT
    ink, acc = (INK_D, SUB_D) if theme=="dark" else (INK_L, SUB_L)
    H = 96; m = 64/64*1.0
    size = 44; ch = cap_height("cond600", size)
    base = H/2 + ch/2
    wm, ww = wordmark(ink, acc, 96+8, base, size)
    W = int(96+8+ww+16)
    body = mark_group(c, True, 8, 8, 80/64) + wm
    return W, H, body

def stacked(theme):
    c = DARK if theme=="dark" else LIGHT
    ink, acc = (INK_D, SUB_D) if theme=="dark" else (INK_L, SUB_L)
    size = 40
    wm_probe, ww = wordmark(ink, acc, 0, 0, size)
    W = int(max(ww, 160) + 48); x = (W-ww)/2
    ms = 128; mx = (W-ms)/2
    base = 24+ms+24+cap_height("cond600", size)
    wm, _ = wordmark(ink, acc, x, base, size)
    td, tw = text_path("WORLD STATUS · BY THE NUMBERS", "mono500", 11.5, 0, 0, tracking=0.12)
    tx = (W-tw)/2; tb = base+30
    td, _ = text_path("WORLD STATUS · BY THE NUMBERS", "mono500", 11.5, tx, tb, tracking=0.12)
    H = int(tb+24)
    body = mark_group(c, True, mx, 24, ms/64) + wm + f'<path d="{td}" fill="{"#7f97a1" if theme=="dark" else "#4a5f6b"}"/>'
    return W, H, body

def wordmark_only(theme):
    ink, acc = (INK_D, SUB_D) if theme=="dark" else (INK_L, SUB_L)
    size=48; ch=cap_height("cond600", size)
    wm, ww = wordmark(ink, acc, 12, 12+ch, size)
    return int(ww+24), int(ch+24), wm

BG = {"dark":"#070b10","light":"#ffffff"}
for theme in ("dark","light"):
    for name, fn in (("horizontal",horizontal),("stacked",stacked),("wordmark",wordmark_only)):
        W,H,body = fn(theme)
        open(f"{OUT}/globalstatus-logo-{name}-{theme}.svg","w").write(svg(W,H,body))          # transparent
        open(f"{OUT}/globalstatus-logo-{name}-{theme}-bg.svg","w").write(svg(W,H,body,bg=BG[theme]))
    c = DARK if theme=="dark" else LIGHT
    open(f"{OUT}/globalstatus-mark-{theme}.svg","w").write(svg(64,64,mark_group(c)))
open(f"{OUT}/globalstatus-mark-mono-white.svg","w").write(svg(64,64,mark_group(MONO_W)))
open(f"{OUT}/globalstatus-mark-mono-black.svg","w").write(svg(64,64,mark_group(MONO_K)))
open(f"{OUT}/globalstatus-mark-small-dark.svg","w").write(svg(64,64,mark_group(DARK,False)))
print("ok")
