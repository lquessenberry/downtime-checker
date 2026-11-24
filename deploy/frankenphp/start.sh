#!/bin/sh
# One process tree: the poll runner loops in the background (restarting if
# it ever exits) and FrankenPHP serves in the foreground.
# The runner honors last-poll timestamps in data/poll-status.json, which
# lives on the Fly volume so a restart does not immediately re-poll.
set -eu

if [ "$(id -u)" -eq 0 ]; then
  mkdir -p /app/public/data /data/caddy /config/caddy
  chown -R app:app /app/public/data /data/caddy /config/caddy
  exec su-exec app "$0" "$@"
fi

cd /app/public
mkdir -p data
# Host catalog is baked into the image. The volume hides /app/public/data,
# so seed targets.json onto the volume once if it is not already there.
if [ ! -s /app/public/data/targets.json ] && [ -s /app/share/targets.json ]; then
  cp /app/share/targets.json /app/public/data/targets.json
fi
(
  while true; do
    php poll-runner.php loop || true
    echo "poll-runner exited; restarting in 30s" >&2
    sleep 30
  done
) &
exec frankenphp run --config /etc/frankenphp/Caddyfile
