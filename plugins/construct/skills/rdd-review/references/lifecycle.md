# Review lifecycle reference

State lives under the git common directory (`odd-review/`), never in the worktree. Every command prints JSON with a `state` field and a `next` list of the exact commands to run. Exit codes: 0 success, 1 refused transition (JSON on stderr), 2 bad usage.

## Commands

| Command | Purpose |
|---|---|
| `odd-review mode status` | Read-only: `{mode, source}` where source is clone, global, or default |
| `odd-review mode disable [--scope global\|clone]` | Turn RDD off (user request only) |
| `odd-review mode enable [--scope global\|clone]` | Turn RDD on (only when the user asks) |
| `odd-review boundary` | Last reviewed commit, or the branch point: `{commit, source}` |
| `odd-review start --base-ref B --committed-only` | Freeze a committed range and open a transaction with the lenses `odd-assess` assigns; prints `lineage`, `target`, per-lens `subject_hash`. A tier with no lenses refuses with `lenses_required` |
| `odd-review start` | Same for the uncommitted changes (no `--base-ref`) |
| `odd-review start ... --escalate-item N --escalate-reason TEXT` | Raise the tier to `high` first, as in `odd-assess`, so all four lenses apply; use it instead of `--lenses` when `odd-assess` was escalated |
| `odd-review start ... --lenses LIST --lenses-reason TEXT` | Explicit lenses, only when the user names them or asks to review a `medium` candidate |
| `odd-review context --lineage L --lens LENS` | Binding and frozen evidence for one lens, the refuter, or the validator. The PreToolUse hook runs it when a review agent is launched with the lineage id |
| `odd-review capture --lineage L --lens LENS --input -` | Store one lens result; reduces when all lenses are in. The SubagentStop hook runs it, and `capture-refuter` and `capture-validation`, with the agent's reply |
| `odd-review capture-refuter --lineage L --input -` | Store the refuter result |
| `odd-review correct --lineage L` | Register the one bounded correction (commit it first) |
| `odd-review capture-validation --lineage L --input -` | Store the validator result |
| `odd-review status --lineage L` | Read the transaction state |
| `odd-review acknowledge --lineage L` | Write the receipt; needs `approved` |

`LIST` is a comma-separated subset of `risk,resilience,readability,reliability`. `odd-assess --json` assesses the uncommitted changes. For a committed range add `--base-ref B --committed-only`. It takes `--base-ref`, `--committed-only`, `--escalate-item`, `--escalate-reason`, and `--json`.

## States and what to run

| State | Meaning | Action |
|---|---|---|
| `collecting` | Lens results pending | Launch each pending lens agent with the lineage id |
| `refutation_required` | Severe inferential findings | Launch `construct:review-refuter` with the lineage id |
| `correction_required` | Severe deterministic or corroborated findings | One correction, commit, `correct` |
| `validation_required` | Correction registered | Launch `construct:review-validator` with the lineage id |
| `approved` | No blocking findings | `acknowledge` |
| `escalated` | Blockers remain after the one correction | **Needs your decision** with the findings |

A refusal `context_budget_exceeded` means the evidence is over the byte budget: split the range into smaller commit slices. A refusal `correction_budget_exceeded` means the correction is larger than min(200, ceil(n/2)) of the reviewed lines; it does not consume the single correction. Make a smaller fix or escalate. A one-line candidate cannot fit any correction.

A `root` boundary source means no receipt and no default branch to diff against; do not review the whole history.

A refusal `target_already_acknowledged` means this exact target already has a receipt; no review is needed.

## Rules

- Only the frozen trees are evidence. Reviewers never read the live worktree.
- The correction is bounded in size by the transaction; stay inside the corroborated findings.
- Only blocking findings (BLOCKER or CRITICAL, introduced by the candidate) hold a review. Other findings are advisory follow-ups.
- Per-session Stop gate reminders do not change any of this; they only trigger the due check. The gate stays silent for a target with an open lineage that changed state in the last six hours.
- Normalize first: formatters and rewriting hooks run before `start`. A byte, path, or mode change after `start` is a new candidate.
- A review agent launched without a lineage id is denied by the PreToolUse hook; one whose context `odd-review` refuses is denied with that refusal.
