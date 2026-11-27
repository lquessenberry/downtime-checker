"""Repo-relative locations for the Global Status asset kit."""
from pathlib import Path
import os

ROOT = Path(__file__).resolve().parents[1]
TOKENS = ROOT / "tokens"
TOKENS_DIST = TOKENS / "dist"
ICONS = ROOT / "icons"
LOGO = ROOT / "logo"
STORE = ROOT / "store"
PREVIEW = ROOT / "preview"
AVATAR = ROOT / "brand" / "avatar"
MARKERS = ROOT / "markers"
SPLASH = ROOT / "splash"
UI = ROOT / "ui"
SRC = ROOT / "src"

# IBM Plex (SIL OFL) is used only at build time; wordmarks are outlined to paths.
FONT_DIR = Path(os.environ.get(
    "IBM_PLEX_DIR",
    "/usr/share/fonts/truetype/sand-box/google",
))
