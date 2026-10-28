# P2 Proportional ceremony: research notes

Date: 2026-10-27. Budget: 10 web searches/fetches (2 fetches failed or redirected). Labels: **measured** (empirical data), **vendor** (tool maker or vendor data/docs), **opinion**.

## Principle under review (METHODOLOGY.md, principle 2)

Inline if resumable from request + `git diff` and nothing risky; feature document if larger; acceptance tests first if risky; `Exceeds: <limit> — <why>` when a size limit is passed. Limits: 150 changed lines per inline edit call, ~1,500 changed lines per PR.

What Construct actually does (verified in repo):
- 150 is `inline_edit_max_lines`, enforced by `surface-guard.mjs` per tool call. It is a delegation threshold (main thread vs worker), not a change-size limit.
- 1,500 is `slice_lines`; `skills/delivery/SKILL.md:25` calls it "a target, never a cap"; delivery-signals reports it.
- Resume test is a prompt rule (`skills/workflow/SKILL.md:31-33`, `hooks/contract/session.md:18`: "counts never decide").
- `Exceeds:` does not exist anywhere (METHODOLOGY.md:27).

## 1. Support

| Claim | Source | Label |
|---|---|---|
| Cisco/SmartBear (2006, ~2,500 reviews): defect-finding effectiveness drops past ~200-400 LOC per review; summaries disagree on exact threshold (300 / 400 / 500) | secondary: https://mikeconley.ca/blog/tag/loc/ , https://lists.openstack.org/pipermail/openstack-dev/2013-August/013959.html , https://www.atlassian.com/blog/software-teams/code-review-best-practices | measured, but vendor-run, one company, 2006; primary PDF not retrieved |
| Critique: LOC hides complexity; number specific to that codebase | https://lists.openstack.org/pipermail/openstack-dev/2013-August/013960.html | opinion |
| Google: median reviewed change ~24 lines, ~90% touch <10 files (9M changes) | https://research.google/pubs/modern-code-review-a-case-study-at-google/ ; figure via https://arxiv.org/pdf/2203.05045 | measured (figure seen only secondhand) |
| Small changes merge faster across languages | https://arxiv.org/pdf/2203.05045 | measured |
| DORA: small batches linked to delivery performance; one of seven capabilities that amplify AI benefit | https://dora.dev/capabilities/working-in-small-batches/ | measured (survey-based) |
| Faros: high AI adoption -> +154% PR size, +91% review time, +9% bugs | https://www.augmentcode.com/guides/ai-productivity-paradox-engineering-delivery (via existing report) | vendor |
| Agentic PRs: "too large to review" is a rejection reason only for agent PRs (1.5% of rejected agent PRs, 0% human; n=654, AIDev-pop) | https://arxiv.org/html/2602.04226v1 | measured, small effect |
| METR: 80% horizon much shorter than 50% (Claude 3.7: 15 min vs 59 min); horizon doubles ~7 months | https://arxiv.org/pdf/2503.14499 ; https://arxiv.org/pdf/2505.05115 | measured |
| BMAD: scale-adaptive tracks (Quick Flow for bug fixes/small features, "hours to 1 day"; Method; Enterprise); "tracks are determined by what planning the project needs, not story math" | https://www.mintlify.com/bmad-code-org/BMAD-METHOD/concepts ; mirrors of docs/workflows-planning.md | vendor (project docs) |
| Kiro: Quick Spec (no approval gates) for well-understood features; Bugfix spec; chat quick fix for typos/one-liners | https://kiro.dev/docs/specs/quick-spec/ ; https://kiro.dev/docs/chat/vibe/ | vendor |
| Over-ceremony failure: Kiro turned a small bug into 4 stories / 16 criteria | https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html | opinion with direct observation |
| Codex: medium effort default for interactive coding, high/xhigh for hardest tasks | https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide | vendor |

Not found in budget: an official Codex statement telling users to split tasks (best-practices page redirected then 404); any study binning agent PR acceptance by line count.

## 2. Resume test vs alternatives

- Lines: cheap and machine-checkable, the only criterion with external data (Cisco, Google), but that data is about human review attention, not agent correctness. Gameable (split calls, formatting).
- Files: Google ~90% <10 files; weak.
- Time / METR horizon: best evidence that reliability falls with task length, but task duration is not observable before doing the work, and the number moves every ~7 months.
- Reasoning effort (Codex): routes compute, not process; orthogonal.
- Resume test: targets the real failure (state lost across compaction/sessions), which is what a feature document fixes. No external validation; it is a self-judgment, and an agent that misjudges will misjudge here too. Good as the trigger for "feature document", not as a review-size limit.

Conclusion: two different questions are bundled. "Does this need a document?" -> resume test (state). "Is this reviewable?" -> lines (attention). Keep both, but name what each limit protects.

Numbers the evidence can justify:
- Review unit: ~400 changed lines (Cisco upper bound; Google median far lower). 1,500 is ~4x the only cited threshold; defensible only as "a slice, reviewed in commits" not as one review unit. No source supports 1,500.
- 150 per inline call: no source; it is an operational choice (how much the main thread may write without a worker). Should be described as such, not as evidence-based.

## 3. Counterarguments and failure modes

- Strongest: the size judgment is made by the agent being sized. Self-assessed scope is the same weakness as self-written tests (cf. TDFlow in existing report). An agent that wants to avoid ceremony passes its own resume test.
- Gaming: per-call limits are dodged by splitting edits; PR line counts by splitting PRs that still depend on each other; `Exceeds:` becomes boilerplate if nothing reads it.
- Lines measure attention, not risk: a 5-line auth change is riskier than a 600-line rename. The principle already separates risk, which is good.
- Three tracks: tolerable (BMAD and Kiro both have 3), but the risk track is really a modifier, not a third size; simpler framing is "size picks the document, risk picks the tests".
- Evidence transfer: Cisco/Google measure human reviewers; Construct's first reviewers are LLM lenses. Limit still matters because the human user reviews the PR.

## 4. Cheap verification

- Hook (exists): surface-guard for 150. Add: Stop/delivery-signals check that, when `git diff --numstat` against default branch > slice_lines, the reply or feature doc contains `Exceeds:`; warn, do not block (~30 lines in existing delivery-signals).
- Hook: when diff touches >N files or spans >1 session (feature-state already tracks), and no `odd/tasks/*.md` exists, warn "resume test likely failed".
- Eval: two cases already shaped like `small-inline`: (a) a 1-line typo must finish with no feature doc and no worker; (b) a multi-session request must create a feature doc. Grader checks `odd/tasks/` presence. Plus (c) a risky small change (auth check) must produce a test before implementation.
- Metric: log ceremony per task (doc yes/no, lines, Exceeds count) to see if limits are ever hit or always exceeded.

## 5. Recommendation: CHANGE

Keep the idea (well supported directionally: DORA, Cisco, Google, Faros, METR, BMAD/Kiro). Change: (1) separate the two criteria and say what each protects, (2) stop presenting the numbers as evidence-backed and anchor the review limit to the only cited figure, (3) make `Exceeds:` checkable.

Proposed text:

> **Proportional ceremony.** Process scales with the work, judged on two axes. State: a change that can be resumed from the request plus `git diff` is done inline; one that cannot gets a feature document. Risk: risky work also gets acceptance tests before implementation, whatever its size. Review size is capped separately, because attention, not the agent, is the limit: a reviewable unit stays near 400 changed lines. Going past a limit is allowed when the reason is written down (`Exceeds: <limit> — <why>`) where a hook can see it.

Open question for maintainer: lower `slice_lines` default from 1,500 toward ~400, or keep 1,500 as a PR slice and require commits within it to be ~400? (Needs a decision; changing the default is a user-visible config change.)
