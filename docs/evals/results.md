# Eval results

Behavior evals from `scripts/eval.sh` (`claude plugin eval`, Sonnet, each run an isolated `claude -p`). Every case runs twice per run: with the plugin and without it. A case's score is the share of its graders that pass; Δ is the with-plugin score minus the without-plugin score. Ritual pass counts runs where every ritual grader passed; outcome pass counts runs where the case's `outcome.sh` passed.

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
- **large-tracked:** with the plugin the feature document is created in 3/3 runs; without it, in 0/3. The `document-sections` regex grader fails in all six runs. It probably does not match how the trace records the document, not a missing section. Fix the grader before reading this case.
- **review-fires:** `review-risk` was never launched in six runs. The eval sandbox has no usable git, so the publication flow cannot start. `scripts/probe-review.sh` is the live check for this behavior.

## Open

- Fix or replace the `document-sections` grader of large-tracked.
- Make review-fires measurable in the sandbox, or rely on `scripts/probe-review.sh` and drop the case.
- Rerun the full suite with three runs per case before the next release claims an improvement.
