# Contributing (Global Status App)

Work happens on the fork **[lquessenberry/downtime-checker](https://github.com/lquessenberry/downtime-checker)**, default branch `feat/globalstatus-prod`. Issues: https://github.com/lquessenberry/downtime-checker/issues

**Will (and anyone shipping globe work):** start with the plain-language guide [`docs/CONTRIBUTING-WILL.md`](docs/CONTRIBUTING-WILL.md). The code runs the tests and the production deploy. Do not FTP files to globalstatus.app by hand anymore. Church FTP is never used.

## First clone (Will)

You already have write access on this fork once you accept the GitHub invite.

```bash
git clone https://github.com/lquessenberry/downtime-checker.git
cd downtime-checker
git checkout feat/globalstatus-prod
```

The live PHP globe lives in `globalstatus/`. Edit files here and open a PR; never upload to the production server by hand.

Only files checked into `globalstatus/` are published. Rust and WASM jobs must pass before a deploy, but their build output is not uploaded, so a change that touches only `rust/` does not change the live site.

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
4. Staging preview: https://downtime-globe.fly.dev only if Lee deploys that branch to Fly. Staging is optional and is not the production publish.
5. Go live on https://globalstatus.app by **merging the PR** once the real tests are green (ignore a red Copilot review gate until Dec 1). Merge automatically deploys the globe over FTP. Watch it: https://github.com/lquessenberry/downtime-checker/actions/workflows/deploy-production-ftp.yml

## What not to mix

| Thing | Use |
| --- | --- |
| This fork + `feat/globalstatus-prod` | Global Status globe, issues, PRs |
| `willlccasey/downtime-checker` | Older Downtime CLI / Cesium PR target |
| `~/bin/downtime` :4173 | Different app |
| Fly `downtime-globe` | Staging preview |
| Production upload (FTP, credentials in repo secrets) | Automatic production deploy after a green merge (do not FTP by hand) |
