#!/usr/bin/env python3
"""Rebuild Global Status assets.

Default: markers, splash, UI, and review sheets.
Add --brand to also rebuild logos, icons, marketing, avatars and map conventions.
Add --tokens to rebuild design tokens from tokens/tokens.json.

Requires rsvg-convert and IBM Plex (SIL OFL) at $IBM_PLEX_DIR or the
box default /usr/share/fonts/truetype/sand-box/google. Wordmarks are
outlined to paths, so the fonts are a build-time dependency only.
"""
import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--tokens", action="store_true")
    p.add_argument("--brand", action="store_true",
                   help="rebuild logo, icons, marketing, avatars, map conventions, previews")
    args = p.parse_args()

    if args.tokens:
        print("== tokens")
        import build_tokens  # noqa: F401  (runs on import)

    if args.brand:
        print("== logo / icons / marketing / avatar / mapconv / previews")
        import build_logo  # noqa: F401
        import build_icons  # noqa: F401
        import build_marketing  # noqa: F401
        import build_marketing_notagline  # noqa: F401
        import build_avatar  # noqa: F401
        import build_mapconv  # noqa: F401
        import build_previews  # noqa: F401

    import build_markers
    import build_splash
    import build_ui
    import build_sheets

    print("== markers")
    build_markers.build()
    print("== splash")
    build_splash.build()
    print("== ui")
    build_ui.build()
    print("== sheets")
    build_sheets.build()
    print("all ok")


if __name__ == "__main__":
    main()
