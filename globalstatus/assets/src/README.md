# Asset generators

Python scripts that build everything under `globalstatus/assets/`.

Dependencies: Python 3, Pillow, fontTools, `rsvg-convert` (librsvg), and IBM Plex Sans Condensed + IBM Plex Mono (SIL OFL) at `$IBM_PLEX_DIR` or `/usr/share/fonts/truetype/sand-box/google`. Fonts are a build-time dependency only; wordmarks are outlined to paths.

```bash
cd globalstatus/assets/src
python3 build_all.py              # markers, splash, UI, review sheets
python3 build_all.py --brand      # also logos, icons, marketing, avatars
python3 build_all.py --tokens --brand
# or one set:
python3 build_markers.py
python3 build_splash.py
python3 build_ui.py
python3 build_sheets.py
```

`paths.py` resolves every output folder from this file's location, so the kit can be rebuilt from any checkout. After changing icons that are wired at the web root, copy them into `globalstatus/` as listed in `../ASSETS.md` and bump the `?v=` query string.
