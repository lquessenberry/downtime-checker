# A plain guide for Will: tests, merge, and going live

This is the easy path for globe work. You do not need to be a developer-ops person, and Grok Bot can do the GitHub clicks with you. **The code now runs the tests and the deploy.** You should not FTP files to globalstatus.app by hand anymore.

Work only on the fork [lquessenberry/downtime-checker](https://github.com/lquessenberry/downtime-checker), on pull requests into the branch `feat/globalstatus-prod`. Do not push to `willlccasey/downtime-checker`, and do not upload the church site.

## 1. Open a pull request

Put your change on a branch, then open a pull request **into `feat/globalstatus-prod`**. GitHub (and Grok Bot) can do this. As soon as the PR is open, the code starts running tests on it. You do not start the tests yourself.

Watch the checks at the bottom of the PR, or on the [Actions](https://github.com/lquessenberry/downtime-checker/actions) tab.

## 2. What each check means

A **green** check means that test passed. A **red** check means that test failed and the change should be fixed before you merge. A **skipped** or grey check is just “not needed this time.”

These are the real tests. They must be green before you merge:

- **Web, PHP and Python checks** — the globe’s JavaScript and PHP are valid, the Python tests pass, and the repo is not holding secrets or private simulator files.
- **Rust fmt, clippy, test** — the Rust code’s automated tests pass. (Formatting and clippy warnings may still show as notes; the test itself is the one that matters.)
- **WebAssembly build and size budget** — the in-browser Rust/WASM build still compiles and stays under the size budget.

These may also appear, and you can ignore or treat them as extra:

- **Copilot review gate** — this will often be **red until December 1, 2026**. That is expected. Copilot is out of review quota. **It does not mean your code failed, and it does not block the automatic deploy.** You can still merge once the real tests above are green.
- **Request Copilot review** — just asks Copilot to look; a green here only means the request was sent.
- **One agile cycle** / **Chrome CDP on laptop** — an extra product check; the laptop Chrome step is often skipped. It is not the production deploy.

## 3. Merge once the real tests are green

When **Web, PHP and Python**, **Rust**, and **WebAssembly** are green, you can merge the pull request on GitHub (the green “Merge pull request” button). Ignore a red Copilot review gate until December 1.

Merging is what publishes the site. You do not FTP anything.

## 4. Merging automatically deploys to globalstatus.app

After the PR lands on `feat/globalstatus-prod`, if it changed the live globe (`globalstatus/` files) or the FTP script, GitHub Actions runs those same real tests again on the merged commit. If they pass, the **Deploy production FTP** workflow uploads the globe to [https://globalstatus.app](https://globalstatus.app). It does not use a dry-run, and it does not upload data caches.

Watch the deploy here:

https://github.com/lquessenberry/downtime-checker/actions/workflows/deploy-production-ftp.yml

Open the run and read the summary: it lists the commit, which tests were green, and which files were uploaded. If a real test is red on that commit, nothing is uploaded.

Manual “Run workflow” on that same page is still there for emergencies. Its default is a **dry-run** (it lists files and does not upload), same as before.

## 5. If something goes wrong, roll back

Do not try to “undo” the site with a one-off FTP. On the merged PR, use GitHub’s **Revert** to open a new PR that takes the change out, then merge that once its tests are green. That revert will deploy automatically the same way, and globalstatus.app will go back to the previous globe for every file the PR changed. Note: the deploy only adds and overwrites files; it never deletes. Reverting a PR that added new files leaves those files on the server, so tell Lee if a revert needs files removed.

Only files in `globalstatus/` are published. A change that touches only `rust/` runs the tests but does not change the live site.

## Remember

**Don’t FTP by hand anymore. The code runs the tests and the deploy.**
