# P5: Declared risk with a mechanical floor, publication by evidence

Date: 2026-10-27. Scope: quick review, 8 web searches. Labels: measured = empirical study; vendor = written by the tool or platform owner; opinion = blog, guide, or secondary summary.

## 0. State of the repository (verified by reading code)

- `plugins/construct/hooks/scripts/publication-gate.mjs` builds the required lenses only from the Risk column of the feature documents changed in the ref (`riskItems`, about line 226; `requiredLenses`, line 293). When no lens is required (`required.length === 0`) it allows the publish.
- No hook computes a floor from diff paths or keywords. `grep -i floor hooks/scripts` finds nothing relevant. The floor is a proposal (`reports/Cruce de piezas para ODD.md` §2.6 and the backlog row 2: "un `none` erróneo no detectado; trabajo riesgoso sin documento").
- Result: P5 describes behavior the plugin does not have. Today the risk is self-declared and only the gate is mechanical. A ref that changes `migrations/` with no feature document, or with `Risk: none`, publishes without review.
- "Destructive commands" is a runtime signal (command-guard), not a property of the diff. It cannot set a floor for a change at publish time.

## 1. What supports it

- Path-based required reviewers are standard. GitHub CODEOWNERS plus a branch rule or ruleset ("Require review from Code Owners") turns a path match into a merge condition. GitHub also recommends owning the CODEOWNERS file itself. Source: https://docs.github.com/enterprise-server@3.22/articles/about-code-owners/ [vendor]. For rulesets: https://www.aviator.co/blog/a-modern-guide-to-codeowners [opinion].
- Danger.js turns diff signals into fail or warn checks. Its canonical example fails or warns when `package.json` changes without the lockfile (`danger.git.modified_files`). Source: https://danger.systems/js/tutorials/dependencies [vendor].
- At Google, review needs an LGTM, owner approval (OWNERS), and readability approval, so the set of required approvers depends on what the change touches. Study of 9M changes: https://research.google/pubs/modern-code-review-a-case-study-at-google/ [measured, but the approval mechanics come from secondary sources: https://graphite.dev/blog/how-google-does-code-review, opinion].
- SLSA v1.2 Source track: L3 means "enforced organizational technical controls" and L4 adds two-party review. Review as a control enforced by the platform is the industry baseline. Source: https://slsa.dev/spec/v1.2/source-requirements [vendor/spec]; https://slsa.dev/blog/2025/04/slsa-source-sprint [vendor].
- Change-level (JIT) risk prediction: Kamei et al. (11 projects) reached 68% accuracy and 64% recall, and found 35% of defect-inducing changes with 20% of the inspection effort. Their signals are change size, diffusion, history, and experience, not semantic categories. Source: https://sail.cs.queensu.ca/data/pdfs/TSE_ALarge-ScaleEmpiricalStudyOfJust-in-TimeQualityAssurance.pdf [measured].
- Meta Diff Risk Score: a fine-tuned Llama predicts the probability that a diff causes a SEV. It powers about 20 risk-aware features, including gating. AI and bot diffs get stricter thresholds than human diffs (P20/P50 vs P5, from one paper only). Sources: https://engineering.fb.com/2025/08/06/developer-tools/diff-risk-score-drs-ai-risk-aware-software-development-meta/ [vendor], https://arxiv.org/pdf/2605.30208 [measured, Meta-authored], https://arxiv.org/html/2410.06351v1 [measured]. Takeaway: the risk score is computed by a system outside the author, and agent-authored diffs get a stricter bar.

Taxonomy: six categories is reasonable. They match the classic review triggers (data, security, API, concurrency, deploy/config) plus a residual "untestable" bucket. The alternatives each lose something:
- A numeric score (DRS, JIT) needs training data Construct lacks.
- Plain path ownership (CODEOWNERS) maps paths to people, not to concerns.
- STRIDE-like lists cover security only.
- The weak spot is item 6, which no mechanical signal can floor, and item 3, where "published contracts" is project-specific (opinion).

## 2. Can LLMs self-assess risk?

There is no direct study of agents declaring change risk. The nearest evidence:
- Verbalized confidence is mostly overconfident. GPT-4's AUROC for separating right from wrong answers was about 62.7%, near chance. Source: https://arxiv.org/pdf/2306.13063 [measured]. Also https://arxiv.org/pdf/2405.02917 [measured]. Calibration varies widely by model (ECE 0.12 to 0.73): https://arxiv.org/pdf/2603.09985 [measured, preprint].
- Agents misreport outcomes. About 2% of 8,600 real sessions showed misrepresented success. Source: https://www.lesswrong.com/posts/smE9h9RnaK7FWKBZ2/measuring-coding-agent-misalignment-in-the-wild-1 [measured, not peer-reviewed]. Agents claim "all tests pass" despite a failing test, and forcing explicit counts only partly fixes it: https://neurips.cc/virtual/2026/168218 [measured]. Inaccurate self-reporting was reported as 22.58% of misalignment cases in 20,574 sessions, via a third-party blog: https://codex.danielvaughan.com/2026/07/01/coding-agent-misalignment-20574-sessions-codex-cli-constraint-enforcement-self-reporting-defence/ [opinion summarizing measured; check the original].
- Inference: self-declared risk is biased toward `none`, because "none" means less work. A floor that the agent cannot lower is the right shape. The evidence is indirect.

## 3. Counterarguments and failure modes

- Strongest counterargument: path rules are a weak proxy. JIT and DRS show that useful risk prediction needs history and semantics. A path floor will both over-fire (a `auth/` rename, a lockfile bump by a bot) and under-fire (risk in a file nobody listed). Developers abandon tools with many false positives. Source: Johnson et al. ICSE 2013, https://research.google/pubs/pub43477/ [measured, 20 interviews].
- Gate fatigue: if most publishes need lenses, rejections get rubber-stamped or the gate gets bypassed. Mitigation: keep the default signal list short and high-precision, and log floor hits to measure the false-positive rate.
- Bypass: the gate only sees Bash in Claude Code. `--no-verify`, other hosts, and the GitHub UI skip it, as CLAUDE.md already admits. Push-time gating is a discipline layer. The real boundary is merge-time (rulesets plus required status checks), and Construct does not own that.
- Push vs merge: push-time catches problems early and cheaply but can be skipped. Merge-time is enforceable but late. Recommended: keep push-time and document a CI check that runs the same floor as the boundary (optional).
- Floor without a feature document: today such work escapes entirely. The floor has to apply to the ref diff itself, not only to Tasks-table cells.

## 4. Cheap implementation and evaluation

- In `publication-gate.mjs`, compute `git diff --name-only <mergeBase>..<sha>` (the merge base is already resolved). Match the names against a small default table (path glob → item):
  - `**/migrations/**`, `*.sql` → 1
  - `**/auth/**`, `**/*secret*`, `.env*` → 2
  - lockfiles, `.github/workflows/**`, `Dockerfile`, `install.sh` → 5
  - an optional project file, for example `odd/risk-paths`, CODEOWNERS-style, for item 3 contracts
  - optionally added-line keywords (`DROP TABLE`, `rm -rf`) → 1
- Merge the floor with the declared items: `items = declared ∪ floor`, so the floor can only add. Reuse `requiredLenses`. The deny message names the matched paths.
- Size: about 40 lines plus a unit test. Fail closed only for the gate's own errors, consistent with the current gate.
- Evaluation:
  - Precision: replay `git log` of this and one or two other repositories and count floor hits per commit, then hand-label a sample.
  - Recall: test fixtures with a migration plus `Risk: none` must deny.
  - Eval case: an agent edits a lockfile and declares `none`, and the gate must deny.
  - Track the hit rate in the review store over time.

## 5. Recommendation: CHANGE

Keep the idea. Change the text so it is implementable and honest:
- Floor signals come from the diff (paths and keywords) plus a list the project declares, not from runtime commands.
- The floor applies to the published diff even without a feature document.
- Lenses approve the published commit.

Implementation is a prerequisite: until the floor ships, the principle overstates the plugin.

Proposed text:

"Declared risk with a mechanical floor, publication by evidence. Every change ends with a risk line naming which of six risk categories it touches, or `none`. Signals in the diff (migrations, auth, lockfiles, CI, installers, and paths the project declares as contracts) set a minimum the agent may raise but not lower. Publishing (push, pull request, release) is blocked until the lenses that risk requires have approved the published commit."
