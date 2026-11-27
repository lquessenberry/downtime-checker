from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from paths import FONT_DIR
F = str(FONT_DIR) + "/"
FONTS = {
 "cond600": F+"IBM Plex Sans Condensed/IBMPlexSansCondensed-SemiBold.ttf",
 "cond400": F+"IBM Plex Sans Condensed/IBMPlexSansCondensed-Regular.ttf",
 "mono500": F+"IBM Plex Mono/IBMPlexMono-Medium.ttf",
 "mono400": F+"IBM Plex Mono/IBMPlexMono-Regular.ttf",
}
_cache = {}
def font(k):
    if k not in _cache: _cache[k] = TTFont(FONTS[k])
    return _cache[k]

def text_path(txt, key, size, x=0, y=0, tracking=0.0):
    """Return (svg path d, advance width) for txt with baseline at y. tracking in em."""
    f = font(key); upm = f["head"].unitsPerEm; s = size/upm
    cmap = f.getBestCmap(); gs = f.getGlyphSet(); hmtx = f["hmtx"]
    pen = SVGPathPen(gs); cx = 0.0
    for i, ch in enumerate(txt):
        gn = cmap.get(ord(ch))
        if gn is None: continue
        tp = TransformPen(pen, (s, 0, 0, -s, x + cx, y))
        gs[gn].draw(tp)
        cx += hmtx[gn][0]*s + (tracking*size if i < len(txt)-1 else 0)
    return pen.getCommands(), cx

def cap_height(key, size):
    f = font(key); os2 = f["OS/2"]
    return getattr(os2, "sCapHeight", 0.7*f["head"].unitsPerEm) * size / f["head"].unitsPerEm
