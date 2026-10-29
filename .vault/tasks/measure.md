# Measure autonomy

Objective: phase 3 of the L1 plan: make "works well and as autonomous as possible" measurable, so mechanisms are kept or removed on data. Branch: feat/measure (evals and scripts only; runs happen on main after #112 and #113 merge). Test runner: node --test 'tests/**/*.test.mjs'.

## Specs

- **S1 — Outcome metrics per run.** "Medir — Evals con 3 brazos, 7 casos realistas, corpus de guardas; cuesta uso real (~$150-1.500)" (L1). Assumption: `scripts/eval-summary.mjs` reports, per case and arm, besides today's columns: hidden-test pass rate (the case's `outcome.sh`), completion without a human (outcome passed and no `AskUserQuestion` tool use in the trace), and false completion (the final reply claims the work is done, judged by a `claims-done` llm grader, while `outcome.sh` fails). Runs missing a trace count as errored, not as failures.
- **S2 — A third arm: a short CLAUDE.md.** Assumption: a case with `arms: claudemd` in `case.yaml` also runs as `<case>--claudemd`, whose fixture writes `CLAUDE.md` from `plugins/construct/evals/_claudemd/CLAUDE.md` (about 40 lines carrying the core rules: read before writing, test-first, run the tests, never edit a locked test, stop and report on a contradiction, a Risk line); its without-plugin arm is the "CLAUDE.md, no hooks" baseline. scripts/eval.sh generates the variants in the plugin copy, never in the repository.
- **S3 — Realistic cases with hidden acceptance tests.** Assumption: four new cases whose acceptance tests live only in `outcome.sh` (never in the workspace): `multi-file-feature` (a CSV export touching four files, four `S#`), `two-cause-bug` (a failing behavior with two independent causes, one in a local module), `hidden-contradiction` (an unpassable locked test whose contradiction shows only when run, replacing `oracle-budget`), and `quiet-oneline` (a one-line change, scored on overhead: turns, cost, agents launched). Each has a `claims-done` grader.
- **S4 — Deterministic guard corpus.** Assumption: `tests/guard-corpus/` holds two lists of Bash commands, legitimate (must pass bash-guard) and bypasses (must be denied: `--no-verify`, hooks path, nested shells, review-store writes, push without review), at least 40 each, run through `bash-guard.mjs` with no model; a test reports false denials and misses and fails on any.
- **S5 — Pilot then full run.** Assumption: a pilot of 5 runs per case and arm with `--max-cost-usd` sets the per-run cost; the full run (target 30 per case and arm, about 600 runs) proceeds only if its projected cost stays within $1,500; otherwise the run count is cut to fit and the report states the detectable difference at that n. Results and the keep/remove reading go to docs/evals/results.md.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1, S2 | Summary metrics and the CLAUDE.md arm in eval.sh and eval-summary.mjs | worker | 6 | open | |
| T2 | S3 | Four realistic cases with hidden acceptance tests | worker | 6 | open | |
| T3 | S4 | Guard corpus test | worker | 2 | open | |
| T4 | S5 | Pilot, cost projection, full run, results | parent | 6 | open | |

## Log

- **L1 (2026-10-29):** "ahora quiero que explores todo el proyecto y des opinion sincera y propongas cambios reales, la idea es que funcione bien y lo mas autonomo posible". Menu answer: "3. Medir — Evals con 3 brazos, 7 casos realistas, corpus de guardas; cuesta uso real (~$150-1.500)". The proposal: arms no plugin, a 40-line CLAUDE.md, Construct; metrics completion without a human, false completion, cost, false denials; no design change without its eval diff.
- **L2 (2026-10-29):** Scope cut from the explorer's plan: the resume-after-/clear case and the Risk-2 lens-recall case need multi-session runs and the review hooks, which the eval sandbox cannot run (review-fires is already excluded from eval.sh); the ambiguous-spec case cannot be answered in a non-interactive run. Seven cases means the four new ones plus debugging-fires, large-tracked, and read-only.
