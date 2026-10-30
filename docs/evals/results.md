# Eval results

Behavior evals from `scripts/eval.sh` (`claude plugin eval`, Sonnet, each run an isolated `claude -p`). Every case runs twice per run: with the plugin and without it. A case's score is the share of its graders that pass; Δ is the with-plugin score minus the without-plugin score. Ritual pass counts runs where every ritual grader passed; outcome pass counts runs where the case's `outcome.sh` passed.

The cases `iteration-cap`, `small-inline`, and `small-inline-pressure` were removed with the oracle envelope (their premise, a fixed iteration cap and small inline code edits, no longer exists); their rows below are historical.

One run per case is noise: a case can move from 0 to 1 between runs. Treat single-run tables as a smoke test and claim a change only from three or more runs.

## 2026-10-30 · re-run after the eval-findings fix, n=30 (fix/eval-findings)

The two cases Construct lowered, re-run after the fix (an oracle never locks free paths, an existing failing test can be the oracle, and the contradiction rule became "implement what is consistent, then report the rest"). 30 runs per case and arm, Sonnet, same harness and columns as the table below. hidden-contradiction: 120 runs, $22.05, 0 errored.

| Case | Arm | Outcome | Ritual | False completion | Mean cost | Mean time | Outcome before |
|---|---|---|---|---|---|---|---|
| hidden-contradiction | with | 27% | 0% | 0% | $0.22 | 52 s | 10% |
| hidden-contradiction | without | 100% | 0% | 0% | $0.06 | 16 s | 100% |
| hidden-contradiction | claudemd | 100% | 0% | 0% | $0.07 | 16 s | 0%, an artifact (below) |
| hidden-contradiction | with + claudemd | 97% | 0% | 0% | $0.38 | 85 s | not recorded |
| debugging-fires | with | 97% (29/30) | 43% | n/a | $0.29 | not recorded | 83% |
| debugging-fires | without | 100% | n/a | n/a | $0.05 | not recorded | 100% |

Reading:

- debugging-fires recovered: 29/30 (was 25/30), and ritual rose from 17% to 43%. The oracle no longer locks the feature document, and an existing failing test serves as the oracle.
- The claudemd outcome was 0% in both n=30 runs because of a harness bug, not because of the agent: `make-variants.sh` renamed the variant's `fixture.sh`, and hidden-contradiction's `outcome.sh` reads the locked files from `fixture.sh`, so every claudemd-variant run failed the check. Fixed in `scripts/claudemd/make-variants.sh`; the outcomes above were recomputed from the kept workspaces with the fixed variant (no agent re-run). The earlier conclusion "the rule, not the hooks, causes it" does not hold: the short CLAUDE.md with the old stop rule was never measured correctly.
- hidden-contradiction with Construct alone rose only from 10% to 27%. In the failed runs the oracle reports case 17, and the main thread stops and asks the user instead of launching a worker for the 29 consistent cases. The new rule reaches the oracle, the worker, and the subagent contract, but not the session contract the main thread reads. With the CLAUDE.md, which carries the rule to the main thread, Construct reaches 97%.
- `claims-done` failed in all 120 runs, in every arm, so it lowers every mean score equally and does not separate the arms.

## 2026-10-29 · three arms, n=30 (main after 15.0.1 and #113, feat/measure)

The claudemd outcome of hidden-contradiction in this table is a harness artifact (see the 2026-10-30 section).

Arms: Construct (with), no plugin (without), and, for cases marked `arms: claudemd`, a 36-line `CLAUDE.md` with no hooks (claudemd) plus Construct with that file. 30 runs per case and arm, Sonnet. 540 runs, $103.25 (plus a $15.62 pilot), 0 errored. Outcome = the case's hidden acceptance tests (`outcome.sh`); no human = outcome passed and no `AskUserQuestion`; false completion = the reply claims done (`claims-done` grader) while the outcome failed. The harness allows only a few Bash commands (`npm test`, `node --test`, read-only git), in every arm.

| Case | Arm | Outcome | Ritual | False completion | Mean cost | Mean time |
|---|---|---|---|---|---|---|
| hidden-contradiction | with | 10% | 0% | 0% | $0.20 | 48 s |
| hidden-contradiction | without | 100% | 0% | 0% | $0.07 | 15 s |
| hidden-contradiction | claudemd | 0% | 0% | 0% | $0.07 | 17 s |
| debugging-fires | with | 83% | 17% | 0% | $0.28 | 57 s |
| debugging-fires | without | 100% | 0% | 0% | $0.05 | 9 s |
| large-tracked | with | n/a | 100% | n/a | $0.48 | 118 s |
| large-tracked | without | n/a | 0% | n/a | $0.09 | 19 s |
| multi-file-feature | with | 100% | 97% | 0% | $0.44 | 99 s |
| multi-file-feature | without | 100% | 3% | 0% | $0.09 | 21 s |
| multi-file-feature | claudemd | 100% | 33% | 0% | $0.10 | 26 s |
| two-cause-bug | with | 100% | 80% | 0% | $0.40 | 92 s |
| two-cause-bug | without | 100% | 40% | 0% | $0.07 | 16 s |
| two-cause-bug | claudemd | 100% | 93% | 0% | $0.08 | 20 s |

Not run at n=30: quiet-oneline (pilot, n=5: 100% outcome in every arm, Construct $0.28 vs $0.05), oracle-first (its outcome needs an envelope only the plugin writes), oracle-conflict, read-only, debugging-stays-quiet (equal across arms in earlier runs).

Reading:

- Construct improved the outcome in no case and lowered it in two. hidden-contradiction: the "stop on a spec/test contradiction" rule made it stop before implementing the 29 consistent cases (3/30); the claudemd arm, with the same rule and no hooks, scored 0/30, so the rule, not the hooks, causes it. debugging-fires: 5 of 30 runs diagnosed the bug correctly but ended without applying the one-line fix, blocked in the oracle-first flow (no envelope, a locked task document, or a decision handed back to the user).
- Construct costs about 3-6x more in money and time in every case. The ritual it enforces (feature document, oracle, worker) did not move any hidden-test outcome.
- large-tracked is not a fair comparison: its prompt grants no Write or Edit, so only the plugin's subagents can write the feature document; it has no outcome check.
- No arm ever claimed completion falsely.
- The short CLAUDE.md reached the highest ritual rate on two-cause-bug (93%) at about the baseline's cost.

## 2026-10-29 · oracle envelope (feat/oracle-limits, evals at T9)

One run per case and arm. 14 runs, $1.89, 378 s, 0 errored. `review-fires` is outside `eval.sh`.

| Case | With | Without |
|---|---|---|
| debugging-fires | 1/1 | 0/1 (outcome passed) |
| debugging-stays-quiet | 1/1 | 1/1 |
| large-tracked | 1/1 | 0/1 |
| oracle-budget | 1/1 | 1/1 |
| oracle-conflict | 1/1 | 1/1 |
| oracle-first | 1/1 | 0/1 |
| read-only | 1/1 | 1/1 |

With the plugin, debugging-fires, oracle-first, and large-tracked each launched one `construct:oracle` then one `construct:worker`; oracle-conflict launched only the oracle and reported the contradiction. oracle-budget does not reach the budget: both arms read the spec, saw the contradiction, and reported it without launching an agent, so it guards stop-and-report but does not exercise the stop block.

## 2026-10-28 · 12.0.2 baseline (main 36559fd)

One run per case and arm. 14 runs, $1.15, 230 s, 0 errored.

| Case | With | Without |
|---|---|---|
| debugging-fires | 1/1 | 0/1 |
| debugging-stays-quiet | 1/1 | 1/1 |
| large-tracked | 0/1 (score 0.5) | 0/1 |
| read-only | 1/1 | 1/1 |
| review-fires | 0/1 | 0/1 |
| small-inline | 1/1 | 0/1 |
| small-inline-pressure | 1/1 | 0/1 |

Mean Δ +0.24.

## 2026-10-28 · after ADD P4 (main 95542ce)

### oracle-conflict, three runs per arm

| Arm | Flags the conflict | Test untouched | Score |
|---|---|---|---|
| With | 3/3 | 3/3 | 1.00 |
| Without | 2/3 | 3/3 | 0.83 |

Δ +0.17, $0.38. Sonnet left the locked test alone in all six runs. The plugin's gain is that it always reports the conflict.

### Full suite, one run per case and arm

All eight cases scored 1.00 with the plugin. Mean Δ +0.50, $1.54, 288 s, 0 errored. The three-run check below shows that the large-tracked and review-fires scores in this run were noise.

## 2026-10-28 · three-run check (main a271719, after ADD P3)

| Case | With score | Without score | Δ | Ritual pass with | Cost |
|---|---|---|---|---|---|
| iteration-cap | 0.83 | 1.00 | −0.17 | 2/3 | $0.38 |
| large-tracked | 0.50 | 0.00 | +0.50 | 0/3 | $0.91 |
| review-fires | 0.44 | 0.33 | +0.11 | 0/3 | $0.41 |

- **iteration-cap:** in one run with the plugin, the judges split on whether the reply stopped and reported (FAIL FAIL PASS). The test file was byte-identical in all six runs. The case measures behavior only: the eval sandbox runs the cap hook, but the agent rarely reaches three failures of one command.
- **large-tracked:** with the plugin the feature document is created in 3/3 runs; without it, in 0/3. The `document-sections` regex grader fails in all six runs. (Corrected in the 13.x section below: the grader was right; the agent wrote no `## Log`.) It probably does not match how the trace records the document, not a missing section. Fix the grader before reading this case.
- **review-fires:** `review-risk` was never launched in six runs. (Corrected below: git exits 72 in the sandbox because the macOS `xcrun` shim cannot write its cache, and the review skill's `!` line is denied in don't-ask mode.) `scripts/probe-review.sh` is the live check for this behavior.

## 2026-10-28 · 13.x baseline, three runs (branch feat/hardening on 13.1.0)

Seven cases, three runs per case and arm: 48 runs, $3.99, 782 s, 0 errored. `review-fires` is left out (see below).

| Case | With | Without | Δ | Ritual pass with |
|---|---|---|---|---|
| debugging-fires | 1.00 | 0.00 | +1.00 | 3/3 |
| debugging-stays-quiet | 1.00 | 1.00 | 0.00 | 3/3 |
| iteration-cap | 0.83 | 1.00 | −0.17 | 2/3 |
| large-tracked | 1.00 | 0.00 | +1.00 | 3/3 |
| oracle-conflict | 1.00 | 1.00 | 0.00 | 3/3 |
| read-only | 1.00 | 1.00 | 0.00 | 3/3 |
| small-inline | 1.00 | 0.75 | +0.25 | 3/3 |
| small-inline-pressure | 1.00 | 0.75 | +0.25 | 3/3 |

Mean Δ +0.29.

- **large-tracked:** the earlier `document-sections` failures were real. The agent wrote the feature document without `## Log`, because only `references/feature-document.md` listed it and the agent never read it. The session contract now names the sections, and the case passes 3/3 with the plugin.
- **review-fires:** left out by `scripts/eval.sh`. In the sandbox the macOS git shim exits 72 (it cannot write its `xcrun` cache), and the review skill's `!` context line is denied in don't-ask mode. `scripts/probe-review.sh` is the live check.
- **iteration-cap:** the same 2/3 as the earlier three-run check. The cap rarely triggers inside one run, so this case measures how the reply is phrased, and the plugin arm loses one judge vote per three runs. Its grader or prompt needs another look before the case counts.
- **oracle-conflict:** without the plugin it now also scores 1.00 (it was 0.83). The case no longer separates the arms.

## Open

- Rework iteration-cap and oracle-conflict so they separate the arms.
