# Automation: coding and review loop

How bot work moves from an issue to `feat/globalstatus-prod` on
`lquessenberry/downtime-checker`. Upstream `willlccasey/downtime-checker` is never a target.

## Roles

| Who | Job |
| --- | --- |
| GLOBALSTATUS / WORLDSTATUS | Product and research developer: opens branches and PRs, fixes review comments |
| RUCKUS | Reviewer and bot manager: tests, licenses, guardrails, signs cycles on #75 |
| GitHub Copilot | Automated code review on every PR (required before merge) |
| Lee | Owner. Standing sprint approval lets bots merge when every gate below is green |

## The loop (one issue, one branch, one PR)

1. **Pick work** from the cycle table in `docs/GSA-CYCLE.md` / board [#75](https://github.com/lquessenberry/downtime-checker/issues/75).
2. **Branch** from `feat/globalstatus-prod`: `bot/<bot>/<issue>-<slug>` (for example `bot/worldstatus/63-delta-feed`), or the existing `feat/issue-<n>-<slug>` style.
3. **Open a PR** into `feat/globalstatus-prod`. Mark it draft until it builds.
4. **CI** (`.github/workflows/pr-ci.yml`):
   - JS syntax, PHP lint, every `scripts/**/test_*.py`
   - Guardrails: no credential files, no private nuke sim or Will's calculator, no GADM in the web build, no SPLC jsonl
   - Rust: `cargo test` (blocking), `fmt` and `clippy -D warnings` (advisory for now)
   - WebAssembly: release build of each wasm crate with a **gzip size budget** (`WASM_BUDGET_KB`, default 1024 KB)
   - The existing `gsa-morning-cycle.yml` still runs on globe paths
5. **Copilot review** (`.github/workflows/copilot-review.yml`): requested on open, reopen, sync and ready-for-review. Review guidance for Copilot is in `.github/copilot-instructions.md`.
6. **Address comments**: the authoring bot pushes fixes to the same branch and replies on each thread. Re-request Copilot (run the workflow manually with the PR number) when fixes go beyond the comments.
7. **Gate**: the `Copilot review gate` check passes only after Copilot has submitted a review.
8. **Merge** (squash, matching the repo's history) only when all of these hold:
   - CI is green
   - Copilot has reviewed and its blocking comments are addressed
   - RUCKUS has signed the cycle on #75
   - No FTP, Fly deploy or paid token was introduced

   Delete the branch after merge only if a bot created it.
9. **Record**: comment on #75 with `GLOBALSTATUS: pass|fail`, `RUCKUS: pass|fail`, the cycle number, and the PR and merge SHA.

Never: force-push, rewrite published history, push to upstream, merge with red CI, or merge without a Copilot review.

## Proposed repository settings (Lee applies; bots do not change these)

Settings → Rules → Rulesets → New branch ruleset `globalstatus-prod`:

- Target: default branch (`feat/globalstatus-prod`). Enforcement: Active.
- Bypass list: `lquessenberry` (repository admin), for emergencies only.
- Restrict deletions; block force pushes.
- Require a pull request before merging:
  - Required approvals: 0, so bots can still merge on Lee's standing approval
  - Dismiss stale approvals on new commits
  - Require conversation resolution
  - Allowed merge methods: squash, merge
- **Automatically request Copilot code review**: on, including **Review new pushes**.
- Require status checks to pass, with branches up to date:
  - `Web, PHP and Python checks`
  - `Rust fmt, clippy, test`
  - `WebAssembly build and size budget`
  - `Copilot review gate`
  - `One agile cycle`
- Optional, once the morning cycle settles: require linear history.

Repository variable: `GSA_CYCLE_ISSUE=75` (already used by the morning cycle).

## Cadence

- **Cycles** follow `docs/GSA-CYCLE.md`: one cycle per GLOBALSTATUS and RUCKUS sign-off pair, with a 2-hour scheduler. `gsa-morning-cycle.yml` fires weekdays at `20 12-17 * * 1-5` UTC.
- **Sprint** = 6 cycles. The cycle table batches 7–18 and 19–30, and each batch ends with a review-only cycle (19, 30).
- Bots check open PRs every cycle: CI status, then Copilot comments, then fixes, then merge if every gate is green.
