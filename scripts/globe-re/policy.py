"""SPDX ingest gate. MapLibre ≠ Mapbox. Re-exports globe_plan registry."""

from __future__ import annotations

from globe_plan import ENGINES, PERMISSIVE_SPDX, REFUSE, refuse_engine

# Compatibility names used by globe_re.py tests.
ALLOWED_TARGETS = {
    key: {
        "license": meta["spdx"],
        "repo": meta.get("upstream", ""),
        "kind": meta["lang"] + "-source",
        "notes": f"SPDX {meta['spdx']}. Permissive ingest only.",
    }
    for key, meta in ENGINES.items()
}
ALLOWED_TARGETS["cesium"] = ALLOWED_TARGETS["cesiumjs"]
ALLOWED_TARGETS["maplibre"] = ALLOWED_TARGETS["maplibre-gl"]

REFUSED_SUBSTRINGS = tuple(REFUSE.keys())


def refuse_reason(target: str) -> str | None:
    reason = refuse_engine(target)
    if reason and reason.startswith("unknown engine"):
        return f"Unknown target {target!r}. Allowed: {', '.join(sorted(ENGINES))}."
    if reason:
        return f"Refused target {target!r}. {reason}"
    return None


__all__ = [
    "ALLOWED_TARGETS",
    "ENGINES",
    "PERMISSIVE_SPDX",
    "REFUSE",
    "REFUSED_SUBSTRINGS",
    "refuse_engine",
    "refuse_reason",
]
