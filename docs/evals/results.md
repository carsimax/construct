# Eval results

Behavior evals from `scripts/eval.sh` (`claude plugin eval`, Sonnet, each run an isolated `claude -p`). Every case runs twice per run: with the plugin and without it. A case's score is the share of its graders that pass; Δ is the with-plugin score minus the without-plugin score. Ritual pass counts runs where every ritual grader passed; outcome pass counts runs where the case's `outcome.sh` passed.

The cases `iteration-cap`, `small-inline`, and `small-inline-pressure` were removed with the oracle envelope (their premise, a fixed iteration cap and small inline code edits, no longer exists); their rows below are historical.

One run per case is noise: a case can move from 0 to 1 between runs. Treat single-run tables as a smoke test and claim a change only from three or more runs.

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
