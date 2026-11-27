# Global Status mark: a globe (kept from the original favicon) whose equator is a live status pulse.
DARK = dict(fill="#10283a", ring="#7ec8ff", grid="#7ec8ff", pulse="#3dff9a")
LIGHT = dict(fill="#e3f1fb", ring="#0b5fa5", grid="#0b5fa5", pulse="#0a8a52")
MONO_W = dict(fill="none", ring="#ffffff", grid="#ffffff", pulse="#ffffff")
MONO_K = dict(fill="none", ring="#070b10", grid="#070b10", pulse="#070b10")

PULSE = "M7 32 H21.5 L25.5 23 L30.5 43 L35.5 17 L39.5 32 H57"

def mark_group(c, detail=True, tx=0, ty=0, s=1.0):
    """Mark drawn in a 64x64 box. detail=False = small-size version (no meridian, heavier strokes)."""
    sw_ring = 3.2 if detail else 4.6
    sw_pulse = 3.4 if detail else 4.8
    g = [f'<g transform="translate({tx} {ty}) scale({s})">']
    g.append(f'<circle cx="32" cy="32" r="24" fill="{c["fill"]}"/>')
    if detail:
        g.append(f'<ellipse cx="32" cy="32" rx="10.5" ry="24" fill="none" stroke="{c["grid"]}" stroke-opacity="0.55" stroke-width="1.8"/>')
        g.append(f'<path d="M12.5 19.5 H51.5 M12.5 44.5 H51.5" fill="none" stroke="{c["grid"]}" stroke-opacity="0.3" stroke-width="1.4"/>')
    g.append(f'<circle cx="32" cy="32" r="24" fill="none" stroke="{c["ring"]}" stroke-width="{sw_ring}"/>')
    g.append(f'<path d="{PULSE}" fill="none" stroke="{c["pulse"]}" stroke-width="{sw_pulse}" stroke-linecap="round" stroke-linejoin="round"/>')
    g.append('</g>')
    return "\n".join(g)

def svg(w, h, body, bg=None, rx=0):
    b = f'<rect width="{w}" height="{h}" rx="{rx}" fill="{bg}"/>' if bg else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">{b}{body}</svg>\n'
