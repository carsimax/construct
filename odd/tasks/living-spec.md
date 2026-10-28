# Living spec

Objective: the user's words stay the spec: ambiguity is a visible state that blocks finishing, spec quotes are checked against the Log, and finished requirements merge into a living spec (ADD P1). Branch: feat/living-spec (sub-branches feat/living-spec-t<n>). Baseline: a56377f. Test runner: node --test 'tests/**/*.test.mjs'.

## Specs

- **S1 — Clarification state.** "De las decisiones que recomiendas" (L2: block at the gate). An `S#` may carry `NEEDS CLARIFICATION: <question>`. The publication gate denies a published ref whose feature document (read at the ref) has a task with Status `done` whose Specs cell names an `S#` that still carries the marker; the message names the doc, task, `S#`, and question, and says to ask the user and record the answer in the Log.
- **S2 — Visible clarifications.** "ok sigamos" (L1, proposed design). `feature-state.mjs` (after compaction or resume) lists the open clarifications of each active document (`S#` and question) and warns when one document has more than 3 open.
- **S3 — Quote provenance (warn only).** Each `S#` either contains at least one double-quoted span `"..."` whose whitespace-normalized text appears in the `## Log` section, or contains the word `Assumption`. `feature-state.mjs` warns, per document, naming the `S#` that fail. Assumption: curly quotes `“…”` count as double quotes.
- **S4 — Living spec.** When a feature's tasks are all finished, its `S#` (with their quotes) are added to `odd/spec.md` under a `## <feature>` heading. `feature-state.mjs` warns when a finished feature document in `odd/tasks/` has no `## <feature>` heading in `odd/spec.md`. Assumption: only for documents that also have a `## Specs` section. Feature documents are never deleted.
- **S5 — Starts empty.** "De las decisiones que recomiendas" (L2: no backfill). `odd/spec.md` starts with no features; existing finished documents are not backfilled, and the S4 warning applies only to documents created after this change. Assumption: `odd/spec.md` starts with a line `Started: <YYYY-MM-DD>` (set to 2026-10-29, so the documents begun before this change, including this one, are not backfilled); the S4 warning skips documents whose L1 date (`**L1 (<YYYY-MM-DD>):**`) is before it, and gives no warning at all while `odd/spec.md` does not exist.
- **S6 — Docs.** "ok sigamos" (L1, proposed design). Workflow skill (close step adds the living spec; the clarification rule with its cap of 3), feature-document reference (marker and quote rule), session contract (one line), METHODOLOGY P1 "Construct today", README, CHANGELOG.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1, S2, S3, S4, S5 | Acceptance tests by construct:oracle (RED) | oracle | 3 | done | 27dcac9 |
| T2 | S1, S2, S3, S4, S5 | Gate clarification check; feature-state clarifications, quote and living-spec warnings | worker | 3 | done | f05407f |
| T4 | S1, S4, S5 | Fixes found by running the hooks on this repository: a marker in inline code is not open; L1 dates with a suffix parse; an undated document is skipped | inline | 3 | done | 8cd66df |
| T3 | S6 | Docs and `odd/spec.md` | worker | 3 | done | 2da19dd |

## Log

- **L1 (2026-10-28):** "ok sigamos" (P1 of the ADD plan, design proposed in conversation: clarification state, quote provenance check, living spec).
- **L2 (2026-10-28):** "De las decisiones que recomiendas": the open clarification blocks at the gate; `odd/spec.md` starts empty, no backfill.
- **L3 (2026-10-28):** "mantener odd/spec.md". T1: 18 RED tests, locked.
- **L4 (2026-10-28):** Running the hooks on this repository found two bugs (T4): S1's own text, which names the marker in inline code, counted as an open clarification and would have blocked this feature's publication; L1 dates written as `(2026-10-22, user)` did not parse, so 14 old documents warned.
- Next step: review and the final PR.
