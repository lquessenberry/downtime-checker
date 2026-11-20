# Production globe (globalstatus.app)

Static Cesium page plus `router.php` for `/api` on GoDaddy shared hosting.

```bash
# pull a fresh copy of live production
python3 scripts/ftp_prod.py pull

# see what would be uploaded
python3 scripts/ftp_prod.py push --dry-run

# production deploy (does not touch .well-known, cgi-bin, or scan locks)
python3 scripts/ftp_prod.py push
```

Credentials: `~/.config/globalstatus/netrc` or `GLOBALSTATUS_FTP_*` env vars. The same names are GitHub Actions secrets on the `production` environment of `lquessenberry/downtime-checker`. Do not commit the password file.

Staging is Fly:

```bash
scripts/deploy-staging-fly.sh
```
