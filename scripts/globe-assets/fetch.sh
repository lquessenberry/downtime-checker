#!/usr/bin/env bash
# Pull small free map assets into data/map-assets/ (gitignored).
# Does not fetch planet PMTiles, Landsat, or LiDAR.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="${GSA_MAP_ASSETS:-$ROOT/data/map-assets}"
mkdir -p "$DEST"
UA="GlobalStatusGlobe/0.1 (https://github.com/lquessenberry/downtime-checker; map-assets)"

fetch() {
  local url="$1" out="$2"
  if [[ -f "$out" ]]; then
    echo "have $out"
    return
  fi
  echo "GET $url"
  curl -fsSL -A "$UA" -o "$out" "$url"
}

ne110=0
wmm=0
tz=0
iss=0
pbr=0
offline=0
lidar=0
weather=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ne110) ne110=1 ;;
    --wmm) wmm=1 ;;
    --tz) tz=1 ;;
    --iss-tle) iss=1 ;;
    --pbr-manifest) pbr=1 ;;
    --offline-tools) offline=1 ;;
    --lidar-portals) lidar=1 ;;
    --weather-portals) weather=1 ;;
    --help|-h)
      echo "Usage: $0 [--ne110] [--wmm] [--tz] [--iss-tle] [--pbr-manifest] [--offline-tools] [--lidar-portals] [--weather-portals]"
      echo "  --wmm      NOAA WMM coefficient file (tiny). Tries several mirrors."
      echo "  --tz       Copy the UTC sample polygon (fixture). Not the world file."
      echo "  --iss-tle  CelesTrak stations TLE (small text)."
      echo "  --pbr-manifest  Copy CC0/NASA PBR URL list (no 8K files)."
      echo "  --offline-tools Copy QGIS/Marble/pmtiles/tippecanoe/ATAK URL list (no APKs)."
      echo "  --lidar-portals Copy country LiDAR portal URLs (no grids)."
      echo "  --weather-portals Copy NOAA/NWS/EUMETSAT URL list (no GRIB)."
      echo "Never downloads GEBCO grids, planet PMTiles, Landsat, LiDAR, GRIB, or ion tiles."
      exit 0
      ;;
    *) echo "unknown $1" >&2; exit 1 ;;
  esac
  shift
done

# Tracked README.md in data/map-assets/ stays in git. Do not clobber it.

if [[ "$ne110" -eq 1 ]]; then
  fetch "https://naciscdn.org/naturalearth/110m/physical/ne_110m_land.zip" "$DEST/ne_110m_land.zip"
fi

if [[ "$wmm" -eq 1 ]]; then
  fetched=0
  for url in \
    "https://www.ngdc.noaa.gov/geomag/WMM/data/WMM2025/WMM2025.COF" \
    "https://www.ngdc.noaa.gov/geomag/WMM/data/WMM2020/WMM2020.COF" \
    "https://raw.githubusercontent.com/cmweiss/geomag/master/geomag/WMM.COF"
  do
    if curl -fsSL -A "$UA" -o "$DEST/WMM.COF" "$url"; then
      echo "WMM from $url"
      fetched=1
      break
    fi
  done
  if [[ "$fetched" -eq 0 ]]; then
    echo "WMM download failed (offline or URL moved). Portal: https://www.ncei.noaa.gov/products/world-magnetic-model" >&2
  fi
fi

if [[ "$tz" -eq 1 ]]; then
  src="$ROOT/rust/crates/globe-native/src/engine/fixtures/timezone-utc-sample.geojson"
  if [[ -f "$src" ]]; then
    cp "$src" "$DEST/timezone-utc-sample.geojson"
  fi
fi

if [[ "$iss" -eq 1 ]]; then
  fetch "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle" "$DEST/stations.tle"
fi

if [[ "$pbr" -eq 1 ]]; then
  src="$ROOT/scripts/globe-assets/pbr-manifest.json"
  if [[ -f "$src" ]]; then
    cp "$src" "$DEST/pbr-manifest.json"
    echo "PBR manifest $DEST/pbr-manifest.json (URLs only)"
  fi
fi

if [[ "$offline" -eq 1 ]]; then
  src="$ROOT/scripts/globe-assets/offline-tools-manifest.json"
  if [[ -f "$src" ]]; then
    cp "$src" "$DEST/offline-tools-manifest.json"
    echo "offline-tools manifest $DEST/offline-tools-manifest.json (URLs only, no APKs)"
  fi
fi

if [[ "$lidar" -eq 1 ]]; then
  src="$ROOT/scripts/globe-assets/lidar-portals-manifest.json"
  if [[ -f "$src" ]]; then
    cp "$src" "$DEST/lidar-portals-manifest.json"
    echo "lidar-portals manifest $DEST/lidar-portals-manifest.json (URLs only, no grids)"
  fi
fi

if [[ "$weather" -eq 1 ]]; then
  src="$ROOT/scripts/globe-assets/weather-portals-manifest.json"
  if [[ -f "$src" ]]; then
    cp "$src" "$DEST/weather-portals-manifest.json"
    echo "weather-portals manifest $DEST/weather-portals-manifest.json (URLs only, no GRIB)"
  fi
fi

echo "cache $DEST"
ls -la "$DEST"
