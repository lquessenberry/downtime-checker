# Overnight Copilot loop (Saturday night → Sunday 9 AM Central)

Lee's fork only: `lquessenberry/downtime-checker`. Default branch `feat/globalstatus-prod`.

## Rules
- Every **30 minutes** from midnight to **8:30 AM America/Chicago**.
- Quiet unless a PR merges, is stuck, or needs Lee.
- **No force-push.** Nothing to `willlccasey/downtime-checker`.
- A PR merges only when **all** are true:
  1. Copilot review is on the current head (`github__request_copilot_review`). If Copilot returns `NO_QUOTA_REMAINING`, **RUCKUS** reviews instead and says so on #75. That is the only substitute. Do not skip review.
  2. Blocking Copilot (or RUCKUS-fallback) comments are fixed or answered.
  3. CI is green on the PR.
  4. Base is `feat/globalstatus-prod` (do not merge #1 onto `feat/node-visualizer` into prod).
- Off after **9:00 AM Sunday** America/Chicago.

## #76
Already merged (`de12fc6`). Do not re-open. Do not force-push.

## Wrap (after last 30-min check, ~8:37 AM)
Deploy **this fork's default branch** to Fly staging:

```bash
git fetch origin feat/globalstatus-prod
git checkout feat/globalstatus-prod
fly deploy -c fly.gsa.toml --ha=false -a globalstatus-stage
curl -fsS -o /dev/null -w '%{http_code}\n' https://globalstatus-stage.fly.dev/
```

That is `globalstatus-stage`, not GoDaddy FTP, not `downtime-globe` (Node). Include the HTTP status in the morning summary.

## Open PRs to watch
| PR | Base | Note |
| --- | --- | --- |
| #32 | `feat/globalstatus-prod` | Eligible after Copilot + CI |
| #1 | `feat/node-visualizer` | **Do not** merge into prod; rust lives on `rust/native-core` |

## Morning summary
List: PRs merged, PRs stuck (missing Copilot / CI / comments), Fly URL + health, cycle 13 still open.
