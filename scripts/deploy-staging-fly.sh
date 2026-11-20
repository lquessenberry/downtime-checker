#!/usr/bin/env bash
# Staging: Node Cesium globe on Fly (downtime-globe).
# Production is GoDaddy FTP (globalstatus.app). See scripts/ftp_prod.py.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
exec fly deploy --ha=false "$@"
