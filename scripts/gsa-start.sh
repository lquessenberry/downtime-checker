#!/bin/sh
set -eu
php-fpm --nodaemonize &
sleep 0.4
php /app/poll-runner.php loop &
if ! nginx -t; then
  echo "nginx -t failed" >&2
  cat /etc/nginx/nginx.conf >&2
  ls -la /etc/nginx/conf.d >&2
  exit 1
fi
exec nginx -g 'daemon off;'
