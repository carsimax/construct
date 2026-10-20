# odd-assess: Node module sources and permission decisions

Branch `feat/assess-node-modules`, baseline `1513d62` (main).

## Specs

- **S1 — JavaScript module extensions are source.** `.mjs`, `.cjs`, `.mts`, and `.cts` files get the same rules as `.js` and `.ts`: name eligibility, content scan (`process_boundary`), dangerous sinks, and comment syntax. Evidence: `odd-assess --base-ref 1063f6f --committed-only` on `3a13356` rated `medium` with only `executable_change:.gitignore`, although `hooks/scripts/review-context.mjs` and `review-capture.mjs` add `node:child_process` and `spawnSync`. Cause: `SEMANTIC_SOURCE_EXTENSIONS` (`lib/assess/signals.mjs:6`) and the sink and comment extension lists in `lib/assess/sinks.mjs` omit them.
- **S2 — Permission decisions are evidence.** An added, non-comment line in a scanned non-test source file that names a Claude Code hook `permissionDecision` (setting or reading it) is reason `permission_decision` with signal `permissions` (tier `high`). Source: the review-determinism backlog item "the classifier does not flag Node hook scripts that spawn processes or decide permissions" (`odd/tasks/review-determinism.md` L9), taken up by the user: "ok vamos con el siguiente punto".
- **S3 — Docs.** The README odd-assess section states both rules.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1, S3 | Extension lists in `signals.mjs` and `sinks.mjs`; cases in `tests/assess/fixtures.mjs` | inline | 2 | done | `5d85143` |
| T2 | S2, S3 | `permission_decision` in `content.mjs`; cases in `tests/assess/fixtures.mjs` | inline | 2 | done | see L3 |

Route evidence: one small sequential unit per spec; no Writer trigger. Risk item 2: `odd-assess` is the guard that decides whether a change gets reviewed.

## Log

- **L1 (2026-10-20, user):** "ok vamos con el siguiente punto" — follow-up 1 of the review-determinism backlog.
- **L2 (2026-10-20):** T1 done. RED: 6 of 8 new cases failed (`.mjs`/`.cjs`/`.mts`/`.cts` spawn and sink cases, `.mjs` service token rated `medium`); the `hot_path` case already passed (name-only rule) and the comment case passed vacuously. GREEN after adding the four extensions to `SEMANTIC_SOURCE_EXTENSIONS` and to every JS/TS list in `sinks.mjs`. `node --test tests/`: 542 pass.
- **L3 (2026-10-20):** T2 done. RED: the 3 positive `permission_decision` cases failed; the 4 negatives (comment, test file, `.txt` prose, longer identifier) passed. GREEN after `PERMISSION_DECISION_LINE` in `content.mjs`, limited to semantic source extensions and non-comment added lines. `node --test tests/`: 549 pass. Re-assessing `1063f6f..3a13356` now gives `high` with `permission_decision` (`review-context.mjs`) and `process_boundary` (`review-capture.mjs`), with no escalation.
- **L4 (2026-10-20):** odd-verify: S1, S2, S3 PASS, no blockers. Its probes are now fixture cases (member access, code after a closed block comment, uppercase extension, `$`-prefixed name, block comment, block-comment continuation, `.cjs` TLS sink, `.mts` block comment); they pass without a code change (pinning, no RED). `node --test tests/`: 557 pass. Advisories kept as known limits, unchanged from the baseline behavior of `process_boundary`: files under `tests/` that are not named `*.test.*`/`*.spec.*` count as non-test; a block-comment body line without a leading `*` and a trailing `//` comment are read as code (errs toward `high`); a `PermissionRequest` `decision.behavior` is outside S2. This branch is `high` under its own rule, so an RDD review is due.
