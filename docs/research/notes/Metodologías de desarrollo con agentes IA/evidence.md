# Evidence on structuring software development with AI coding agents (as of 2026-10-27)

Labels used below: **[MEASURED]** = controlled experiment, benchmark, or telemetry with numbers; **[SURVEY]** = self-report; **[VENDOR-MEASURED]** = numbers from a vendor about its own product (unaudited); **[OPINION]** = recommendation or practitioner judgment. **[PRE-AGENTIC]** flags data collected before 2025-era agentic tools (Claude Code, Codex CLI, Devin-class agents).

## What do studies and surveys say about AI coding agents' measured effect on developer outcomes?

### Takeaway
The controlled evidence on real-world speedup is weak and conflicting: METR's 2025 RCT found a 19% slowdown, and its late-2025 follow-up could not produce a reliable estimate. Surveys show near-universal adoption with falling trust, and telemetry (DORA, Faros) shows AI amplifies existing practices: more throughput, but larger PRs, longer reviews, and more bugs/incidents unless testing, feedback loops, and review are already strong.

### Cited Findings
**Controlled experiments**
- [MEASURED, early 2025] METR RCT (Feb–Jun 2025 data): experienced open-source developers took 19% longer with AI (CI +2% to +39%); afterwards they believed AI had made them ~20% faster. — [METR, 2026-02-24](https://metr.org/blog/2026-02-24-uplift-update/)
- [MEASURED, late 2025] METR follow-up (started Aug 2025; 57 devs, 143 repos, 800+ tasks): returning developers −18% time (CI −38% to +9%), new developers −4% (CI −15% to +9%). Both CIs cross zero. — [METR, 2026-02-24](https://metr.org/blog/2026-02-24-uplift-update/)
- METR calls the late-2025 data an "unreliable signal": developers refused to take part because they didn't want to work without AI; 30–50% withheld tasks they didn't want to do without AI; developers running several concurrent agents could not track time reliably. METR believes speedup is probably larger now than in early 2025, but says its data is "only very weak evidence" of how much. — [METR, 2026-02-24](https://metr.org/blog/2026-02-24-uplift-update/)
- Secondary posts that describe the METR update as "an 18% productivity boost" misrepresent it. — [Rob Bowley, 2026-04-04](https://blog.robbowley.net/2026/04/04/metrs-developer-productivity-research-2026-update/)
- [MEASURED, PRE-AGENTIC] Google enterprise RCT (96 engineers, internal tooling, summer 2024): about 21% faster on an enterprise task, with a wide CI. The authors warn it may not generalize across tools or over time. — [arXiv 2410.12944 / ICSE 2025](https://arxiv.org/abs/2410.12944v3)

**Surveys**
- [SURVEY] DORA 2025 (~5,000 professionals): 90% use AI; median use ~2 h/day. AI adoption is now linked to higher delivery throughput (reversing the 2024 finding), but ensuring software works as intended before release is still a challenge. Core thesis: AI is an *amplifier* of a team's strengths and dysfunctions. — [Google Research](https://research.google/pubs/dora-2025-state-of-ai-assisted-software-development-report/); [TechRepublic](https://www.techrepublic.com/article/news-dora-ai-report-2025/); [dora.dev](https://www.dora.dev/research/ai)
- [SURVEY/OPINION] DORA AI Capabilities Model lists seven capabilities that amplify AI's impact: user focus, iterative experimentation, quality internal platforms, healthy data ecosystems, fast feedback loops, mature version control, and automated testing. — [TechRepublic](https://www.techrepublic.com/article/news-dora-ai-report-2025/)
- [OPINION] One reading of DORA's seven team archetypes says clusters 1–4 (most teams) may see delivery gains offset by higher change failure rates. This is a blogger's interpretation, not DORA's wording. — [Rob Bowley, 2025-10-01](https://blog.robbowley.net/2025/10/01/dora-2025-ai-assisted-dev-report-some-benefit-most-dont/)
- [SURVEY] Stack Overflow 2025 (49k+ respondents): 84% use or plan to use AI. Distrust of AI accuracy rose to 46% (from 31%). 66% say AI output is "almost right, but not quite", and 45% say debugging AI code takes longer than expected. Only 31% use AI agents and 38% don't plan to. Among agent users, 69% report higher productivity. 87% are concerned about agent accuracy. — [InfoWorld](https://infoworld.com/article/4031673/ai-use-among-software-developers-grows-but-trust-remains-an-issue-stack-overflow-survey.html); [The Decoder](https://the-decoder.com/developers-rely-on-ai-tools-more-than-ever-but-trust-is-slipping/). Note: outlets disagree on the exact trust figure (29% vs 33%).

**Telemetry**
- [VENDOR-MEASURED] Faros AI 2025 (10,000 devs, 1,255 teams): high-adoption teams completed 21% more tasks and merged 98% more PRs, but review time rose 91%, PR size grew 154%, and bugs per dev rose 9%. "Any correlation between AI adoption and key performance metrics evaporates at the company level." — [Augment summary of Faros](https://www.augmentcode.com/guides/ai-productivity-paradox-engineering-delivery); [Faros blog](https://www.faros.ai/blog/translating-ai-powered-developer-velocity-into-business-outcomes)
- [VENDOR-MEASURED] Faros 2026 report (22,000 devs, 4,000 teams, per Faros FAQ pages): epics per dev +66%, probability of a production incident more than tripled, bugs per dev +54%, PR size +51.3%. I could not confirm which report these numbers come from. — [Faros FAQ](https://www.faros.ai/comparison/github-copilot-vs-codeium); [Faros research](https://faros.ai/research)

**Agent capability trend**
- [MEASURED] METR's 50% task-completion time horizon has historically doubled about every 7 months. Analyses of models released since 2024 suggest it now doubles every ~3–4 months. Some forum reports say METR staff think recent estimates may be inflated by noise (secondhand). — [LessWrong analysis](https://www.lesswrong.com/posts/wM9LCAtuza4d3Z7oA/will-ai-progress-accelerate-or-slow-down-projecting-metr); [Dror Poleg chart](https://www.drorpoleg.com/charts/task-horizon/); [Wikipedia: METR](https://en.wikipedia.org/wiki/METR)

### Inferences
- No 2025–2026 RCT shows a statistically reliable speedup for experienced developers using agentic tools. Perceived speedup consistently exceeds measured speedup (METR's 2025 perception gap).
- Three independent sources (DORA, Faros, Stack Overflow) agree that the bottleneck moves downstream to review, debugging, and verification. Practices that strengthen those stages (automated tests, small PRs, fast feedback) are where evidence points, more than practices that add generation capacity.
- Because capability doubles quickly, any measured result older than ~6 months is partly obsolete. Prefer mechanisms that adapt as models improve over fixed rituals.

### Gaps
- No RCT isolates *workflow structure* (spec-first vs ad hoc, single vs multi-agent) for human+agent teams on real repos. All the productivity RCTs compare AI vs no AI.
- I did not open the primary DORA PDF, so the figures above come from coverage.
- I found no published 2026 METR result after the February update; one may exist.

## What do Anthropic, OpenAI, Google, Cognition, and Thoughtworks recommend, and where do they disagree?

### Takeaway
Vendors agree on a core: explore/plan before coding, give the agent a way to verify its own work (tests and evidence), keep context lean (subagents for exploration, compaction, notes), and treat repo instructions as a short map. They disagree on multi-agent architecture. Anthropic uses orchestrator-plus-subagents for research but says coding parallelizes poorly. Cognition rejects parallel writers but endorses single-writer plus reviewer/advisor agents. Thoughtworks is skeptical of heavyweight spec-driven tooling.

### Cited Findings
**Anthropic**
- [VENDOR-MEASURED, 2025-06-13] Multi-agent research system (Opus 4 lead, Sonnet 4 subagents) beat single-agent Opus 4 by 90.2% on an internal research eval. Agents use ~4x the tokens of chat and multi-agent systems ~15x. Token usage explained ~80% of performance variance on BrowseComp; tokens, tool calls, and model choice together explained 95%. — [Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system)
- [OPINION] Same post: "most coding tasks involve fewer truly parallelizable tasks than research," and agents are not yet good at real-time coordination and delegation. — [Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system)
- [OPINION] Eval practice from the same post: start with ~20 real queries, use one LLM-judge rubric (0.0–1.0 plus pass/fail), keep human testing, and for state-changing agents judge the end state, not each step. — [Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system)
- [OPINION] Claude Code best practices: explore → plan (plan mode is read-only and the plan is editable) → code → commit. Use subagents early to investigate questions and preserve the main context. Ask for evidence (test output, commands, screenshots) rather than claims, and use a fresh verification subagent so the worker isn't grading its own work. — [Claude Code docs](https://code.claude.com/docs/en/best-practices?ref=t01.li); [Anthropic Engineering](https://www.anthropic.com/engineering/claude-code-best-practices)
- [OPINION] Context engineering: for long-horizon work, use compaction (summarize and restart; clearing raw tool output is the lightest form), structured note-taking outside the context window, and subagents with clean contexts that return condensed summaries. These come from secondary summaries; I could not fetch Anthropic's original post. — [agentic-ai summary](https://agentic-ai.readthedocs.io/en/latest/ContextEngineering/anthropic/)

**OpenAI**
- [VENDOR, 2026-02-11] "Harness engineering": an internal product built with no hand-written code using Codex. The engineers' work shifted to designing the environment, specifying intent, and building feedback loops. — [OpenAI](https://openai.com/index/harness-engineering/) (the page returned 403 to my fetch; this summary is from search results)
- [secondary] Team grew from 3 to 7 engineers and merged ~1,500 PRs in five months. AGENTS.md should be a directory pointing to knowledge, not an encyclopedia. — [Yage.ai survey, 2026-03](https://yage.ai/share/harness-engineering-survey-en-20260312.html) (third-party; not verified against the primary post)

**Cognition (Devin)**
- [OPINION, 2025-06] "Don't build multi-agents": share full context and agent traces, because actions carry implicit decisions and parallel subagents make conflicting choices. Prefer a single-threaded linear agent, with history compression for long tasks. — [Cognition](https://cognition.ai/blog/dont-build-multi-agents)
- [OPINION + VENDOR-MEASURED, 2026-04-22] "Multi-Agents: What's Actually Working": the 2025 critique still holds for parallel writer swarms. What works is single-threaded writes, with other agents contributing review or advice. A clean-context reviewer that sees only the diff catches ~2 bugs per PR on average, ~58% of them severe. The coding agent should filter reviewer findings against the user's instructions to prevent loops and scope creep. Review loops can run many cycles. Over-prescriptive managers micromanage. Child agents wrongly assume shared state. — [Cognition](https://cognition.com/blog/multi-agents-working)

**Thoughtworks / martinfowler.com**
- [OPINION, 2025-10-15] Böckeler's hands-on review of Kiro, spec-kit, and Tessl: Kiro turned a small bug into 4 user stories with 16 acceptance criteria ("sledgehammer to crack a nut"). spec-kit's markdown was "verbose and tedious to review", and she would rather review code. Agents often ignored spec instructions or over-applied them, for example duplicating existing classes described in research notes. She found no clear problem size where SDD fits, and heavy up-front specs conflict with small iterative work packages. — [martinfowler.com](https://www.martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)
- [OPINION] Thoughtworks Radar lists spec-driven development as a technique to watch, but calls current workflows "elaborate and opinionated." — [Thoughtworks Radar](https://www.thoughtworks.com/radar/techniques/spec-driven-development)

**Google**
- [OPINION/SURVEY] DORA's AI Capabilities Model (above) recommends platform, testing, and feedback-loop capabilities rather than any particular agent workflow. — [TechRepublic](https://www.techrepublic.com/article/news-dora-ai-report-2025/)

### Inferences
- **Consensus:** verification over generation (tests, evidence, independent checker), lean context, and plan or explore before editing on non-trivial work.
- **Main disagreement:** multi-agent. Anthropic (research) and Cognition (managers, reviewers) both endorse it in narrow forms. Everyone, including Anthropic, is cautious about multiple agents *writing* code in parallel. The convergent pattern is "many readers/reviewers, one writer."
- **Spec-first:** vendors push it (Kiro, spec-kit), while independent practitioners (Thoughtworks) find it overhead-heavy for small tasks. The disagreement is mostly about weight and size threshold, not about whether intent should be stated up front.

### Gaps
- I could not read the primary OpenAI harness-engineering post or Anthropic's context-engineering post (403 / not fetched). Details come from secondary sources.
- I did not research Google's own agent guidance beyond DORA (for example Gemini CLI or Jules docs).
- The claim that Claude Code ends a turn after 8 consecutive Stop-hook blocks came only from a search snippet of the docs. It is unverified.

## What is the evidence on specific practices: multi-agent cost, independent/blind review, TDD/tests, specs, context files and context rot, task sizing, and long-running failure modes?

### Takeaway
The strongest evidence of benefit is for **executable verification**: tests given to the agent, and an independent reviewer with clean context. The strongest evidence of **cost without proportional benefit** is for parallel multi-agent writing (2–15x tokens, coordination failures), long or auto-generated context files (worse or no better, 20%+ costlier), and heavyweight spec ceremony on small tasks. Context rot is measured and real, which supports small tasks and fresh contexts.

### Cited Findings
**Multi-agent cost and failure**
- [MEASURED] Multi-agent systems use ~15x the tokens of chat (single agents ~4x). Gains came where work parallelizes (research). — [Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system)
- [MEASURED] Empirical evaluation of agent frameworks on code tasks: multi-agent systems take substantially more steps, nearly double on vulnerability detection and program repair. — [arXiv 2511.00872](https://arxiv.org/pdf/2511.00872)
- [MEASURED] Multi-agent code-generation frameworks generally cost more than simpler prompting (run time, CPU, network on HumanEval). — [arXiv 2501.07811 (CodeCoR)](https://arxiv.org/pdf/2501.07811)
- [MEASURED] Among multi-agent methods, Reflexion and MapCoder add the most runtime overhead, and a single-agent baseline is cheapest. — [arXiv 2605.24812 (CoRe-Code)](https://arxiv.org/pdf/2605.24812)
- [MEASURED] MAST taxonomy (1,600+ annotated traces, 7 MAS frameworks, kappa 0.88): 14 failure modes in 3 categories: specification/system design, inter-agent misalignment, and task verification (for example disobeying the spec, premature termination, incorrect verification). Failures stem mainly from system design and inter-agent misalignment, not only model limits. NeurIPS 2025. — [arXiv 2503.13657](https://arxiv.org/html/2503.13657v2); [NeurIPS](https://neurips.cc/virtual/2025/poster/121528)
- [secondary] Gao et al. (UIUC, 2025): the accuracy gap between single- and multi-agent narrows as frontier models improve, while the cost gap widens. They propose routing between the two. Seen only via a third-party summary. — [papers.lunadong.com](https://papers.lunadong.com/paper/7087)
- Anthropic's own failure modes for orchestrators: spawning up to 50 subagents for simple queries, duplicated work from vague task descriptions, subagents distracting each other, and synchronous bottlenecks. — [Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system)

**Independent / blind review and LLM-as-judge**
- [VENDOR-MEASURED] A clean-context reviewer (diff only, no coder context) catches ~2 bugs per PR, ~58% severe. Clean context avoids context rot and catches what the coder overlooked. Downside: multi-cycle loops. — [Cognition 2026-04-22](https://cognition.com/blog/multi-agents-working)
- [MEASURED, PRE-AGENTIC] Self-preference bias: GPT-4 as a judge significantly favors outputs with lower perplexity to it (familiar text), whether self-generated or not. — [arXiv 2410.21819](https://arxiv.org/html/2410.21819v1)
- [MEASURED] MLLM judges show self-preference and within-family bias, and ensembling judges across models mitigates it. — [project page](https://projectpage-1sg1y.kinsta.page/)
- [MEASURED] LLM code reviewers show "systematic overcorrection" when judging requirement conformance (I saw only part of the paper). — [arXiv 2603.00539](https://arxiv.org/pdf/2603.00539)
- [MEASURED] Judging biases appear amplified, not dampened, in stronger reasoning models, which motivates cross-model auditing (appendix finding; I did not see the main results). — [arXiv 2607.28636](https://arxiv.org/pdf/2607.28636)
- [OPINION] Anthropic recommends a fresh verification subagent so the worker isn't grading itself. — [Claude Code docs](https://code.claude.com/docs/en/best-practices?ref=t01.li)

**Tests / TDD**
- [MEASURED] TDFlow (EACL 2026): with human-written tests supplied, a test-driven agent workflow reached 88.8% on SWE-bench Lite and 94.3% on SWE-bench Verified. With self-generated tests it reached 69.8% on Verified. Only 7 cases of test hacking in 800 runs. Writing valid reproduction tests is the main bottleneck. — [arXiv 2510.23761](https://arxiv.org/html/2510.23761v1); [ACL Anthology](https://aclanthology.org/2026.eacl-long.70)
- [MEASURED, PRE-AGENTIC] Earlier Devin report: giving the agent the final unit tests raised the pass rate to 23% on a 100-task sample (not comparable to standard SWE-bench). — [Cognition SWE-bench report](https://cognition.com/blog/swe-bench-technical-report)
- [MEASURED] Generating fail-to-pass tests from issues before the fix is still hard: Auto-TDD reaches 21.7% on SWT-bench Lite. — [arXiv 2412.02883](https://arxiv.org/html/2412.02883v1)
- [SURVEY] DORA lists automated testing and fast feedback loops among the seven capabilities that amplify AI. — [TechRepublic](https://www.techrepublic.com/article/news-dora-ai-report-2025/)

**Context files, specs, and memory**
- [MEASURED] "Evaluating AGENTS.md" (ETH/LogicStar, ICLR 2026; 138 tasks plus SWE-bench): context files don't significantly improve task success. LLM-generated ones reduce success and raise inference cost by over 20%. Agents do follow the files, which drives broader exploration and testing. Recommendation: human-written files should state only minimal requirements. Abstract versions differ on "no improvement" vs "reduce". — [arXiv 2602.11988](https://arxiv.org/abs/2602.11988v1); [ICLR 2026](https://iclr.cc/virtual/2026/10021142)
- [OPINION] Spec-driven tooling: high overhead on small tasks, verbose artifacts that are hard to review, agents ignore or over-apply specs, and no clear size threshold. — [Böckeler 2025-10-15](https://www.martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)
- [OPINION] Keep AGENTS.md as a map, not an encyclopedia (OpenAI harness engineering, via secondary source). — [Yage.ai](https://yage.ai/share/harness-engineering-survey-en-20260312.html)

**Context rot / long context**
- [MEASURED, 2025-07-14] Chroma "Context Rot" (18 models including GPT-4.1, Claude 4, Gemini 2.5, Qwen3): reliability falls as input grows, even on simple tasks. Drops are steeper when needle and question are semantically dissimilar, and with more distractors. Chroma sells retrieval, so a commercial interest has been noted. — [Chroma](https://trychroma.com/research/context-rot); [W&B summary](https://wandb.ai/byyoung3/ml-news/reports/Chroma-Research-Warns-of-Context-Rot-as-LLMs-Falter-with-Long-Inputs--VmlldzoxMzczMjQ4MQ)

**Task sizing / long-running agents**
- [MEASURED] METR time horizons: success probability falls with task length. 80%-reliability horizons are much shorter than 50% horizons, so the reliable task size is smaller than the headline. — [Wikipedia: METR](https://en.wikipedia.org/wiki/METR); [LessWrong](https://www.lesswrong.com/posts/wM9LCAtuza4d3Z7oA/will-ai-progress-accelerate-or-slow-down-projecting-metr)
- [VENDOR] Showcase long-running builds (200k-LOC browser, 100k-LOC C compiler) worked because they had simple, verifiable success criteria, unlike most real software. — [Cognition](https://cognition.com/blog/multi-agents-working)
- [VENDOR-MEASURED] Bigger AI-generated PRs correlate with longer reviews (+91% review time, +154% PR size) and more bugs. — [Augment summary of Faros](https://www.augmentcode.com/guides/ai-productivity-paradox-engineering-delivery)
- [MEASURED] Long-run failure modes: premature termination, incorrect verification, disobeying the spec (MAST). Endless searching, over-spawning, and continuing after enough results (Anthropic). — [arXiv 2503.13657](https://arxiv.org/html/2503.13657v2); [Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system)

### Inferences
Practice scorecard (my synthesis of the findings above):
- **Strong support:** executable tests as the agent's oracle (TDFlow, DORA). Independent clean-context review, ideally by a *different* model or an ensemble, given self-preference bias. Small tasks and PRs (context rot, METR 80% horizon, Faros PR-size/review correlation). Fresh contexts or subagents for read-only exploration.
- **Conditional support:** multi-agent setups only when sub-tasks are truly parallel and read-only, or as reviewers/advisors with one writer. Budget roughly 2–15x tokens. Plan-before-code on non-trivial work (vendor consensus, but no controlled study isolating it).
- **Weak or negative evidence:** parallel writer agents (Cognition, MAST). Long or auto-generated AGENTS.md/CLAUDE.md files (arXiv 2602.11988). Heavyweight spec ceremonies on small changes (Böckeler). LLM self-review by the same model and context (bias literature). Self-generated tests are weaker than human-provided ones (TDFlow 94.3% vs 69.8%).
- **Human checkpoints:** the review bottleneck (Faros, DORA) suggests human review time is the scarce resource. Gates that shrink what humans review (agent pre-review, small PRs) are better supported than gates that add human reading of verbose spec artifacts.

### Gaps
- No controlled study measures persistent cross-session memory (Engram-like stores) for coding-agent outcomes. I found only vendor descriptions of note-taking and compaction.
- No study directly compares blind dual review vs single review for *code* with ground-truth bug labels. Self-preference evidence comes from general LLM-judge work.
- I found no controlled study isolating "plan mode" or plan-first vs direct coding on SWE-bench-style tasks for 2025–2026 agents, so vendor guidance here is opinion.
- Per-mode MAST failure frequencies were not in the snippets I saw.
- The Faros 2026 numbers (incidents tripled) come from FAQ pages, and I could not confirm the methodology.
