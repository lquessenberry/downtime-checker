#!/usr/bin/env bash
# Between-phase SigMap: WASM + Rust crates + Cesium globe.
# Does not commit .context/. Writes docs/architecture/WIKI.md and COVERAGE.md.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
mkdir -p docs/architecture
echo "sigmap generate (rust + wasm + cesium)"
npx --yes sigmap --track
echo "sigmap wiki"
npx --yes sigmap wiki --out docs/architecture/WIKI.md
echo "sigmap health"
npx --yes sigmap --health --json | tee docs/architecture/health.json || true
echo "sigmap coverage (CI gate, min 50 — markdown/docs pull the raw % down)"
set +e
npx --yes sigmap --ci --json --min-coverage 50 | tee docs/architecture/coverage.json
CI_EXIT=$?
set -e
npx --yes sigmap --analyze --json > docs/architecture/coverage-analyze.json || true
npx --yes sigmap --report --json > docs/architecture/coverage-report.json || true
echo "done wiki=$ROOT/docs/architecture/WIKI.md coverage_exit=$CI_EXIT"
