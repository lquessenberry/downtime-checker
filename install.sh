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
chmod 755 "$dest/downtime.py" "$dest/.launcher-run.sh"

cp "$src/icons/downtime.png" "$HOME/.local/share/icons/downtime.png"
for size in 48 64 128 256; do
  mkdir -p "$HOME/.local/share/icons/hicolor/${size}x${size}/apps"
  cp "$src/icons/downtime-${size}.png" "$HOME/.local/share/icons/hicolor/${size}x${size}/apps/downtime.png"
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

write_launcher "$desktop/Downtime.desktop"
write_launcher "$HOME/.local/share/applications/Downtime.desktop"
if [[ -d "$desktop/Pentesting" ]]; then
  write_launcher "$desktop/Pentesting/Downtime.desktop"
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
fi

echo "Downtime is installed."
echo "Program: $dest"
echo "Launcher: $desktop/Downtime.desktop"
if [[ -d "$desktop/Pentesting" ]]; then
  echo "Also in: $desktop/Pentesting/Downtime.desktop"
fi
echo "It is also in the application menu."
if ! command -v figlet >/dev/null 2>&1; then
  echo "Country names stay plain text until figlet is installed. The checker runs without it."
fi
