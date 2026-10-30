# Eval findings

Objective: fix the two regressions the n=30 evals found (docs/evals/results.md), then re-measure them. Branch: fix/eval-findings, on main after #114 (squash-merged; rebased onto it). Test runner: node --test 'tests/**/*.test.mjs'.

## Specs

- **S1 — An oracle never locks a free path.** "revisar por qué se atasca el flujo del oráculo en cambios de una línea (5 de 30)" (L1). In 2 of the 5 stalled debugging-fires runs the oracle listed the feature document as a surface, oracle-record locked it, and surface-guard then denied every edit of it.
  - Given a construct:oracle launch When any `## Allowed edit surfaces` entry is under `.vault/` or a doc (isFree) Then delegation-admission denies it, naming the paths and saying the oracle lists only test files.
- **S2 — An existing failing test can be the oracle.** "revisar por qué se atasca el flujo del oráculo en cambios de una línea (5 de 30)" (L1). In the other 3 stalled runs the failing test already existed, the worker was denied for lack of an envelope, and the agent gave up.
  - Assumption: agents/oracle.md says that when an existing test already fails for the specified behavior, the oracle lists that test file as its surface, leaves it unchanged, reports it RED, and declares the envelope; the worker's admission denial text says the same.
- **S3 — Contradictions do not stop the consistent work.** "cambiar la regla de contradicción a «implementa lo coherente y reporta el resto»" (L1). hidden-contradiction: 3/30 with Construct, 0/30 with the short CLAUDE.md, 30/30 without either.
  - Assumption: agents/worker.md, hooks/contract/subagent.md, agents/oracle.md, and evals/_claudemd/CLAUDE.md say: implement everything consistent with the specs, leave the locked test unchanged, then report the contradiction (`oracle_conflict` for a worker) naming the case.
- **S5 — The claudemd arm's outcome check reads the real fixture.** Found in the T2 re-run (L4): make-variants.sh renames a case's fixture.sh to fixture-base.sh and writes a wrapper fixture.sh, so hidden-contradiction's outcome.sh, which extracts the locked files from fixture.sh, compares against empty files and fails every claudemd-variant run.
  - Given a case with `arms: claudemd` whose outcome.sh reads the expected files from fixture.sh When make-variants.sh builds the variant and a run leaves a correct workspace Then the variant's outcome.sh passes, as the original case's does.
- **S4 — Re-measure.** Assumption: debugging-fires and hidden-contradiction run again at n=30 (about $25); docs/evals/results.md records both runs.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1, S2, S3 | Oracle free-path deny, existing-test oracle, contradiction rule | worker | 3 | done | 06c8104 |
| T3 | S5 | Variant fixture keeps the original fixture.sh content; recompute outcomes from kept runs | parent (inline, test-first) | 6 | done | 0ef5d6b |
| T2 | S4 | Re-run the two cases at n=30, record results | parent | 6 | done | (this commit) |
| T4 | S3 | Carry the contradiction rule to the main thread (hooks/contract/session.md), then re-run hidden-contradiction | oracle, worker | 3 | open: next PR | |

## Log

- **L1 (2026-10-29):** "para aqui y sigamos", answering the proposal: "Aplicar las dos correcciones que los datos ya justifican: cambiar la regla de contradicción a «implementa lo coherente y reporta el resto»; revisar por qué se atasca el flujo del oráculo en cambios de una línea (5 de 30)".
- **L2 (2026-10-29):** Traces of the 5 stalled debugging-fires runs: e-bnQ6XM and e-Q6BoX7 show `surface-guard: .vault/tasks/paginate-fix.md is a locked oracle`; e-EatO7W, e-S9Mafi, e-ETGNdJ show the worker denied for `no oracle envelope` with an existing failing paginate.test.js.
- **L3 (2026-10-29):** T1 (dea27b6): S1 RED then GREEN (admission test); S2 and S3 are prose in oracle.md, worker.md, subagent.md (2932 chars), _claudemd/CLAUDE.md; full suite 1346/1346. worker.md shortened by wording only to fit 500 words. The prose effect is unverified until T2.
- **L4 (2026-10-30):** hidden-contradiction re-run at n=30 (120 runs, $22.05, 0 errored): with 27% outcome (was 10%), without 100%, claudemd 0%, with+claudemd 0%. Kept claudemd workspace e-XxgwbN has a correct stats.js and passes outcome.sh run against the original case (29/29), so the claudemd 0% is a harness artifact (S5), in this run and in the earlier n=30 run. #114 was squash-merged meanwhile; the branch was rebased onto main (T1 commit is now 06c8104).
- **L5 (2026-10-30):** T3 RED (`cmp: EOF on expected.stats.test.js`) then GREEN; full suite 1347/1347. Outcomes of the L4 run recomputed with the fixed variant from the kept workspaces: claudemd 100%, with+claudemd 97%, with 27%, without 100%. Traces of 3 failed with-arm runs (e-ybHMz7, e-xV3BUW, e-37d1JQ): the oracle reports case 17 and the main thread stops and asks instead of launching a worker; S3's rule is not in the session contract. debugging-fires re-run (reported by the user): with 97% (29/30), ritual 43%, $0.29; without 100%, $0.05. S3 is not met by Construct alone: gap T4, left open for the next PR.
