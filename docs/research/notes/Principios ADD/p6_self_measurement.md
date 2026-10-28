# P6 "The methodology measures itself" — research notes (2026-10-27)

Labels: [measured] study/data, [vendor] vendor's own claim/guidance, [opinion] practitioner/author view, [local] this repo's own logs.

## 1. What supports it
- EDD as a process: CSIRO/UNSW EDDOps unifies offline and online evaluation in one loop — https://arxiv.org/html/2411.13768v3 [opinion, academic process model, no controlled validation]. Vercel built v0 eval-driven — https://vercel.com/blog/eval-driven-development-build-better-ai-faster [vendor].
- Anthropic, "Demystifying evals for AI agents" (Jan 2026) — https://anthropic.com/engineering/demystifying-evals-for-ai-agents [vendor]:
  - "20-50 simple tasks drawn from real failures is a great start"; early effects are large so small samples work.
  - Multiple trials because output is non-deterministic; pass^k (all k succeed): 75% per trial -> ~42% for k=3.
  - "Grade what the agent produced, not the path it took" (step-order checks are brittle).
  - "You won't know if your graders are working well unless you read the transcripts" -> transcript reading is part of eval hygiene, supports a diagnose step.
  - Capability evals (start low) vs regression evals (near 100%); saturated evals only catch regressions.
- Variance:
  - 60k SWE-Bench-Verified trajectories: single-run pass@1 moves 2.2-6.0 pp depending on the run; SD >1.5 pp even at temperature 0; 2-3 pp "gains" can be noise; recommends multiple runs, power analysis, report pass@k and pass^k — https://arxiv.org/abs/2602.07150 [measured].
  - n=100 per benchmark: differences under ~8-10 pp are within uncertainty (McNemar, Wilson intervals) — https://arxiv.org/pdf/2602.22953 [measured].
  - ICC splits variance into task difficulty vs agent inconsistency; guidance on N items vs T trials under a fixed budget — https://arxiv.org/html/2512.06710v1 [measured].
- Living spec precedents: OpenSpec archives delta specs into `openspec/specs/` — https://github.com/Fission-AI/OpenSpec [vendor/project docs]; Specification by Example's "living documentation" (executable, maintained specs) — https://www.infoq.com/articles/specification-by-example-book [opinion]. Drift complaint: https://dev.to/krlz/spec-driven-development-in-2026-what-it-is-the-tooling-and-how-teams-actually-use-it-2fk2 [opinion].
- Transcript diagnosis: Superpowers `diagnosing-superpowers` skill (installed here) reads a session transcript and reports why it went wrong [project tool, no published results].

## 2. Cost and variance in Construct [local]
- odd/tasks/construct-native.md L7/L13/L16: one full suite run (both arms, sonnet, --runs 1) ~280 s, ~$1.5; a 3-run gate ~$4.5-5.1 plus re-runs ~$0.6-1.0.
- Noise already seen: `debugging-stays-quiet` 2/3 one gate, then 5/5 on re-measure ("judge noise"); `small-delegated` 2/3 then 5/5. With 7 cases x 3 runs, one miss = 33 pp per case — far inside the 8-10 pp noise floor the papers report even at n=100.
- `review-fires` cannot run in the eval sandbox (git shim) -> a probe substitute; so "every principle has an eval" already needs non-harness probes.
- Consequence: "each release publishes compliance rates" is cheap in dollars (~$5-15/release at 3-10 runs) but the numbers per case are not statistically meaningful at 3 runs; publishing them as rates invites over-reading. Releases are frequent (12 majors); per-release cost compounds but stays small.
- Minimal version with signal: (a) rule-change gate: the cases touching the changed rule, >=5 runs per arm, before/after, report k/N plus pass^k, decide by direction + raw counts, not by pp; (b) release: one suite run, published as raw counts with N, as a regression check (ritual pass expected ~100%), not as a "compliance rate" claim; (c) aggregate across releases for trend.

## 3. Bundling
Four distinct things: per-principle evals, published rates, living spec, transcript diagnosis.
- Evals + eval delta on rule change: the core; keep.
- Transcript diagnosis: an input to evals (Anthropic: failures from real transcripts seed tasks) — fits as "failures become eval cases"; the skill itself is a mechanism, not a principle.
- Living spec: is about specification persistence/drift, not measurement. Belongs with the spec/intent principle (OpenSpec deltas). Move it.

## 4. Counterarguments / failure modes
- Goodhart: graders check rituals (Skill called, Risk line present), so the agent/maintainer optimizes for the ritual signal, not for outcomes. Frontier models actively game graders/tests — METR https://metr.org/blog/2025-06-05-recent-reward-hacking [measured]; o3 1-2% attempts with reward hacking https://evaluations.metr.org/openai-o3-report [measured]; MIRI Sept 2026 report https://intelligence.org/wp-content/uploads/The-State-of-Reward-Hacking-in-AI-September-2026.pdf [opinion/survey]. Mitigation: outcome graders alongside ritual graders (eval.sh already has outcome.sh), Anthropic's "grade outcome not path".
- Flaky LLM judges: already observed locally; a judged rate without N and intervals is a false precision.
- Cost/time drag: rule changes get slower; temptation to skip the eval or run 1 run. "Every principle has an eval" may be unachievable for principles about judgment (e.g. risk classification quality).
- Saturation: plugin-arm near 100% stops being informative; the rate only says "no regression".
- Strongest counterargument: with 7 cases and 3 runs, published "compliance rates" are mostly noise; the principle promises data-driven decisions the sample cannot deliver, and it bundles unrelated mechanics (living spec) into a measurement principle.

## 5. Recommendation: CHANGE
Keep the measurement idea (unique among rivals, cheap in $), make claims honest about N, move the living spec out, demote diagnosis to "failures feed evals".

Proposed text:
"The methodology measures itself. Every principle has at least one behavior eval that grades the outcome, not only the ritual. A change to a rule comes with its eval difference over repeated runs, and each release publishes its raw pass counts with the number of runs. Failures found in real sessions become new eval cases."
