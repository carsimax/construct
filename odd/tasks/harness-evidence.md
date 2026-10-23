# Harness evidence

Objective: measure whether Construct improves outcomes and at what cost, before adding features. Branch: feat/harness-evidence. Baseline: bffdf50. Delivery strategy: single-pr. Test runner: `node --test tests/`.

## Specs

- **S1 — Cost and time per case and arm.** Plan T1: "`scripts/eval.sh` pasa a extraer por corrida los tokens, el costo y la duración [...] y a escribir un resumen (`summary.json` + tabla) por caso y por brazo (plugin / sin plugin)". Assumption (L2): `aggregate-result.json` carries `costUsd`, `durationSeconds`, and `turns` per run and no token counts, so the summary reports cost, duration, and turns; tokens are dropped.
- **S2 — Outcome graders, reported apart from ritual graders.** Plan T2: "Graders de **resultado** deterministas en los casos que hoy miden obediencia [...] Los graders de ritual se conservan y se reportan aparte". Assumption (L2): `claude plugin eval` 2.1.309 has no command grader, so an outcome check is a case's `outcome.sh <workspace>`, run by `scripts/eval.sh` after the eval for every run of both arms, from a fresh `mktemp -d` cwd; it copies the files it needs out of the workspace and runs a hidden `node --test` there (never git, npm, or anything that loads config inside the workspace); exit 0 is a pass. Workspace (L3): `dirname(dirname(tracePath))/sealed/home/cwd`, opened with `chmod 700` on the kept dir and `sealed`. Cases and checks (assumption, parent):
  - `small-delegated`, `small-delegated-pressure`: `subtract(5, 3) === 2`, `subtract(2, 5) === -3`, `add(2, 3) === 5`; the agent's `math.test.js` passes and names `subtract`.
  - `debugging-fires`: `paginate(['a','b','c','d','e'], p, 2)` gives `['a','b']`, `['c','d']`, `['e']`, `[]` for p = 1..4.
  - `memory-recall`: under `TZ=America/Mexico_City`, `formatLogTime(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))` contains `2026-01-02T03:04:05`.
  - No outcome check (process is the value): `large-tracked`, `read-only`, `debugging-stays-quiet`, `review-fires`.
  - The summary shows ritual pass rate (the eval's `passed`) and outcome pass rate (blank without `outcome.sh`) side by side.
- **S3 — Baseline.** Plan T3: "7 casos × 10 corridas × 2 brazos sobre `bffdf50`, registrado en el Log". Estimated cost $15–20, unverified. Phase stop: "**punto de parada:** te presento la tabla".

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1 | Summary of cost, duration, turns, pass rates per case and arm from `aggregate-result.json` | worker | none | done (RED 6 fail; evals 9/9; suite 1061/0) | 54476a1 |
| T2 | S2 | `outcome.sh` per outcome-bearing case, run by `scripts/eval.sh` on kept workspaces; outcome vs ritual rates in the summary | worker | 6 | done (fixture right/untouched/wrong per case; real eval L4) | 54476a1 |
| T3 | S3 | Baseline run, 10 runs per case and arm, table in the Log | parent | none | done (160 runs, $16.42 + $0.31 judge; L5) | 9297e6f |

## Log

- **L1 (2026-10-22, user):** "Vamos con la fase 1" (after the plan "de 'cumple el ritual' a 'demuestra que vale'", Phase 1 = T1–T3; D1–D3 apply to later phases).
- **L2 (2026-10-22, parent):** Old results (L7 of construct-native) show per-run `costUsd`, `judgeCostUsd`, `durationSeconds`, `turns`, `score`, `passed`, per-grader `passed` and `withOnly`; no tokens. `claude plugin eval --help` (2.1.309): grader types `regex | tool_order | tool_used | file_exists | llm | baseline`, no command grader, no teardown; `--keep-temp` preserves scaffold dirs, `-j` up to 8, `--json <path>` writes the full result.

- **L3 (2026-10-22, parent):** Probe `scripts/eval.sh --case small-delegated --ablation none --keep-temp` ($0.19, 24 s, passed): kept dir `/private/tmp/e-cucn3L` (`dr-x------`), `out/trace.jsonl` = `tracePath`, workspace sealed (mode 000) at `sealed/home/cwd`; the tool warns not to run git or anything that loads config from its working directory inside it. T1 and T2 share files: one worker, in sequence.

- **L4 (2026-10-22, parent):** T1 and T2 in one commit (they share eval.sh and the test file). Real smoke `scripts/eval.sh --case debugging-fires` ($0.21): outcomes.json written, table printed; with: ritual 100% outcome 100% $0.155 26 s; without: ritual 0% outcome 100% $0.052 10 s. A repeated `--case` keeps only the last.

- **L5 (2026-10-22, parent):** T3 baseline on 5ef4031 (plugin unchanged since bffdf50): `scripts/eval.sh --runs 10 -j 4 --max-cost-usd 30`, 160 runs, 0 errored, agent $16.42, judge $0.31, 14 min wall.

  | case | arm | ritual | outcome | cost $ | time s | turns |
  |---|---|---|---|---|---|---|
  | debugging-fires | with | 70% | 100% | 0.153 | 30.6 | 3.6 |
  | debugging-fires | without | 0% | 100% | 0.052 | 9.4 | 5.0 |
  | debugging-stays-quiet | with | 100% | | 0.085 | 16.8 | 4.9 |
  | debugging-stays-quiet | without | 90% | | 0.049 | 11.8 | 2.4 |
  | large-tracked | with | 100% | | 0.281 | 70.9 | 5.0 |
  | large-tracked | without | 0% | | 0.088 | 20.1 | 10.7 |
  | memory-recall | with | 90% | 90% | 0.183 | 44.0 | 2.6 |
  | memory-recall | without | 0% | 50% | 0.076 | 17.4 | 7.8 |
  | read-only | with | 100% | | 0.073 | 6.5 | 2.8 |
  | read-only | without | 100% | | 0.045 | 5.7 | 2.8 |
  | review-fires | with | 30% | | 0.115 | 24.8 | 4.3 |
  | review-fires | without | 0% | | 0.051 | 15.0 | 3.0 |
  | small-delegated | with | 100% | 100% | 0.139 | 22.2 | 2.2 |
  | small-delegated | without | 0% | 100% | 0.056 | 8.5 | 6.7 |
  | small-delegated-pressure | with | 100% | 100% | 0.142 | 21.6 | 3.1 |
  | small-delegated-pressure | without | 0% | 100% | 0.058 | 8.1 | 7.0 |

  Plugin-arm grader failures /10: debugging-fires regression-test 3; memory-recall follows-decision 1, iso-utc 1; review-fires review-risk-launched 7, reports-verdict 7, no-push-before-lens 3. `debugging` skill fired 10/10 (was 0/3 in construct-native L7). Reading: outcome equal (100%/100%) on the three code cases, plugin +40 pp only on memory-recall (a plugin-only capability); plugin arm costs 1.6-3.0x and takes 1.1-3.6x the time; review-fires launches the risk lens 3/10, and its sandbox has no working git (construct-native L16), so that case is not yet trustworthy.

Next step: present the table to the user (phase stop); Phase 2 per the plan only after their decision.
