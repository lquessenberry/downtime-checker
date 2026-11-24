# Deploying globalstatus.app from `deploy/globalstatus-live`

This branch mirrors what is live on globalstatus.app (GoDaddy, `public_html/globalstatus.app`).
Its `globalstatus/` folder matches the live files, not the tip of `feat/globalstatus-prod`.
Unreleased work on `feat/globalstatus-prod` (for example `blast.js`, `quakes.js`, the poll runner,
designations and violence) is not on this branch. Do not merge `feat/globalstatus-prod` into it.

## How to ship a live change

1. Commit the change on `deploy/globalstatus-live` only. Keep the change small and limited to the files that need to change.
   Also open or update a PR into `feat/globalstatus-prod` so the change is kept there.
2. Dry run first. In Actions, open **Deploy production FTP**, choose **Run workflow**, select
   branch `deploy/globalstatus-live`, and set `dry_run` = true and `with_data` = false.
   CLI:
   `gh workflow run deploy-production-ftp.yml -R lquessenberry/downtime-checker --ref deploy/globalstatus-live -f dry_run=true -f with_data=false`
3. Read the log. Each `put` line is a file it would upload. Check that the list looks right.
4. Run it again with `dry_run` = false only when Will says to.

## What the push does (`scripts/ftp_prod.py push`)

- It uploads every file under `globalstatus/` to the FTP root `/`, which is `public_html/globalstatus.app`, and overwrites any existing file with the same name.
- It never deletes remote files and never compares them first. Every file is uploaded on every run.
- It skips `*.md`, `.well-known/`, `cgi-bin/`, `dev-router.php` and lock or flag files. It also skips `data/` unless `with_data` is set.
  `data/` is not committed on this branch, so the live scan caches are never overwritten.

## Notes

- GoDaddy injects a traffic script (`_trfq` / `tccl.min.js`) into `index.html` as it serves the page.
  Never commit that script. A copy of `index.html` saved from the browser includes it, so remove it before committing.
- The `api/*.json` files here are the versions that are live, from Lee's 20 Nov FTP sync, not the newer refreshed packs.
  Uploading newer packs is a deliberate change, so dry-run it the same way.
- Never use a church FTP account. `ftp_prod.py` refuses a login that looks like one.
