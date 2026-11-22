#!/usr/bin/env bash
# Between-phase SigMap: WASM + Rust crates + Cesium globe.
# Does not commit .context/. Writes docs/architecture/WIKI.md.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
mkdir -p docs/architecture
echo "sigmap generate (rust + wasm + cesium)"
npx --yes sigmap --track
echo "sigmap wiki"
npx --yes sigmap wiki --out docs/architecture/WIKI.md
echo "sigmap health"
npx --yes sigmap --health || true
echo "done $ROOT/docs/architecture/WIKI.md"
