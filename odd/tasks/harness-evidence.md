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
| T1 | S1 | Summary of cost, duration, turns, pass rates per case and arm from `aggregate-result.json` | worker | none | done (RED 6 fail; evals 9/9; suite 1061/0) | COMMIT |
| T2 | S2 | `outcome.sh` per outcome-bearing case, run by `scripts/eval.sh` on kept workspaces; outcome vs ritual rates in the summary | worker | 6 | done (fixture right/untouched/wrong per case; real eval L4) | COMMIT |
| T3 | S3 | Baseline run, 10 runs per case and arm, table in the Log | parent | none | pending | — |

## Log

- **L1 (2026-10-22, user):** "Vamos con la fase 1" (after the plan "de 'cumple el ritual' a 'demuestra que vale'", Phase 1 = T1–T3; D1–D3 apply to later phases).
- **L2 (2026-10-22, parent):** Old results (L7 of construct-native) show per-run `costUsd`, `judgeCostUsd`, `durationSeconds`, `turns`, `score`, `passed`, per-grader `passed` and `withOnly`; no tokens. `claude plugin eval --help` (2.1.309): grader types `regex | tool_order | tool_used | file_exists | llm | baseline`, no command grader, no teardown; `--keep-temp` preserves scaffold dirs, `-j` up to 8, `--json <path>` writes the full result.

- **L3 (2026-10-22, parent):** Probe `scripts/eval.sh --case small-delegated --ablation none --keep-temp` ($0.19, 24 s, passed): kept dir `/private/tmp/e-cucn3L` (`dr-x------`), `out/trace.jsonl` = `tracePath`, workspace sealed (mode 000) at `sealed/home/cwd`; the tool warns not to run git or anything that loads config from its working directory inside it. T1 and T2 share files: one worker, in sequence.

- **L4 (2026-10-22, parent):** T1 and T2 in one commit (they share eval.sh and the test file). Real smoke `scripts/eval.sh --case debugging-fires` ($0.21): outcomes.json written, table printed; with: ritual 100% outcome 100% $0.155 26 s; without: ritual 0% outcome 100% $0.052 10 s. A repeated `--case` keeps only the last.

Next step: T3 baseline.
