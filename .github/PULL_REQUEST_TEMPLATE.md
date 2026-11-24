## Summary

- Issue: #
- What changed:

## Checks for the author

- [ ] Branched from `feat/globalstatus-prod` on **lquessenberry/downtime-checker** (not Will’s upstream)
- [ ] I did **not** FTP these files to globalstatus.app by hand — the tests and the deploy are run by GitHub Actions
- [ ] I will merge only when the real tests are green: **Web, PHP and Python checks**, **Rust fmt, clippy, test**, **WebAssembly build and size budget**
- [ ] I know a red **Copilot review gate** is expected until December 1, 2026, and I can ignore it
- [ ] After merge, if this PR touches `globalstatus/`, I will watch the automatic deploy at [Deploy production FTP](https://github.com/lquessenberry/downtime-checker/actions/workflows/deploy-production-ftp.yml)
- [ ] Phone footer still uses color dots; written names stay in MENU
- [ ] No church FTP / cathedralbaptist paths

## How this PR gets to the live site

Opening this PR starts the tests automatically. Green means that test passed; red on a real test means fix it before merging. Merging into `feat/globalstatus-prod` is what publishes [globalstatus.app](https://globalstatus.app). To undo a bad publish, revert the PR and merge the revert (that deploys too). Note: the deploy only adds and overwrites files; it never deletes. Reverting a PR that added new files leaves those files on the server, so tell Lee if a revert needs files removed. Full walkthrough: [`docs/CONTRIBUTING-WILL.md`](../docs/CONTRIBUTING-WILL.md).

Staging previews, when Lee deploys one, are on Fly — not a substitute for the automatic production deploy above.
