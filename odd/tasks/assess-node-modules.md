# odd-assess: Node module sources and permission decisions

Branch `feat/assess-node-modules`, baseline `1513d62` (main).

## Specs

- **S1 — JavaScript module extensions are source.** `.mjs`, `.cjs`, `.mts`, and `.cts` files get the same rules as `.js` and `.ts`: name eligibility, content scan (`process_boundary`), dangerous sinks, and comment syntax. Evidence: `odd-assess --base-ref 1063f6f --committed-only` on `3a13356` rated `medium` with only `executable_change:.gitignore`, although `hooks/scripts/review-context.mjs` and `review-capture.mjs` add `node:child_process` and `spawnSync`. Cause: `SEMANTIC_SOURCE_EXTENSIONS` (`lib/assess/signals.mjs:6`) and the sink and comment extension lists in `lib/assess/sinks.mjs` omit them.
- **S2 — Permission decisions are evidence.** An added, non-comment line in a scanned non-test source file that sets a Claude Code hook `permissionDecision` is reason `permission_decision` with signal `permissions` (tier `high`). Source: the review-determinism backlog item "the classifier does not flag Node hook scripts that spawn processes or decide permissions" (`odd/tasks/review-determinism.md` L9), taken up by the user: "ok vamos con el siguiente punto".
- **S3 — Docs.** The README odd-assess section states both rules.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1, S3 | Extension lists in `signals.mjs` and `sinks.mjs`; cases in `tests/assess/fixtures.mjs` | inline | 2 | pending | |
| T2 | S2, S3 | `permission_decision` in `content.mjs`; cases in `tests/assess/fixtures.mjs` | inline | 2 | pending | |

Route evidence: one small sequential unit per spec; no Writer trigger. Risk item 2: `odd-assess` is the guard that decides whether a change gets reviewed.

## Log

- **L1 (2026-10-20, user):** "ok vamos con el siguiente punto" — follow-up 1 of the review-determinism backlog.
