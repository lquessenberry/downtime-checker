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

Credentials: `~/.config/globalstatus/netrc` or `GLOBALSTATUS_FTP_PASS`. Copy the host/user/password from Will's `FTP Credentials.txt`. Do not commit that file.

Staging is Fly:

```bash
scripts/deploy-staging-fly.sh
```
