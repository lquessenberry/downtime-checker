import subprocess, math
from mark import *
from text2path import text_path, cap_height
from cats import CATS
from paths import STORE
M=str(STORE)
INK="#eef5f8"; DIM="#7f97a1"; BLUE="#7ec8ff"
def T(txt,key,size,x,y,fill,track=0.0,anchor="start"):
    d,w=text_path(txt,key,size,0,0,track)
    if anchor=="middle": x-=w/2
    elif anchor=="end": x-=w
    d,_=text_path(txt,key,size,x,y,track); return f'<path d="{d}" fill="{fill}"/>', w
def backdrop(W,H,gx,gy,gr):
    s=f'<defs><radialGradient id="bg" cx="{gx/W:.3f}" cy="{gy/H:.3f}" r="0.9"><stop offset="0" stop-color="#10202c"/><stop offset="0.55" stop-color="#0a1219"/><stop offset="1" stop-color="#070b10"/></radialGradient></defs>'
    s+=f'<rect width="{W}" height="{H}" fill="url(#bg)"/>'
    # big faint globe graticule
    s+=f'<g fill="none" stroke="#7ec8ff" stroke-opacity="0.10" stroke-width="1.5">'
    s+=f'<circle cx="{gx}" cy="{gy}" r="{gr}"/>'
    for f in (0.35,0.7):
        s+=f'<ellipse cx="{gx}" cy="{gy}" rx="{gr*f}" ry="{gr}"/>'
    for lat in (-60,-30,0,30,60):
        y=gy+gr*math.sin(math.radians(lat)); hw=gr*math.cos(math.radians(lat))
        s+=f'<line x1="{gx-hw:.1f}" y1="{y:.1f}" x2="{gx+hw:.1f}" y2="{y:.1f}"/>'
    s+='</g>'
    # a few status pins on the globe
    import random; random.seed(7)
    cols=[c[2] for c in CATS[:10]]
    for i in range(26):
        a=random.uniform(0,2*math.pi); r=gr*math.sqrt(random.uniform(0.02,0.92))
        x=gx+r*math.cos(a); y=gy+r*math.sin(a)
        s+=f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{random.choice([3,4,5])}" fill="{random.choice(cols)}" fill-opacity="0.85" stroke="#070b10" stroke-width="1.5"/>'
    return s
def lockup(x,y,h):  # horizontal logo at height h
    s=h/96; size=44*s; ch=cap_height("cond600",size); base=y+h/2+ch/2
    g=mark_group(DARK,True,x+8*s,y+8*s,80*s/64)
    p1,w1=T("GLOBAL","cond600",size,x+104*s,base,INK,0.04)
    p2,w2=T("STATUS","cond400",size,x+104*s+w1+size*0.28,base,BLUE,0.04)
    return g+p1+p2, 104*s+w1+size*0.28+w2
def chips(x,y,size=15):
    out="";cx=x
    for lab,col in (("UP","#3dff9a"),("DOWN","#ff4d4d"),("STALE","#9aa8b2"),("ALERT","#ffb020")):
        p,w=T(lab,"mono500",size,0,0,"#000",0.08); pw=w+size*2.4; h=size*1.9
        out+=f'<rect x="{cx}" y="{y}" width="{pw:.1f}" height="{h:.1f}" rx="{h/2:.1f}" fill="{col}" fill-opacity="0.12" stroke="{col}" stroke-opacity="0.6"/>'
        out+=f'<circle cx="{cx+size*0.95:.1f}" cy="{y+h/2:.1f}" r="{size*0.28:.1f}" fill="{col}"/>'
        p,_=T(lab,"mono500",size,cx+size*1.6,y+h/2+size*0.36,col,0.08); out+=p; cx+=pw+size*0.6
    return out, cx-size*0.6
def write(name,W,H,body):
    f=f"{M}/{name}.svg"; open(f,"w").write(svg(W,H,body))
    subprocess.run(["rsvg-convert","-w",str(W),"-h",str(H),f,"-o",f"{M}/{name}.png"],check=True)

HEAD="The state of the world,"; HEAD2="by the numbers."
SUB="Outages, conflicts, hazards and humanitarian crises on one live globe."
FOOT="FREE & OPEN SOURCE · WEB · ANDROID · LINUX · MACOS · WINDOWS"

# OG / social preview 1200x630
W,H=1200,630; b=backdrop(W,H,960,330,300)
l,_=lockup(64,60,72); b+=l
b+=T(HEAD,"cond600",64,72,262,INK)[0]+T(HEAD2,"cond600",64,72,336,BLUE)[0]
b+=T(SUB,"cond400",26,72,396,DIM)[0]
b+=chips(72,440)[0]
b+=T("globalstatus.app","mono500",22,72,568,INK,0.02)[0]+T(FOOT,"mono400",13,1136,568,DIM,0.1,"end")[0]
write("og-image-1200x630",W,H,b)
# GitHub social preview 1280x640
W,H=1280,640; b=backdrop(W,H,1020,330,310)
l,_=lockup(72,64,76); b+=l
b+=T(HEAD,"cond600",68,80,272,INK)[0]+T(HEAD2,"cond600",68,80,350,BLUE)[0]
b+=T(SUB,"cond400",27,80,412,DIM)[0]+chips(80,456)[0]
b+=T("github.com/lquessenberry/downtime-checker","mono500",20,80,580,INK,0.02)[0]
write("github-social-1280x640",W,H,b)
# Square social card 1080x1080
W,H=1080,1080; b=backdrop(W,H,540,600,380)
b+=f'<rect x="0" y="0" width="{W}" height="{H}" fill="#070b10" fill-opacity="0.35"/>'
l,lw=lockup(0,0,80); b+=f'<g transform="translate({(W-lw)/2:.1f} 72)">{l}</g>'
b+=T(HEAD,"cond600",76,540,420,INK,0,"middle")[0]+T(HEAD2,"cond600",76,540,508,BLUE,0,"middle")[0]
b+=T(SUB,"cond400",30,540,580,DIM,0,"middle")[0]
co,cw=chips(0,0,17); b+=f'<g transform="translate({(W-cw)/2:.1f} 640)">{co}</g>'
b+=T("globalstatus.app","mono500",30,540,960,INK,0.02,"middle")[0]+T(FOOT,"mono400",14,540,1004,DIM,0.1,"middle")[0]
write("social-card-1080x1080",W,H,b)
# README banner 1280x320
W,H=1280,320; b=backdrop(W,H,1100,160,230)
l,_=lockup(56,56,96); b+=l
b+=T("The state of the world, by the numbers. Free and open source, forever.","cond400",28,66,222,DIM)[0]
b+=f'<g transform="translate(66 250)">{chips(0,0,13)[0]}</g>'
write("readme-banner-1280x320",W,H,b)
# F-Droid / Play feature graphic 1024x500
W,H=1024,500; b=backdrop(W,H,820,250,250)
l,_=lockup(56,90,84); b+=l
b+=T(HEAD,"cond600",48,64,290,INK)[0]+T(HEAD2,"cond600",48,64,346,BLUE)[0]
b+=T("Free, open-source world-status globe.","cond400",24,64,400,DIM)[0]
write("feature-graphic-1024x500",W,H,b)
print("ok")
