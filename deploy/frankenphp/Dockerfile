# FrankenPHP (Caddy + PHP 8.4, classic mode) serving the globalstatus/ Cesium site.
# Build from the repo root:
#   docker build -f deploy/frankenphp/Dockerfile -t globalstatus-franken .
FROM dunglas/frankenphp:1-php8.4-alpine

RUN apk add --no-cache zstd brotli \
 && cp "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini"

COPY deploy/frankenphp/php.ini $PHP_INI_DIR/conf.d/zz-globalstatus.ini
COPY deploy/frankenphp/Caddyfile /etc/frankenphp/Caddyfile
COPY deploy/frankenphp/start.sh /usr/local/bin/gsa-start
COPY globalstatus/ /app/public/

# Precompress the big static files once, so requests never compress them live.
# index.js / index.cjs are npm entry points the page never loads.
RUN rm -f /app/public/vendor/cesium/index.js /app/public/vendor/cesium/index.cjs \
          /app/public/dev-router.php /app/public/.htaccess /app/public/data/.htaccess \
 && find /app/public -type f \( -name '*.js' -o -name '*.json' -o -name '*.css' -o -name '*.html' -o -name '*.svg' -o -name '*.geojson' -o -name '*.webmanifest' \) \
      -not -path '/app/public/data/*' -size +1k \
      -exec sh -c 'for f; do gzip -9 -k -f "$f"; brotli -q 11 -f -k "$f"; zstd -q -19 -f -k "$f"; done' _ {} + \
 && chmod +x /usr/local/bin/gsa-start \
 && adduser -D -H -u 10001 app \
 && mkdir -p /app/public/data /data/caddy /config/caddy \
 && chown -R app:app /app/public/data /data/caddy /config/caddy

USER app
ENV PORT=8080 XDG_DATA_HOME=/data XDG_CONFIG_HOME=/config
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["gsa-start"]
