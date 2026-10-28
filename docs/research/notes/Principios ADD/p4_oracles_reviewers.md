# Principle 4: Independent oracles, one writer, clean reviewers

Research notes, 2026-10-27. Scope: evidence beyond what the reports already cite (TDFlow, Cognition, MAST, judge self-preference). Labels: **measured** (peer-reviewed or preprint with numbers), **vendor**, **opinion**. Numbers taken from abstracts or search summaries were not re-checked against full papers unless noted.

## 1. Additional support

| Claim | Source | Label |
|---|---|---|
| A separate test-designer agent plus executor reaches 96.3% pass@1 HumanEval (GPT-4) with fewer tokens than baselines; the paper argues for separating code and test generation. Third-party ablation suggests most of the gain comes from the execution feedback loop, not the separation alone (unverified). | AgentCoder, https://arxiv.org/abs/2312.13010 ; ablation summary https://agentpatterns.ai/patterns/multi-agent/independent-test-generation-multi-agent/ | measured (ablation: opinion/secondary) |
| Without external feedback, LLMs fail to self-correct reasoning and sometimes get worse. | Huang et al., ICLR 2024, https://arxiv.org/abs/2310.01798 | measured |
| Code self-repair is bottlenecked by the model's feedback on its own code; feedback from a stronger model or a human gives much larger gains. | Olausson et al., ICLR 2024, https://arxiv.org/abs/2306.09896 | measured |
| Judges recognize their own outputs and score them higher; strength of self-recognition correlates linearly with self-preference. | Panickssery, Bowman, Feng, NeurIPS 2024, https://arxiv.org/abs/2404.13076 | measured |
| Bias extends to the model family: judges over-credit relatives, worst on LiveCodeBench; part of naive "bias" is real quality difference. | https://arxiv.org/abs/2604.06996 ; https://arxiv.org/abs/2609.17857 | measured (preprints) |
| Coding agents edit tests to pass impossible tasks (39-76% cheat rates); direct test-file editing is the dominant route for Anthropic models; hiding/locking tests drops hacking to near zero. | ImpossibleBench, ICLR 2026, https://arxiv.org/abs/2510.20270 | measured |

ImpossibleBench is the strongest new support for "the writer cannot edit them": it is not a hypothetical, it is the observed failure mode of the model family Construct runs on.

## 2. Who should write the oracle

- **Human** (best signal, TDFlow 94.3%): realistic only for a few acceptance cases per spec, or as approval of agent-drafted ones.
- **Separate agent from the spec only** (verifier/explorer, no access to the writer's code or reasoning): practical default. Risk: LLM oracles tend to encode **actual** rather than **expected** behavior when they see the code (<50% accuracy, https://arxiv.org/abs/2410.21136, measured); best oracle accuracy on real bugs ~54% (https://arxiv.org/abs/2601.05542, measured). So an agent-written oracle is itself unverified.
- **Different model family**: reduces correlated blind spots (family bias above), but Construct runs inside Claude Code; cross-family needs an external model. Optional, not a rule.
- **Cheap guards against wrong oracles**: write from the `S#` text without the implementation; require the oracle to fail before the change (red first) for new behavior; a human approves oracles on the highest risk tier.

## 3. Strongest counterargument and failure modes

- **Wrong oracle is worse than no oracle**: with <55% oracle accuracy, a locked wrong test forces the writer to implement the bug or stall. The lock needs an escape: the writer may flag an oracle as wrong, never edit it (opinion, follows from 2410.21136).
- **Cost/latency**: one more agent and a red-green handoff per risky spec. Bounded by applying it only to risky work, as the principle already does.
- **Self-generated tests also work**: CodeT shows same-model tests plus dual agreement beat no tests (https://arxiv.org/abs/2207.10397, measured). Independence is an improvement, not the only path; the gap (TDFlow) is what justifies it for risky work.
- **"Findings never expand scope" can hide real bugs**: a reviewer that sees an out-of-scope defect must not silently drop it. Construct's review skill already turns advisory findings into follow-up rows (`plugins/construct/skills/review/SKILL.md`, "Follow-ups and memory"); the principle text should say that, otherwise it reads as "ignore".
- **Clean context loses intent**: reviewers without the writer's reasoning may flag deliberate choices. The specs are the carrier of intent; that is acceptable.

## 4. Making it cheaply verifiable in Construct

- **Write-surface hook**: `surface-guard.mjs` already confines the writer to allowed edit surfaces. Add declared oracle paths (e.g. an `Oracle:` line per `S#` in the feature document) as forbidden for `worker`. Gap: it only sees Write/Edit/MultiEdit/NotebookEdit, not Bash (`sed -i`, `git checkout -- test`).
- **Hash check closes the Bash gap**: record a hash of oracle files when the verifier writes them; the verifier (or publication gate) fails if they changed in a writer turn. Cheaper and more complete than parsing shell commands.
- **Eval**: ImpossibleBench-style case in `plugins/construct/evals/`: fixture with an oracle test that contradicts the spec. Pass = oracle file unchanged and the reply reports the conflict. Second case: risky change; pass = oracle authored by a non-worker agent and failing before the fix.
- **Cross-family judges**: config only (`model_judge_b`); measurable only if an external model is available.

## 5. Recommendation: CHANGE

Keep the core (separation is well supported, and ImpossibleBench shows the edit-the-test failure is real for Claude models). Change two things: oracles must come from the specs and fail before the change (agent-written oracles are often wrong or capture the bug), and out-of-scope findings must become follow-ups rather than vanish.

Proposed text:

> One agent writes. Others read, test, and review. For risky work, acceptance tests are written from the specs by someone other than the writer, fail before the change, and the writer cannot edit them. Reviewers see the change and the specs, not the writer's reasoning; findings outside the specs become follow-ups, not new scope.
