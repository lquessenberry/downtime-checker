#!/bin/bash
# Install Downtime into the current user's home. No network and no root.
set -euo pipefail

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required. Install python3, then run this again."
  exit 1
fi

src="$(cd "$(dirname "$0")" && pwd)"
dest="$HOME/bin/downtime"
desktop="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
if [[ -z "$desktop" || "$desktop" != "$HOME"/* ]]; then
  desktop="$HOME/Desktop"
fi
mkdir -p "$dest" "$desktop" "$HOME/.local/share/applications" "$HOME/.local/share/icons"

if [[ -f "$src/downtime/downtime.py" ]]; then
  program="$src/downtime"
elif [[ -f "$src/downtime.py" ]]; then
  program="$src"
else
  echo "Could not find downtime.py next to this installer."
  exit 1
fi

cp -a "$program/downtime.py" "$program/.launcher-run.sh" "$dest/"
if [[ -f "$program/.launcher-ui.sh" ]]; then
  cp -a "$program/.launcher-ui.sh" "$dest/"
fi
if [[ -f "$program/.launcher-cesium.sh" ]]; then
  cp -a "$program/.launcher-cesium.sh" "$dest/"
fi
for name in \
  places.txt world-governments.txt institutions.txt world-exchanges.txt \
  transportation.txt stores.txt service-sites.txt communications.txt military.txt \
  shipping.txt food.txt weather.txt banks-national.txt utilities-national.txt \
  government-extra.txt locations.json added-places.txt
do
  if [[ -f "$program/$name" ]]; then
    cp -a "$program/$name" "$dest/"
  fi
done
if [[ -d "$program/visualizer" ]]; then
  mkdir -p "$dest/visualizer"
  cp -a "$program/visualizer/." "$dest/visualizer/"
  rm -rf "$dest/visualizer/node_modules"
fi
chmod 755 "$dest/downtime.py" "$dest/.launcher-run.sh"
if [[ -f "$dest/.launcher-ui.sh" ]]; then
  chmod 755 "$dest/.launcher-ui.sh"
fi
if [[ -f "$dest/.launcher-cesium.sh" ]]; then
  chmod 755 "$dest/.launcher-cesium.sh"
fi

cp "$src/icons/downtime.png" "$HOME/.local/share/icons/downtime.png"
if [[ -f "$src/icons/downtime-ui.png" ]]; then
  cp "$src/icons/downtime-ui.png" "$HOME/.local/share/icons/downtime-ui.png"
fi
if [[ -f "$src/icons/downtime-cesium.png" ]]; then
  cp "$src/icons/downtime-cesium.png" "$HOME/.local/share/icons/downtime-cesium.png"
fi
for size in 48 64 128 256; do
  mkdir -p "$HOME/.local/share/icons/hicolor/${size}x${size}/apps"
  cp "$src/icons/downtime-${size}.png" "$HOME/.local/share/icons/hicolor/${size}x${size}/apps/downtime.png"
  if [[ -f "$src/icons/downtime-ui-${size}.png" ]]; then
    cp "$src/icons/downtime-ui-${size}.png" "$HOME/.local/share/icons/hicolor/${size}x${size}/apps/downtime-ui.png"
  fi
  if [[ -f "$src/icons/downtime-cesium-${size}.png" ]]; then
    cp "$src/icons/downtime-cesium-${size}.png" "$HOME/.local/share/icons/hicolor/${size}x${size}/apps/downtime-cesium.png"
  fi
done

quote() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '"%s"' "$s"
}

terminal=""
if command -v qterminal >/dev/null 2>&1; then
  terminal="$(command -v qterminal)"
fi

write_launcher() {
  local file="$1"
  if [[ -n "$terminal" ]]; then
    cat > "$file" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Downtime
Comment=Search everything, world governments, one country, banks and stock exchanges, tech, utilities, education, medical, transportation, stores, communications, and military
Exec=$terminal --workdir $(quote "$dest") -e $(quote "$dest/.launcher-run.sh")
TryExec=$terminal
Icon=downtime
Path=$dest
Terminal=false
Categories=Network;
StartupNotify=true
EOF
  else
    cat > "$file" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Downtime
Comment=Search everything, world governments, one country, banks and stock exchanges, tech, utilities, education, medical, transportation, stores, communications, and military
Exec=$(quote "$dest/.launcher-run.sh")
Icon=downtime
Path=$dest
Terminal=true
Categories=Network;
StartupNotify=true
EOF
  fi
  chmod 755 "$file"
  if command -v gio >/dev/null 2>&1 && command -v sha256sum >/dev/null 2>&1; then
    local digest
    digest="$(sha256sum "$file" | awk '{print $1}')"
    gio set -t string "$file" metadata::xfce-exe-checksum "$digest" >/dev/null 2>&1 || true
    gio set "$file" metadata::trusted true >/dev/null 2>&1 || true
  fi
}

write_ui_launcher() {
  local file="$1"
  if [[ ! -f "$dest/.launcher-ui.sh" ]]; then
    return 0
  fi
  if [[ -n "$terminal" ]]; then
    cat > "$file" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Downtime UI
Comment=Live globe for the downtime catalogs
Exec=$terminal --workdir $(quote "$dest") -e $(quote "$dest/.launcher-ui.sh")
TryExec=$terminal
Icon=downtime-ui
Path=$dest
Terminal=false
Categories=Network;
StartupNotify=true
EOF
  else
    cat > "$file" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Downtime UI
Comment=Live globe for the downtime catalogs
Exec=$(quote "$dest/.launcher-ui.sh")
Icon=downtime-ui
Path=$dest
Terminal=true
Categories=Network;
StartupNotify=true
EOF
  fi
  chmod 755 "$file"
  if command -v gio >/dev/null 2>&1 && command -v sha256sum >/dev/null 2>&1; then
    local digest
    digest="$(sha256sum "$file" | awk '{print $1}')"
    gio set -t string "$file" metadata::xfce-exe-checksum "$digest" >/dev/null 2>&1 || true
    gio set "$file" metadata::trusted true >/dev/null 2>&1 || true
  fi
}

write_launcher "$desktop/Downtime.desktop"
write_launcher "$HOME/.local/share/applications/Downtime.desktop"
write_cesium_launcher() {
  local file="$1"
  if [[ ! -f "$dest/.launcher-cesium.sh" ]]; then
    return 0
  fi
  if [[ -n "$terminal" ]]; then
    cat > "$file" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Downtime Cesium
Comment=Cesium globe for the downtime catalogs
Exec=$terminal --workdir $(quote "$dest") -e $(quote "$dest/.launcher-cesium.sh")
TryExec=$terminal
Icon=downtime-cesium
Path=$dest
Terminal=false
Categories=Network;
StartupNotify=true
EOF
  else
    cat > "$file" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Downtime Cesium
Comment=Cesium globe for the downtime catalogs
Exec=$(quote "$dest/.launcher-cesium.sh")
Icon=downtime-cesium
Path=$dest
Terminal=true
Categories=Network;
StartupNotify=true
EOF
  fi
  chmod 755 "$file"
  if command -v gio >/dev/null 2>&1 && command -v sha256sum >/dev/null 2>&1; then
    local digest
    digest="$(sha256sum "$file" | awk '{print $1}')"
    gio set -t string "$file" metadata::xfce-exe-checksum "$digest" >/dev/null 2>&1 || true
    gio set "$file" metadata::trusted true >/dev/null 2>&1 || true
  fi
}

if [[ -d "$desktop/Pentesting" ]]; then
  write_launcher "$desktop/Pentesting/Downtime.desktop"
  write_ui_launcher "$desktop/Pentesting/Downtime UI.desktop"
  write_cesium_launcher "$desktop/Pentesting/Downtime Cesium.desktop"
fi
write_ui_launcher "$HOME/.local/share/applications/Downtime UI.desktop"
write_cesium_launcher "$HOME/.local/share/applications/Downtime Cesium.desktop"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
fi

echo "Downtime is installed."
echo "Program: $dest"
echo "Launcher: $desktop/Downtime.desktop"
if [[ -d "$desktop/Pentesting" ]]; then
  echo "Also in: $desktop/Pentesting/Downtime.desktop"
  if [[ -f "$desktop/Pentesting/Downtime UI.desktop" ]]; then
    echo "Globe: $desktop/Pentesting/Downtime UI.desktop"
  fi
  if [[ -f "$desktop/Pentesting/Downtime Cesium.desktop" ]]; then
    echo "Cesium: $desktop/Pentesting/Downtime Cesium.desktop"
  fi
fi
echo "It is also in the application menu."
if ! command -v figlet >/dev/null 2>&1; then
  echo "Country names stay plain text until figlet is installed. The checker runs without it."
fi
