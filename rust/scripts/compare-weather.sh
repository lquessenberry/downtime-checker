#!/usr/bin/env bash
# Time the weather catalog (4 hosts) with the Rust CLI and the Python menu.
# Rust is asked not to call ipwho.is. Python still looks locations up, so the
# Python number includes that extra work. Both use the same ping-then-443-then-80 order.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root/rust"
cargo build --release -p downtime-cli
bin="$root/rust/target/release/downtime"

elapsed() {
  python3 - "$1" "$2" <<'PY'
import sys
print(f"{(int(sys.argv[2]) - int(sys.argv[1])) / 1e9:.3f}")
PY
}

start=$(date +%s%N)
"$bin" --root "$root" check weather --no-lookup --no-color >/tmp/downtime-rust-weather.txt
rust_seconds="$(elapsed "$start" "$(date +%s%N)")"

start=$(date +%s%N)
python3 "$root/downtime.py" >/tmp/downtime-python-weather.txt <<'EOF'
16
0
EOF
python_seconds="$(elapsed "$start" "$(date +%s%N)")"

echo "Rust weather --no-lookup: ${rust_seconds}s"
echo "Python weather (menu 16, includes location lookup): ${python_seconds}s"
echo "Rust log: /tmp/downtime-rust-weather.txt"
echo "Python log: /tmp/downtime-python-weather.txt"
