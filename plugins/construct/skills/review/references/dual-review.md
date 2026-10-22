# Dual review

Use it only when the user asks for a dual, adversarial, or blind review of a concrete target (a diff, a set of paths, a branch), or for a check of a plan, design, or claim. It replaces the lens review for that target, never both. Asking for it authorizes its fix rounds: do not ask again before fixing. No target, or an unclear one, gets one scope question, then stop until answered.

The lens hooks (`review-context`, `review-capture`, `publication-gate`) do not run here. Dual review records no verdict in the review store and gives no delivery authority; a Risk-named unit still needs its lenses before publication.

## Code mode

1. Freeze one target: the exact paths, or the commit range, as one immutable list. The same list goes to both judges and to the fixer; if the files change underneath, restart.
2. Launch `construct:judge-a` and `construct:judge-b` in parallel with the `Agent` tool, read-only, with the same prompt: the paths and nothing about the author, the intent, or each other. They judge correctness, edge cases, error handling, performance, security, and project conventions. Both must finish; relaunch one that failed. Their reply shape is in their agent files.
3. The parent alone merges. Give each finding an id (`F1`, `F2`, ...). Both judges report it: confirmed. One judge: suspect, never auto-fixed. The judges disagree on the same spot: a contradiction, left for a human. Only two-judge agreement corroborates. The ids and their status are the ledger.
4. Fix only confirmed BLOCKER and CRITICAL ids. Confirmed WARNING and SUGGESTION stay info. Send `construct:worker` one atomic work unit per id (or a tight group), with the confirmed finding ids and locations as the spec, a focused test or runtime evidence (or a justified N/A), the allowed edit surfaces, and a rollback boundary. Only the parent launches fixes and re-judgments.
5. Re-judge with the same two judges, scoped: they read the ledger, frozen and the fix delta, may record defects the fix caused, and nothing else.
6. Budget: at most 2 fix rounds and 2 scoped re-judgments. No third round.

## Verdict

End with one line: `JUDGMENT: APPROVED` when no confirmed severe finding remains, or `JUDGMENT: ESCALATED` when the budget ends with one or a contradiction stands. Then report:

- `target_identity`: sha256 of the frozen path list and tree
- `round`
- `confirmed`, `suspect`, `contradictions`, `info`: finding ids with locations
- `fix_work_units`
- `scoped_rejudgment`: yes or no
- `terminal_state`

## Decision mode

For a plan, design, or claim, not a trivial change. There is no fixer and nothing is written to the repository; the parent revises the artifact or asks the user.

1. CLAIM: write the artifact (the plan text) and its contract (what it must satisfy) to a numbered file made with `mktemp -d` outside the worktree. Report its path.
2. EXTRACT: launch both judges with the artifact and the contract only, never the claim or your reasoning.
3. DOUBT: each judge lists where the artifact fails its contract.
4. RECONCILE: sort every doubt in this order: contract misread, actionable, trade-off, noise. Never defer to a judge and never dismiss a doubt only by disagreeing with it. Revise the artifact for the actionable ones, and write the new version as the next numbered file.
5. STOP: APPROVED on a cycle with nothing substantive. At most 3 cycles. An unchanged artifact is a stall: decompose the problem, never extend the budget. Two cycles with substantive findings and none actionable: ESCALATE to the user.
