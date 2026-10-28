# Hardening

Objective: make the evals measure what they claim, record a three-run baseline for 13.x, and close the small follow-ups left by ADD P1-P5. Branch: feat/hardening (sub-branches feat/hardening-t<n>). Baseline: 65eb036. Test runner: node --test 'tests/**/*.test.mjs'.

## Specs

- **S1 — large-tracked measures the document.** "Vamos con el punto 1 y 2" (L1). The `document-sections` grader passes when the agent's feature document under `.vault/tasks/` has `## Specs`, `## Tasks`, and `## Log`, and fails when it does not. Assumption: the current regex fails in every run because of how the trace records the written file; the fix is verified against a real trace, not only a synthetic one.
- **S2 — review-fires measures review or leaves the suite.** "Vamos con el punto 1 y 2" (L1). Either the case runs the publication flow in the eval sandbox and its grader sees `review-risk` launched, or it is removed and `scripts/probe-review.sh` is documented as the live check. Assumption: removing it is acceptable when the sandbox cannot run git.
- **S3 — Three-run baseline.** "Vamos con el punto 1 y 2" (L1). After S1-S2, the full suite runs three times per case and arm on this branch, and `docs/evals/results.md` records it as the 13.x baseline.
- **S4 — Follow-ups.** "Vamos con el punto 1 y 2" (L1). (a) A sub-branch with no commits of its own is not shown as merged in the delivery context. (b) A finished feature document named `README.md` is warned about by the living-spec check like any other (it does not collide with `.vault/specs/README.md`). (c) A gate-level test shows a `NEEDS CLARIFICATION` marker written in inline code does not deny. (d) A test covers the `ls-remote` timeout path keeping the lock. (e) `construct-gate oracle unlock ./path` and other equivalent spellings unlock the stored path. (f) surface-guard does not run git on edits when the review store holds no oracle locks.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1, S2 | Fix the large-tracked grader; make review-fires measurable or remove it | worker | none | pending | — |
| T2 | S4 | Follow-ups (a)-(f) in hooks, CLI, and tests | worker | 2, 3 | pending | — |
| T3 | S3 | Three-run baseline and `docs/evals/results.md` | inline | none | pending | — |

## Log

- **L1 (2026-10-28):** "Vamos con el punto 1 y 2" (point 1: fix the measurement and a three-run baseline; point 2: the accumulated small follow-ups).
- Next step: T1 on feat/hardening-t1 and T2 on feat/hardening-t2 in parallel.
