# Tagline-free variants for repo/F-Droid use until the tagline is approved.
import subprocess
import build_marketing as bm  # re-renders the originals too (same output)
from build_marketing import T, backdrop, lockup, chips, svg, INK, DIM, BLUE, SUB
import os
from paths import STORE
M=str(STORE / "notagline"); os.makedirs(M,exist_ok=True)
def write(name,W,H,body):
    f=f"{M}/{name}.svg"; open(f,"w").write(svg(W,H,body))
    subprocess.run(["rsvg-convert","-w",str(W),"-h",str(H),f,"-o",f"{M}/{name}.png"],check=True)
# README banner 1280x320
W,H=1280,320; b=backdrop(W,H,1100,160,230)
l,_=lockup(56,56,96); b+=l
b+=T(SUB,"cond400",28,66,222,DIM)[0]
b+=f'<g transform="translate(66 250)">{chips(0,0,13)[0]}</g>'
write("readme-banner-1280x320",W,H,b)
# GitHub social preview 1280x640
W,H=1280,640; b=backdrop(W,H,1020,330,310)
l,_=lockup(72,150,120); b+=l
b+=T(SUB,"cond400",30,84,370,DIM)[0]+chips(84,420)[0]
b+=T("github.com/lquessenberry/downtime-checker","mono500",20,84,580,INK,0.02)[0]
write("github-social-1280x640",W,H,b)
# F-Droid feature graphic 1024x500
W,H=1024,500; b=backdrop(W,H,820,250,250)
l,_=lockup(56,130,110); b+=l
b+=T("Outages, conflicts, hazards and","cond400",30,64,320,INK)[0]
b+=T("humanitarian crises on one live globe.","cond400",30,64,362,INK)[0]
b+=T("Free and open source.","cond400",24,64,420,DIM)[0]
write("feature-graphic-1024x500",W,H,b)
print("notagline ok")
