# Review lifecycle reference

State lives under the git common directory (`odd-review/`), never in the worktree. Every command prints JSON with a `next` field naming the exact command to run. Exit codes: 0 success, 1 refused transition (JSON on stderr), 2 bad usage.

## Commands

| Command | Purpose |
|---|---|
| `odd-review mode status` | Read-only: `{mode, source}` where source is clone, global, or default |
| `odd-review mode disable [--scope global\|clone]` | Turn RDD off (user request only) |
| `odd-review mode enable [--scope global\|clone]` | Turn RDD on (only when the user asks) |
| `odd-review boundary` | Last reviewed commit, or the branch point: `{commit, source}` |
| `odd-review start --base-ref B --committed-only --lenses LIST --lenses-reason TEXT` | Freeze the candidate and open a transaction; prints `lineage`, `target`, per-lens `subject_hash` |
| `odd-review context --lineage L --lens LENS` | Binding and frozen evidence for one lens, the refuter, or the validator |
| `odd-review capture --lineage L --lens LENS --input -` | Store one lens result; reduces when all lenses are in |
| `odd-review capture-refuter --lineage L --input -` | Store the refuter result |
| `odd-review correct --lineage L` | Register the one bounded correction (commit it first) |
| `odd-review capture-validation --lineage L --input -` | Store the validator result |
| `odd-review status --lineage L` | Read the transaction state |
| `odd-review acknowledge --lineage L` | Write the receipt; needs `approved` |

`LIST` is a comma-separated subset of `risk,resilience,readability,reliability`. `odd-assess` takes `--base-ref`, `--committed-only`, `--escalate-item`, `--escalate-reason`, and `--json`.

## States and the `next` action

| State | Meaning | Action |
|---|---|---|
| `collecting` | Lens results pending | Context, agent, capture per pending lens |
| `refutation_required` | Severe inferential findings | Refuter context, agent, `capture-refuter` |
| `correction_required` | Severe deterministic or corroborated findings | One correction, commit, `correct` |
| `validation_required` | Correction registered | Validator context, agent, `capture-validation` |
| `approved` | No blocking findings | `acknowledge` |
| `escalated` | Blockers remain after the one correction | **Needs your decision** with the findings |

A refusal `context_budget_exceeded` means the evidence is over the byte budget: split the range into smaller commit slices. A refusal `target_already_acknowledged` means this exact target already has a receipt; no review is needed.

## Rules

- Only the frozen trees are evidence. Reviewers never read the live worktree.
- The correction is bounded in size by the transaction; stay inside the corroborated findings.
- Only blocking findings (BLOCKER or CRITICAL, introduced by the candidate) hold a review. Other findings are advisory follow-ups.
- Per-session Stop gate reminders do not change any of this; they only trigger the due check.
