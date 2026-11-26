#!/usr/bin/env python3
"""Build globalstatus/geo/us-states.json: 50 states + DC outlines, simplified.

Source: U.S. Census Bureau cartographic boundary file cb_2024_us_state_20m
(public domain): https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_state_20m.zip

    python3 scripts/build_us_states.py /path/to/cb_2024_us_state_20m.shp

Output: {"source":..., "states": {"TX": {"name": "Texas", "c": [lon, lat], "rings": [[[lon, lat], ...], ...]}}}
Rings are outer boundaries only (no state has a meaningful hole at this scale),
Douglas-Peucker simplified to about 0.02 degrees, rounded to 3 decimals.
"""
import json
import sys

import shapefile

TOL = 0.02
MIN_AREA = 0.004  # square degrees; drops specks, keeps real islands


def area(ring):
    s = 0.0
    for i in range(len(ring) - 1):
        s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    return s / 2.0


def centroid(ring):
    a = area(ring)
    if a == 0:
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        return [sum(xs) / len(xs), sum(ys) / len(ys)]
    cx = cy = 0.0
    for i in range(len(ring) - 1):
        f = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
        cx += (ring[i][0] + ring[i + 1][0]) * f
        cy += (ring[i][1] + ring[i + 1][1]) * f
    return [cx / (6 * a), cy / (6 * a)]


def simplify(pts, tol):
    if len(pts) < 4:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        s, e = stack.pop()
        ax, ay = pts[s]
        dx, dy = pts[e][0] - ax, pts[e][1] - ay
        ln = (dx * dx + dy * dy) ** 0.5
        best, idx = 0.0, -1
        for i in range(s + 1, e):
            px, py = pts[i][0] - ax, pts[i][1] - ay
            d = abs(dx * py - dy * px) / ln if ln else (px * px + py * py) ** 0.5
            if d > best:
                best, idx = d, i
        if idx > 0 and best > tol:
            keep[idx] = True
            stack.append((s, idx))
            stack.append((idx, e))
    return [p for p, k in zip(pts, keep) if k]


def main(path):
    r = shapefile.Reader(path)
    fields = [f[0] for f in r.fields[1:]]
    out = {}
    for sr in r.shapeRecords():
        rec = dict(zip(fields, sr.record))
        code = rec["STUSPS"]
        if code in ("PR", "VI", "GU", "AS", "MP"):
            continue
        shp = sr.shape
        parts = list(shp.parts) + [len(shp.points)]
        rings = []
        for i in range(len(parts) - 1):
            ring = [list(p) for p in shp.points[parts[i]:parts[i + 1]]]
            if area(ring) > 0:  # shapefile outer rings are clockwise (negative area)
                continue
            if abs(area(ring)) < MIN_AREA:
                continue
            simple = simplify(ring, TOL)
            if len(simple) < 4:
                simple = simplify(ring, TOL / 4)
            if len(simple) < 4:
                continue
            rings.append([[round(x, 3), round(y, 3)] for x, y in simple])
        big = max(rings, key=lambda g: abs(area(g)))
        c = centroid(big)
        out[code] = {"name": rec["NAME"], "c": [round(c[0], 3), round(c[1], 3)], "rings": rings}
    doc = {
        "source": "U.S. Census Bureau cartographic boundary file cb_2024_us_state_20m (public domain), simplified",
        "states": dict(sorted(out.items())),
    }
    json.dump(doc, open("globalstatus/geo/us-states.json", "w"), separators=(",", ":"))
    print(len(out), "states;", sum(len(s["rings"]) for s in out.values()), "rings;", sum(len(g) for s in out.values() for g in s["rings"]), "points")


if __name__ == "__main__":
    main(sys.argv[1])
