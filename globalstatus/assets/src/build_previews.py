import subprocess, json
from PIL import Image
from mark import *
from text2path import text_path
from paths import PREVIEW, ICONS, LOGO, ROOT as _ROOT
P=str(PREVIEW); B=str(_ROOT)
# icon family montage
im=Image.new("RGBA",(1600,700),"#1b2731")
items=[("icons/png/icon-1024.png",300),("icons/desktop/icon-macos-1024.png",300),("icons/pwa/icon-maskable-512.png",300),("icons/android/ic_launcher_foreground-432.png",300)]
x=40
for f,s in items:
    a=Image.open(f"{B}/{f}").convert("RGBA").resize((s,s),Image.LANCZOS)
    if "foreground" in f:
        bg=Image.open(f"{B}/icons/android/ic_launcher_background-432.png").convert("RGBA").resize((s,s)); 
        mask=Image.new("L",(s,s),0); from PIL import ImageDraw; ImageDraw.Draw(mask).ellipse((0,0,s,s),fill=255)
        bg.alpha_composite(a); a=Image.new("RGBA",(s,s)); a.paste(bg,(0,0),mask)
    im.alpha_composite(a,(x,40)); x+=s+70
x=40
for p in (16,24,32,48,64,128,180,256):
    a=Image.open(f"{B}/icons/png/icon-{p}.png").convert("RGBA"); im.alpha_composite(a,(x,660-p)); x+=p+36
im.convert("RGB").save(f"{P}/icon-family.png")
# logo sheet: dark & light horizontal + stacked + marks
def r(svgf,h,out): subprocess.run(["rsvg-convert","-h",str(h),f"{B}/logo/{svgf}","-o",out],check=True)
r("globalstatus-logo-horizontal-dark.svg",120,"/tmp/hd.png"); r("globalstatus-logo-horizontal-light.svg",120,"/tmp/hl.png")
r("globalstatus-logo-stacked-dark.svg",300,"/tmp/sd.png"); r("globalstatus-logo-stacked-light.svg",300,"/tmp/sl.png")
sheet=Image.new("RGB",(1600,900),"#ffffff"); sheet.paste(Image.new("RGB",(800,900),"#070b10"),(0,0))
for f,pos in (("/tmp/hd.png",(40,60)),("/tmp/hl.png",(840,60)),("/tmp/sd.png",(40,300)),("/tmp/sl.png",(840,300))):
    a=Image.open(f).convert("RGBA"); 
    if a.width>720: a=a.resize((720,int(a.height*720/a.width)),Image.LANCZOS)
    x=pos[0]+(720-a.width)//2; sheet.paste(a,(x,pos[1]),a)
for i,(f,bgc) in enumerate((("globalstatus-mark-dark.svg",None),("globalstatus-mark-mono-white.svg",None),("globalstatus-mark-light.svg",None),("globalstatus-mark-mono-black.svg",None))):
    r(f,120,"/tmp/mk.png"); a=Image.open("/tmp/mk.png").convert("RGBA")
    x=(120+i*200) if i<2 else (920+(i-2)*200); sheet.paste(a,(x,700),a)
sheet.save(f"{P}/logo-sheet.png")
print("ok")
