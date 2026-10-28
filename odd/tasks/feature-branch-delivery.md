# Feature-branch delivery

Objective: large work is always delivered through one feature branch, split into smaller sub-branches by work unit (not by line count) that merge locally, with a single final pull request to the default branch; line-count budgets go away (ADD P2, as the user redefined it). Branch: feat/feature-branch-delivery. Baseline: 2039ea6. Test runner: node --test 'tests/**/*.test.mjs'.

## Specs

- **S1 — No line budgets.** "no quisiera que el comit lines bloquee flujos de trabajo grandes, mas bien quieriea que siempre estubiera apagado". `commit_lines` is never built. The `slice_lines` option and the commit-slice notice of delivery-signals are removed ("Quitarlo del todo"); the context backstop part of delivery-signals stays.
- **S2 — Feature branch always.** "hacer que esto funcione siempre por medio de feature-branch es decir nosotros dividir el trabajo en ramas mas pequeñas pero no delimintaddas po un numero de lineas especifica pero solo va llevar un pr final al repositorio". Large work lives on `feat/<feature>`; each task (or a cohesive group of tasks) gets a sub-branch `feat/<feature>-t<n>` cut from the feature branch, split by work unit, never by line count.
- **S3 — Local merge.** "Merge local". A sub-branch is reviewed (lenses when its Risk names an item) and merged locally into `feat/<feature>` with `git merge --no-ff`; it is never pushed as its own pull request. Assumption: sub-branches are not pushed at all.
- **S4 — One final PR.** The only pull request is `feat/<feature>` to the default branch; the publication gate reviews it cumulatively as today. The single-PR flow replaces the delivery strategies (`ask-on-risk`, `auto-chain`, `single-pr`, `exception-ok`) and the chain shapes (`stacked-to-main`, `feature-branch-chain`, tracker PRs, `size:exception`).
- **S5 — Visible state.** The delivery skill's context line shows the feature branch, the current sub-branch, and the sub-branches merged or pending, instead of commit-slice counts.
- **S6 — Docs.** Delivery skill and its references, the feature document format (header drops `Delivery strategy`), README, CONTRIBUTING, METHODOLOGY P2 "Construct today", CHANGELOG.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1, S5 | Remove commit-slice and `slice_lines` (delivery-signals, hooks.json, plugin.json, tests); skill-context delivery output shows the branch model | worker | 3 | pending | — |
| T2 | S2, S3, S4, S6 | Delivery skill and references, feature document format, README, CONTRIBUTING, METHODOLOGY P2, CHANGELOG | worker | 3 | pending | — |

## Log

- **L1 (2026-10-28):** "no quisiera que el comit lines bloquee flujos de trabajo grandes, mas bien quieriea que siempre estubiera apagado y mas bien hacer que esto funcione siempre por medio de feature-branch es decir nosotros dividir el trabajo en ramas mas pequeñas pero no delimintaddas po un numero de lineas especifica pero solo va llevar un pr final al repositorio"
- **L2 (2026-10-28):** Answers: sub-branches merge locally ("Merge local"); the 1500-line notice is removed entirely ("Quitarlo del todo").
- Known limit: the final review covers the whole feature diff, so a feature whose diff passes the 400 KB review-context budget cannot be published in one PR; T2 documents it.
- Next step: T1 through construct:worker.
