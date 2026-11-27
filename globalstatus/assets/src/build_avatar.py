import subprocess
from mark import *
from paths import AVATAR
A=str(AVATAR)
S=1024
def avatar(circle):
    defs='<defs><radialGradient id="g" cx="50%" cy="42%" r="62%"><stop offset="0" stop-color="#132634"/><stop offset="1" stop-color="#070b10"/></radialGradient>'
    defs+='<clipPath id="c"><circle cx="512" cy="512" r="512"/></clipPath></defs>' if circle else '</defs>'
    body = f'<g {"clip-path=\"url(#c)\"" if circle else ""}><rect width="{S}" height="{S}" fill="url(#g)"/>'
    # orbit ring + status satellite dot (signals "watching the world")
    body += '<circle cx="512" cy="512" r="400" fill="none" stroke="#7ec8ff" stroke-opacity="0.22" stroke-width="6" stroke-dasharray="2 22" stroke-linecap="round"/>'
    body += '<path d="M512 112 A400 400 0 0 1 858 312" fill="none" stroke="#7ec8ff" stroke-opacity="0.55" stroke-width="6" stroke-linecap="round"/>'
    body += '<circle cx="858" cy="312" r="22" fill="#3dff9a"/><circle cx="858" cy="312" r="40" fill="#3dff9a" fill-opacity="0.18"/>'
    ms=680; o=(S-ms)/2
    body += mark_group(DARK, True, o, o, ms/64) + '</g>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}">{defs}{body}</svg>\n'
for kind,circ in (("square",False),("circle",True)):
    f=f"{A}/worldstatus-avatar-{kind}.svg"; open(f,"w").write(avatar(circ))
    for px in (512,1024): subprocess.run(["rsvg-convert","-w",str(px),f,"-o",f"{A}/worldstatus-avatar-{kind}-{px}.png"],check=True)
print("ok")
