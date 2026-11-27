"""Thin wrapper around rsvg-convert."""
import subprocess
from pathlib import Path

def raster(svg_path, png_path, width=None, height=None):
    svg_path = Path(svg_path)
    png_path = Path(png_path)
    png_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["rsvg-convert"]
    if width:
        cmd += ["-w", str(int(width))]
    if height:
        cmd += ["-h", str(int(height))]
    cmd += [str(svg_path), "-o", str(png_path)]
    subprocess.run(cmd, check=True)
    return png_path
