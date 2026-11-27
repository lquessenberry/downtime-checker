from paths import TOKENS
import json, colorsys
from contrast import ratio
def darken(h, target=4.5, bg="#ffffff"):
    r,g,b=[int(h[i:i+2],16)/255 for i in (1,3,5)]; hh,l,ss=colorsys.rgb_to_hls(r,g,b)
    while l>0:
        rr,gg,bb=colorsys.hls_to_rgb(hh,l,ss); out="#%02x%02x%02x"%tuple(round(x*255) for x in (rr,gg,bb))
        if ratio(out,bg)>=target: return out
        l-=0.005
    return "#000000"
from cats import CATS
def c(v, d=None):
    t={"$type":"color","$value":v}
    if d: t["$description"]=d
    return t
def dim(v): return {"$type":"dimension","$value":v}
def num(v): return {"$type":"number","$value":v}
def dur(v): return {"$type":"duration","$value":v}
T = {
 "$description": "Global Status (globalstatus.app) design tokens, W3C DTCG format. Source of truth; run build_tokens.py.",
 "color": {
  "base": {
   "night": {"950":c("#070b10","App/scene background (kept from manifest + Cesium scene)"),"900":c("#0b121a"),"850":c("#10202c","Globe base color with imagery (kept)"),"800":c("#143044","Globe base color, no imagery (kept)"),"700":c("#1f3a4f"),"600":c("#2c4a60")},
   "mist": {"50":c("#f4f7f9"),"100":c("#eef5f8"),"200":c("#d7e6ea","Primary text on dark (kept)"),"400":c("#9aa8b2"),"500":c("#7f97a1","Dim text (kept)"),"600":c("#738b96"),"700":c("#4a5f6b"),"800":c("#2a3a44")},
   "signal": {"300":c("#a9dbff"),"400":c("#7ec8ff","Signal Blue: brand primary (kept from favicon + ADS-B layer)"),"600":c("#2f86d1"),"700":c("#0b5fa5","Signal Blue for light backgrounds")},
   "pulse": {"400":c("#3dff9a","Pulse Green: UP / live (kept)"),"700":c("#0a7a47","Pulse Green for light backgrounds")},
   "alarm": {"400":c("#ff4d4d","DOWN (kept)"),"700":c("#c42b2b")},
   "amber": {"400":c("#ffb020","Pending / moderate (kept)"),"700":c("#8a5a00")},
   "ember": {"400":c("#ff7a3a","Severe (kept from GPS-jamming layer)"),"700":c("#b0420a")},
   "lime":  {"400":c("#d4e06a","Minor"),"700":c("#5c6600")},
   "white": c("#ffffff"), "black": c("#000000")
  },
  "dark": {
   "bg":{"canvas":c("{color.base.night.950}"),"surface":c("{color.base.night.900}"),"raised":c("{color.base.night.850}"),"panel":c("rgba(8, 14, 20, 0.88)","HUD panel over the globe (kept)"),"overlay":c("rgba(7, 11, 16, 0.72)")},
   "text":{"primary":c("{color.base.mist.200}"),"strong":c("{color.base.mist.100}"),"secondary":c("{color.base.mist.500}"),"tertiary":c("{color.base.mist.600}"),"link":c("{color.base.signal.400}"),"onFill":c("{color.base.night.950}")},
   "border":{"subtle":c("rgba(120, 190, 210, 0.16)"),"default":c("rgba(120, 190, 210, 0.28)","Kept --line"),"strong":c("#9fd4e2","Hover border (kept)"),"focus":c("{color.base.signal.400}")},
   "brand":{"primary":c("{color.base.signal.400}"),"pulse":c("{color.base.pulse.400}")}
  },
  "light": {
   "bg":{"canvas":c("{color.base.mist.50}"),"surface":c("{color.base.white}"),"raised":c("{color.base.white}"),"panel":c("rgba(255, 255, 255, 0.92)"),"overlay":c("rgba(11, 22, 32, 0.48)")},
   "text":{"primary":c("#0b1620"),"strong":c("#000000"),"secondary":c("{color.base.mist.700}"),"tertiary":c("#5c6f7a"),"link":c("{color.base.signal.700}"),"onFill":c("{color.base.white}")},
   "border":{"subtle":c("rgba(11, 22, 32, 0.08)"),"default":c("rgba(11, 22, 32, 0.16)"),"strong":c("rgba(11, 22, 32, 0.36)"),"focus":c("{color.base.signal.700}")},
   "brand":{"primary":c("{color.base.signal.700}"),"pulse":c("{color.base.pulse.700}")}
  },
  "status": {
   "dark":{"up":c("{color.base.pulse.400}"),"down":c("{color.base.alarm.400}"),"pending":c("{color.base.amber.400}"),"stale":c("{color.base.mist.400}","Data older than its cadence allows; always pair with an as-of time + dashed/hollow mark"),"unknown":c("{color.base.mist.500}")},
   "light":{"up":c("{color.base.pulse.700}"),"down":c("{color.base.alarm.700}"),"pending":c("{color.base.amber.700}"),"stale":c("#5f6e78"),"unknown":c("{color.base.mist.700}")}
  },
  "severity": {
   "$description":"Aligned to CAP severity (Extreme/Severe/Moderate/Minor) + Info. Never color-only: pair with label + icon.",
   "dark":{"extreme":c("{color.base.alarm.400}"),"severe":c("{color.base.ember.400}"),"moderate":c("{color.base.amber.400}"),"minor":c("{color.base.lime.400}"),"info":c("{color.base.signal.400}")},
   "light":{"extreme":c("{color.base.alarm.700}"),"severe":c("{color.base.ember.700}"),"moderate":c("{color.base.amber.700}"),"minor":c("{color.base.lime.700}"),"info":c("{color.base.signal.700}")}
  },
  "layer": {k:c(v, f"{label}. Glyph: {g}") for k,label,v,g in CATS},
  "layerOnLight": {k:c(darken(v), f"{label} on light basemaps/backgrounds (auto-darkened to 4.5:1 on white)") for k,label,v,g in CATS},
  "map": {
   "scene":c("{color.base.night.950}"),"globeBase":c("{color.base.night.850}"),"globeBaseNoImagery":c("{color.base.night.800}"),
   "pinOutline":c("#2a2e3c","Kept MARKER_OUTLINE"),"selectionHalo":c("{color.base.signal.400}"),"emergencyAircraft":c("#ff5c5c","Squawk 7700 (kept)"),"militaryAircraft":c("{color.base.lime.400}"),
   "nuke":{
    "$description":"Nuclear effects rings (Will's calculator: AEC 1963 Nuclear Bomb Effects Computer + Glasstone & Dolan). Fill uses map.ringFillOpacity.",
    "fireball":c("#fff1b8"),"crater":c("#7a5230"),"radiation500rem":c("#9cff57"),"blast20psi":c("#ff3b3b"),"blast5psi":c("#ff7a3a"),"blast1psi":c("#b8c4cc"),"thermal3":c("#ffb020"),"thermal2":c("#ffd166"),"thermal1":c("#ffe9a8")
   }
  }
 },
 "font": {
  "family":{"display":{"$type":"fontFamily","$value":["IBM Plex Sans Condensed","IBM Plex Sans","Arial Narrow","sans-serif"]},
            "sans":{"$type":"fontFamily","$value":["IBM Plex Sans","system-ui","Segoe UI","Roboto","sans-serif"]},
            "mono":{"$type":"fontFamily","$value":["IBM Plex Mono","ui-monospace","SFMono-Regular","Menlo","monospace"]},
            "serif":{"$type":"fontFamily","$value":["IBM Plex Serif","Georgia","serif"]}},
  "weight":{"regular":{"$type":"fontWeight","$value":400},"medium":{"$type":"fontWeight","$value":500},"semibold":{"$type":"fontWeight","$value":600},"bold":{"$type":"fontWeight","$value":700}},
  "size":{k:dim(v) for k,v in {"2xs":"10px","xs":"11px","sm":"12px","md":"14px","base":"16px","lg":"18px","xl":"20px","2xl":"24px","3xl":"30px","4xl":"36px","5xl":"48px","6xl":"60px"}.items()},
  "lineHeight":{"tight":num(1.1),"snug":num(1.25),"normal":num(1.5)},
  "tracking":{"tight":dim("-0.01em"),"normal":dim("0em"),"wide":dim("0.04em"),"caps":dim("0.08em"),"hud":dim("0.12em")}
 },
 "typography": {
  "display":{"$type":"typography","$value":{"fontFamily":"{font.family.display}","fontWeight":600,"fontSize":"48px","lineHeight":1.1,"letterSpacing":"0.02em"}},
  "h1":{"$type":"typography","$value":{"fontFamily":"{font.family.sans}","fontWeight":600,"fontSize":"30px","lineHeight":1.25,"letterSpacing":"-0.01em"}},
  "h2":{"$type":"typography","$value":{"fontFamily":"{font.family.sans}","fontWeight":600,"fontSize":"20px","lineHeight":1.25,"letterSpacing":"0em"}},
  "body":{"$type":"typography","$value":{"fontFamily":"{font.family.sans}","fontWeight":400,"fontSize":"16px","lineHeight":1.5,"letterSpacing":"0em"}},
  "ui":{"$type":"typography","$value":{"fontFamily":"{font.family.sans}","fontWeight":500,"fontSize":"14px","lineHeight":1.25,"letterSpacing":"0em"}},
  "hudLabel":{"$type":"typography","$value":{"fontFamily":"{font.family.mono}","fontWeight":500,"fontSize":"10px","lineHeight":1.25,"letterSpacing":"0.12em"}},
  "metric":{"$type":"typography","$value":{"fontFamily":"{font.family.mono}","fontWeight":600,"fontSize":"24px","lineHeight":1.1,"letterSpacing":"0em"}},
  "data":{"$type":"typography","$value":{"fontFamily":"{font.family.mono}","fontWeight":400,"fontSize":"12px","lineHeight":1.5,"letterSpacing":"0em"}}
 },
 "space":{k:dim(v) for k,v in {"0":"0px","0_5":"2px","1":"4px","2":"8px","3":"12px","4":"16px","5":"20px","6":"24px","8":"32px","10":"40px","12":"48px","16":"64px","24":"96px"}.items()},
 "radius":{k:dim(v) for k,v in {"none":"0px","xs":"2px","sm":"4px","md":"6px","lg":"10px","xl":"16px","icon":"22.37%","pill":"9999px"}.items()},
 "elevation":{
  "0":{"$type":"shadow","$value":{"color":"#00000000","offsetX":"0px","offsetY":"0px","blur":"0px","spread":"0px"}},
  "1":{"$type":"shadow","$value":{"color":"#00000066","offsetX":"0px","offsetY":"1px","blur":"2px","spread":"0px"}},
  "2":{"$type":"shadow","$value":{"color":"#00000080","offsetX":"0px","offsetY":"4px","blur":"12px","spread":"0px"}},
  "3":{"$type":"shadow","$value":{"color":"#00000099","offsetX":"0px","offsetY":"12px","blur":"32px","spread":"0px"}},
  "glowUp":{"$type":"shadow","$value":{"color":"#3dff9a26","offsetX":"0px","offsetY":"0px","blur":"0px","spread":"4px"},"$description":"Live pulse-dot halo (kept)"},
  "glowDown":{"$type":"shadow","$value":{"color":"#ff4d4d2e","offsetX":"0px","offsetY":"0px","blur":"0px","spread":"4px"}}
 },
 "motion":{
  "duration":{"instant":dur("0ms"),"fast":dur("120ms"),"base":dur("200ms"),"slow":dur("320ms"),"camera":dur("1500ms"),"pulse":dur("1600ms")},
  "easing":{"standard":{"$type":"cubicBezier","$value":[0.2,0,0,1]},"enter":{"$type":"cubicBezier","$value":[0,0,0,1]},"exit":{"$type":"cubicBezier","$value":[0.3,0,1,1]},"linear":{"$type":"cubicBezier","$value":[0,0,1,1]}},
  "$description":"Honor prefers-reduced-motion: no pulse, camera flights become cuts."
 },
 "map":{
  "pin":{"xs":dim("5px"),"sm":dim("8px"),"md":dim("12px"),"lg":dim("18px"),"xl":dim("24px"),"emergency":dim("10px")},
  "pinOutlineWidth":dim("1.5px"),"selectionHaloWidth":dim("3px"),
  "cluster":{"sm":dim("24px"),"md":dim("32px"),"lg":dim("44px")},
  "labelSize":dim("11px"),"hitTarget":dim("44px"),
  "staleOpacity":num(0.45),"ringFillOpacity":num(0.18),"ringStrokeWidth":dim("2px"),"heatOpacity":num(0.6)
 }
}
json.dump(T, open(TOKENS / "tokens.json","w"), indent=2)
print("written")
