import json, subprocess, math
from text2path import text_path
from paths import TOKENS_DIST, PREVIEW
tok=json.load(open(TOKENS_DIST / "tokens.flat.json"))
def T(t,x,y,fill="#d7e6ea",size=14,key="mono400",anchor="start",track=0.04):
    d,w=text_path(t,key,size,0,0,track); x = x-w/2 if anchor=="middle" else x
    d,_=text_path(t,key,size,x,y,track); return f'<path d="{d}" fill="{fill}"/>'
W,H=1400,640
s=f'<rect width="{W}" height="{H}" fill="#070b10"/><rect x="20" y="20" width="660" height="600" rx="10" fill="#10202c"/><rect x="720" y="20" width="660" height="600" rx="10" fill="#10202c"/>'
s+=T("PINS & STATES",44,60,"#7f97a1",12,"mono500",track=0.12)
O=tok["color.map.pinOutline"]
rows=[("Default pin · 12px",lambda x,y:f'<circle cx="{x}" cy="{y}" r="6" fill="{tok["color.layer.conflict"]}" stroke="{O}" stroke-width="1.5"/>'),
("Selected · 3px Signal Blue halo",lambda x,y:f'<circle cx="{x}" cy="{y}" r="11" fill="none" stroke="#7ec8ff" stroke-width="3"/><circle cx="{x}" cy="{y}" r="6" fill="{tok["color.layer.disease"]}" stroke="{O}" stroke-width="1.5"/>'),
("Stale · hollow, dashed, 45% opacity",lambda x,y:f'<circle cx="{x}" cy="{y}" r="6" fill="none" stroke="{tok["color.layer.natural"]}" stroke-width="2" stroke-dasharray="3 2" opacity="0.45"/>'),
("Emergency (7700) · 10px + pulse ring",lambda x,y:f'<circle cx="{x}" cy="{y}" r="13" fill="none" stroke="#ff5c5c" stroke-opacity="0.35" stroke-width="2"/><circle cx="{x}" cy="{y}" r="5" fill="#ff5c5c" stroke="#3a0810" stroke-width="1.5"/>'),
("Cluster · 32px, count in mono",lambda x,y:f'<circle cx="{x}" cy="{y}" r="16" fill="#143044" stroke="#7ec8ff" stroke-width="1.5"/>'+T("128",x,y+5,"#eef5f8",13,"mono500","middle",0)),
("Site UP / DOWN / pending",lambda x,y:f'<circle cx="{x-22}" cy="{y}" r="6" fill="#3dff9a" stroke="{O}" stroke-width="1.5"/><circle cx="{x}" cy="{y}" r="6" fill="#ff4d4d" stroke="{O}" stroke-width="1.5"/><circle cx="{x+22}" cy="{y}" r="6" fill="#ffb020" stroke="{O}" stroke-width="1.5"/>'),
("Link-only layer · ring + arrow, no points",lambda x,y:f'<circle cx="{x}" cy="{y}" r="8" fill="none" stroke="{tok["color.layer.registries"]}" stroke-width="2"/><path d="M{x-3} {y+3} L{x+4} {y-4} M{x} {y-4} H{x+4} V{y}" stroke="{tok["color.layer.registries"]}" stroke-width="1.8" fill="none" stroke-linecap="round"/>')]
for i,(lab,fn) in enumerate(rows):
    y=110+i*72; s+=fn(110,y)+T(lab,170,y+5,"#d7e6ea",15,"mono400")
# nuke rings
s+=T("NUCLEAR EFFECTS RINGS · 1 MT AIRBURST (EFFECTS-RADIUS CHECK VALUES)",744,60,"#7f97a1",12,"mono500",track=0.12)
cx,cy=930,330; sc=205/21.7
rings=[("blast1psi",21.7,False),("thermal1",None,True),("blast5psi",7.0,False),("blast20psi",2.8,False),("fireball",0.9,False)]
for key,rk,dash in (("blast1psi",21.7,False),("blast5psi",7.0,False),("blast20psi",2.8,False),("fireball",1.0,False)):
    c=tok[f"color.map.nuke.{key}"]; r=rk*sc
    s+=f'<circle cx="{cx}" cy="{cy}" r="{r:.1f}" fill="{c}" fill-opacity="0.18" stroke="{c}" stroke-width="2"/>'
s+=f'<circle cx="{cx}" cy="{cy}" r="{11.8*sc:.1f}" fill="none" stroke="{tok["color.map.nuke.thermal3"]}" stroke-width="2" stroke-dasharray="6 5"/>'
s+=f'<circle cx="{cx}" cy="{cy}" r="3" fill="#eef5f8"/>'
leg=[("fireball","Fireball"),("blast20psi","Blast 20 psi"),("blast5psi","Blast 5 psi"),("thermal3","Thermal 3rd-degree"),("blast1psi","Blast 1 psi"),("radiation500rem","Prompt radiation 500 rem"),("crater","Crater (ground burst)")]
for i,(k,l) in enumerate(leg):
    y=380+i*30; c=tok[f"color.map.nuke.{k}"]
    s+=f'<rect x="1180" y="{y-12}" width="16" height="16" rx="3" fill="{c}" fill-opacity="0.35" stroke="{c}" stroke-width="2"/>'+T(l,1204,y+1,"#d7e6ea",11,"mono400",track=0)
s+=T("Blast radii 2.8 / 7.0 / 21.7 km match the calculator check values; thermal ring illustrative.",744,600,"#7f97a1",11,"mono400",track=0)
open(PREVIEW / "map-conventions.svg","w").write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">{s}</svg>')
subprocess.run(["rsvg-convert",str(PREVIEW / "map-conventions.svg"),"-o",str(PREVIEW / "map-conventions.png")],check=True)
