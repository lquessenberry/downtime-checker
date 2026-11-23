#!/bin/sh
# One process tree, no supervisor: the poll runner loops in the background
# (restarting if it ever exits) and FrankenPHP serves in the foreground.
set -eu
cd /app/public
mkdir -p data
(
  while true; do
    php poll-runner.php loop >/dev/null || true
    echo "poll-runner exited; restarting in 30s" >&2
    sleep 30
  done
) &
exec frankenphp run --config /etc/frankenphp/Caddyfile
