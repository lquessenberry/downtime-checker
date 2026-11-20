# Contributing (Global Status App)

Work happens on the fork **[lquessenberry/downtime-checker](https://github.com/lquessenberry/downtime-checker)**, default branch `feat/globalstatus-prod`. Issues: https://github.com/lquessenberry/downtime-checker/issues

**Do not upload feature work to GoDaddy FTP.** FTP is go-live only, after a PR is on the fork and staging looks right. Church FTP is never used.

## First clone (Will)

You already have write access on this fork once you accept the GitHub invite.

```bash
git clone https://github.com/lquessenberry/downtime-checker.git
cd downtime-checker
git checkout feat/globalstatus-prod
```

The live PHP globe lives in `globalstatus/` (same files as `/home/will/.local/share/global-status/quietearth`). Copy a file here, do not STOR it to `107.180.116.144` for day-to-day edits.

## One issue, one branch, one PR

1. Pick an issue (tracker [#2](https://github.com/lquessenberry/downtime-checker/issues/2)). Disease is [#21](https://github.com/lquessenberry/downtime-checker/issues/21).
2. Branch from `feat/globalstatus-prod`:

```bash
git fetch origin
git checkout feat/globalstatus-prod
git pull
git checkout -b feat/issue-21-disease
# edit globalstatus/ …
git add -A
git commit -m "Add animal and human disease outbreak pins."
git push -u origin feat/issue-21-disease
```

3. Open a pull request **into `feat/globalstatus-prod`** on this fork (not into `willlccasey/downtime-checker` main, and not a direct FTP upload).
4. Staging preview: https://downtime-globe.fly.dev after Lee deploys the branch.
5. Go live on https://globalstatus.app only when someone says so (FTP Action, dry-run first).

## What not to mix

| Thing | Use |
| --- | --- |
| This fork + `feat/globalstatus-prod` | Global Status globe, issues, PRs |
| `willlccasey/downtime-checker` | Older Downtime CLI / Cesium PR target |
| `~/bin/downtime` :4173 | Different app |
| Fly `downtime-globe` | Staging preview |
| FTP `globalstatus@globalstatus.app` | Production go-live only |
