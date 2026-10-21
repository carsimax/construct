# Review lifecycle reference

State lives under the git common directory (`odd-review/`), never in the worktree. Every command prints JSON with a `state` field and a `next` list of the exact commands to run. Exit codes: 0 success, 1 refused transition (JSON on stderr), 2 bad usage.

## Commands

| Command | Purpose |
|---|---|
| `odd-review mode status` | Read-only: `{mode, source}` where source is clone, global, or default |
| `odd-review mode disable [--scope global\|clone]` | Turn RDD off (user request only) |
| `odd-review mode enable [--scope global\|clone]` | Turn RDD on (only when the user asks) |
| (any change command while RDD is off) | `start`, `capture*`, `correct`, `acknowledge`, `abandon`, `invalidate` refuse with `rdd_disabled`; do not retry, and enable the switch only when the user asks. `status`, `context`, `validate`, `boundary`, `mode` still work |
| `odd-review boundary` | Last reviewed commit, or the branch point: `{commit, source}` |
| `odd-review start --base-ref B --committed-only` | Freeze a committed range and open a transaction with the lenses `odd-assess` assigns; prints `lineage`, `target`, per-lens `subject_hash`. A tier with no lenses refuses with `lenses_required` |
| `odd-review start` | Same for the uncommitted changes (no `--base-ref`) |
| `odd-review start ... --escalate-item N --escalate-reason TEXT` | Raise the tier to `high` first, as in `odd-assess`, so all four lenses apply; use it instead of `--lenses` when `odd-assess` was escalated |
| `odd-review start ... --lenses LIST --lenses-reason TEXT` | Explicit lenses, only when the user names them |
| `odd-review start ... --request-context FILE` | Freeze the request or spec text (at most 32 KiB; refusals `request_context_too_large`, `_empty`, `_unreadable`) with its sha256; `context` shows it to every lens, before the patches. Write the feature document's relevant `S#` block to a scratch file and pass it |
| `odd-review start --focus LENS` | A `medium` candidate the user asked to review gets that one lens (a `high` one keeps all four); not with `--lenses` |
| `odd-review context --lineage L --lens LENS` | Binding and frozen evidence for one lens, the refuter, or the validator. The PreToolUse hook runs it when a review agent is launched with the lineage id |
| `odd-review capture --lineage L --lens LENS --input -` | Store one lens result; reduces when all lenses are in. The SubagentStop hook runs it, and `capture-refuter` and `capture-validation`, with the agent's reply |
| `odd-review capture-refuter --lineage L --input -` | Store the refuter result |
| `odd-review correct --lineage L` | Register the one bounded correction (commit it first) |
| `odd-review capture-validation --lineage L --input -` | Store the validator result |
| `odd-review capture-unachievable --lineage L --lens LENS --reason TEXT` | A selected lens cannot run; the transaction becomes `escalated` (`lens_unachievable`) |
| `odd-review status --lineage L` | Read the transaction state, the `counters`, and, once acknowledged, `receipt_check` |
| `odd-review abandon --lineage L [--reason TEXT]` | Close an open review for good (terminal `abandoned`, no receipt) |
| `odd-review invalidate --lineage L --reason TEXT` | Close a review no lens has touched (terminal `invalidated`); otherwise refused `not_pristine` |
| `odd-review acknowledge --lineage L` | Write the receipt; needs `approved` |
| `odd-review validate --gate pre-push\|pre-pr\|release [--base-ref B] [--head-ref H] [--tag T]` | The publication gate: exit 0 `ok`, or exit 1 `review_required` when the committed range being published is high risk without a sound receipt for its tree. The hook runs it before `git push`, `gh pr create`, and `gh release create` |

`LIST` is a comma-separated subset of `risk,resilience,readability,reliability`. `odd-assess --json` assesses the uncommitted changes. For a committed range add `--base-ref B --committed-only`. It takes `--base-ref`, `--committed-only`, `--escalate-item`, `--escalate-reason`, and `--json`.

## States and what to run

| State | Meaning | Action |
|---|---|---|
| `collecting` | Lens results pending | Launch each pending lens agent with the lineage id |
| `refutation_required` | Severe inferential findings (a `unknown` or `insufficient` severe finding escalates instead). A refuter `inconclusive` goes to correction, not advisory | Launch `construct:review-refuter` with the lineage id |
| `correction_required` | Severe deterministic or corroborated findings | One correction, commit, `correct` |
| `validation_required` | Correction registered; an `inconclusive` validation may be captured again, up to 3 attempts, the 3rd escalates | Launch `construct:review-validator` with the lineage id |
| `approved` | No blocking findings | `acknowledge` |
| `escalated` | Blockers remain after the one correction, a second batch was asked for (`budget_exhausted`), or a lens could not run (`lens_unachievable`) | **Needs your decision** with the findings. For severe `unknown` or `insufficient` findings, `reason` is `unknown_causality` with only those ids in `finding_ids`, or `insufficient_evidence` when none is `unknown`; in a mix, the `insufficient` ids are listed separately in `insufficient_finding_ids` |
| `abandoned`, `invalidated` | Closed by the user's decision; no receipt | Nothing; `start` again if a review is still wanted |

A refusal `context_budget_exceeded` means the evidence is over the byte budget: split the range into smaller commit slices. A refusal `correction_budget_exceeded` means the correction is larger than min(200, ceil(n/2)) of the reviewed lines, never below 2; it does not consume the single correction. Make a smaller fix or escalate.

The counters `full_reviews`, `refuter_batches`, `fix_batches`, `scoped_fix_validations`, and `final_verifications` are one-shot: a second batch of a kind in a live review makes it `escalated` with `reason: budget_exhausted` and the counter's name. Only `full_reviews` (all lenses captured), `refuter_batches` (`capture-refuter`), `fix_batches` (`correct`), and `scoped_fix_validations` (`capture-validation`) have a command; this lifecycle has no final verification step, so `final_verifications` stays 0. The receipt records `paths_digest`, `policy_hash`, `ledger_hash`, `evidence_hash`, and `fix_delta_hash`; `status` recomputes them and reports `receipt_check.status` as `ok`, `mismatch` (with the field names), `legacy`, `missing`, or `unreadable`. A mismatch means the transaction or receipt changed after the acknowledgement: report it, never repair it.

A `root` boundary source means no receipt and no default branch to diff against; do not review the whole history.

A refusal `target_already_acknowledged` means this exact target already has a sound receipt; no review is needed. A damaged or legacy receipt does not trigger it, and `acknowledge` replaces it.

## Rules

- Only the frozen trees are evidence. Reviewers never read the live worktree.
- The correction is bounded in size by the transaction; stay inside the corroborated findings.
- Only blocking findings (BLOCKER or CRITICAL, introduced by the candidate) hold a review. Other findings are advisory follow-ups.
- Per-session Stop gate reminders do not change any of this; they only trigger the due check. The gate stays silent for a target with an open lineage that changed state in the last six hours.
- Normalize first: formatters and rewriting hooks run before `start`. A byte, path, or mode change after `start` is a new candidate.
- A review agent launched without a lineage id is denied by the PreToolUse hook; one whose context `odd-review` refuses is denied with that refusal.
