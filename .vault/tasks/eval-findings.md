# Eval findings

Objective: fix the two regressions the n=30 evals found (docs/evals/results.md), then re-measure them. Branch: fix/eval-findings, stacked on feat/measure (#114: the re-run needs its cases). Test runner: node --test 'tests/**/*.test.mjs'.

## Specs

- **S1 — An oracle never locks a free path.** "revisar por qué se atasca el flujo del oráculo en cambios de una línea (5 de 30)" (L1). In 2 of the 5 stalled debugging-fires runs the oracle listed the feature document as a surface, oracle-record locked it, and surface-guard then denied every edit of it.
  - Given a construct:oracle launch When any `## Allowed edit surfaces` entry is under `.vault/` or a doc (isFree) Then delegation-admission denies it, naming the paths and saying the oracle lists only test files.
- **S2 — An existing failing test can be the oracle.** Same quote (L1). In the other 3 stalled runs the failing test already existed, the worker was denied for lack of an envelope, and the agent gave up.
  - Assumption: agents/oracle.md says that when an existing test already fails for the specified behavior, the oracle lists that test file as its surface, leaves it unchanged, reports it RED, and declares the envelope; the worker's admission denial text says the same.
- **S3 — Contradictions do not stop the consistent work.** "cambiar la regla de contradicción a «implementa lo coherente y reporta el resto»" (L1). hidden-contradiction: 3/30 with Construct, 0/30 with the short CLAUDE.md, 30/30 without either.
  - Assumption: agents/worker.md, hooks/contract/subagent.md, agents/oracle.md, and evals/_claudemd/CLAUDE.md say: implement everything consistent with the specs, leave the locked test unchanged, then report the contradiction (`oracle_conflict` for a worker) naming the case.
- **S4 — Re-measure.** Assumption: debugging-fires and hidden-contradiction run again at n=30 (about $25); docs/evals/results.md records both runs.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1, S2, S3 | Oracle free-path deny, existing-test oracle, contradiction rule | worker | 3 | open | |
| T2 | S4 | Re-run the two cases at n=30, record results | parent | 6 | open | |

## Log

- **L1 (2026-10-29):** "para aqui y sigamos", answering the proposal: "Aplicar las dos correcciones que los datos ya justifican: cambiar la regla de contradicción a «implementa lo coherente y reporta el resto»; revisar por qué se atasca el flujo del oráculo en cambios de una línea (5 de 30)".
- **L2 (2026-10-29):** Traces of the 5 stalled debugging-fires runs: e-bnQ6XM and e-Q6BoX7 show `surface-guard: .vault/tasks/paginate-fix.md is a locked oracle`; e-EatO7W, e-S9Mafi, e-ETGNdJ show the worker denied for `no oracle envelope` with an existing failing paginate.test.js.
