#!/bin/bash
# Open the Downtime globe. Start the local server when it is not already up.
root="$(cd "$(dirname "$0")" && pwd)"
url="http://127.0.0.1:4173/"
log="${HOME}/.cache/downtime/visualizer.log"
pidfile="${HOME}/.cache/downtime/visualizer.pid"
mkdir -p "${HOME}/.cache/downtime"

find_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi
  local candidate
  for candidate in \
    "${HOME}/opt/sdr/node-v20.19.5-linux-x64/bin/node" \
    /usr/bin/node \
    /usr/bin/nodejs
  do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

focus_window() {
  local wid=""
  if ! command -v xdotool >/dev/null 2>&1; then
    return 1
  fi
  wid=$(xdotool search --name "DOWNTIME // LIVE GRID" 2>/dev/null | head -n 1 || true)
  if [[ -z "$wid" ]]; then
    return 1
  fi
  xdotool windowmap "$wid" >/dev/null 2>&1 || true
  xdotool windowactivate "$wid" >/dev/null 2>&1 || true
  return 0
}

open_browser() {
  if focus_window; then
    return 0
  fi
  if command -v google-chrome >/dev/null 2>&1; then
    setsid -f google-chrome --app="$url" >/dev/null 2>&1 9>&-
  elif command -v xdg-open >/dev/null 2>&1; then
    setsid -f xdg-open "$url" >/dev/null 2>&1 9>&-
  fi
  local _
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if focus_window; then
      return 0
    fi
    sleep 0.3
  done
}

fail() {
  echo "$1"
  echo
  if [[ -f "$log" ]]; then
    tail -n 40 "$log"
    echo
  fi
  read -r -p "Press Enter to close..."
  exit 1
}

if curl -fs -o /dev/null --max-time 2 "$url"; then
  open_browser
  exit 0
fi

node_bin="$(find_node)" || fail "Node.js is required to open Downtime UI."
if [[ ! -f "$root/visualizer/server.mjs" ]]; then
  fail "Could not find the visualizer next to this launcher."
fi

: > "$log"
setsid "$node_bin" "$root/visualizer/server.mjs" >>"$log" 2>&1 </dev/null &
echo $! > "$pidfile"

for _ in $(seq 1 40); do
  if curl -fs -o /dev/null --max-time 1 "$url"; then
    open_browser
    exit 0
  fi
  if ! kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    break
  fi
  sleep 0.2
done

fail "Downtime UI did not start."
