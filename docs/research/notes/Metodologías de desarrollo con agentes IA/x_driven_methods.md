# "X-Driven Development" methodologies for AI-agent-assisted software development (other than SDD), as of October 2026

Scope note: about 22 search/fetch calls. Many results were secondary summaries from the search tool; where the claim comes from a secondary source, the note says so. Primary pages fetched in full: Kent Beck "Augmented Coding: Beyond the Vibes" and Simon Willison's "Agentic Engineering Patterns" launch post. Everything else rests on search-result summaries of the cited URL and should be spot-checked before quoting verbatim.

## Q1. Definitions, proponents, dates, core loop/artifacts, agent application, adoption, critiques (per methodology)

### Takeaway
Only a few of these labels have a named originator, a primary text, and vendor or tool adoption: eval-driven development (EDD), context engineering, TDD as an agent guardrail (Beck's augmented coding, Willison's red/green TDD), Plan Mode / Explore-Plan-Code-Commit, and the vibe coding → vibe/agentic engineering vocabulary. Intent-Driven, Prompt-Driven, README-Driven (for agents), Agent-Driven, and Observability-Driven (for agents) are loosely defined labels with competing small-scale definitions. "Outcome-Driven Development" for agents had no traceable source.

### Cited Findings

**Eval-Driven Development (EDD / EDDOps): established practice. The academic and vendor versions came separately.**
- Academic origin: a 2024 arXiv paper by Xia, Lu, Zhu et al. (CSIRO Data61 / UNSW), "Evaluation-Driven Development and Operations of LLM Agents: A Process Model and Reference Architecture" (arXiv 2411.13768; v1 titled "An Evaluation-Driven Approach to Designing LLM Agents"). — [arXiv abs](https://arxiv.org/abs/2411.13768v2); [v3 HTML](https://arxiv.org/html/2411.13768v3)
- Its rationale: the paper borrows from TDD and BDD but argues that pre-specified test cases are not enough. Agents are probabilistic, can give several valid outputs, and adapt their workflows at runtime. — [arXiv v3](https://arxiv.org/html/2411.13768v3)
- Its loop: offline (development-time) and online (runtime) evaluation are unified in one closed feedback loop with human and AI evaluators, and the feedback drives runtime adjustment and redevelopment. The artifacts are a four-step process model and a three-layer reference architecture, derived from a multivocal literature review. — [arXiv v3](https://arxiv.org/html/2411.13768v3); [alphaXiv overview](https://alphaxiv.org/overview/2411.13768v3)
- Vendor usage: Vercel's "Eval-driven development: Build better AI faster" says traditional testing fails on AI's unpredictability. It says Vercel adopted EDD while building v0, and it calls evals "end-to-end tests for AI and other probabilistic systems", combining code-based grading, human feedback, and LLM-based grading. — [Vercel blog](https://vercel.com/blog/eval-driven-development-build-better-ai-faster); [ZenML LLMOps database summary](https://www.zenml.io/llmops-database/eval-driven-development-for-ai-applications)
- Practitioner education: Hamel Husain and Shreya Shankar run a Maven evals course whose listing calls evaluation-driven development the key to faster AI product development. I could not confirm that either coined the term. — [Maven listing](https://maven.com/p/5fb214/the-cold-start-eval-problem-evals-for-new-ai-products); [PromptLayer glossary (secondary)](https://www.promptlayer.com/glossary/hamel-husain)
- Anthropic guidance: "Demystifying evals for AI agents" defines an eval as an input plus grading logic. Its vocabulary is tasks, trials, graders, transcripts, outcomes, and harnesses; it separates capability evals from regression evals and code-based, model-based, and human graders; and it handles non-determinism with pass@k and pass^k. Date unclear: secondary listings say January 2026 or March 2026. — [Anthropic engineering](https://anthropic.com/engineering/demystifying-evals-for-ai-agents); [VerifyWise summary](https://verifywise.ai/ai-governance-library/agentic-evaluation/agent-anthropic-demystifying-evals-2026)
- Note: EDD is mainly about building LLM/agent *products*, where the agent is the system under test. Using evals to steer *coding* agents (for example, behaviour evals of a coding-agent plugin) is a derived use.

**Context Engineering ("Context-Driven Development"): established practice, at vendor and analyst level.**
- Origin of the term: Shopify CEO Tobi Lütke posted on about 18 June 2025 that he preferred "context engineering" to prompt engineering, defining it as "the art of providing all the context for the task to be plausibly solvable by the LLM". Andrej Karpathy amplified it about 25 June 2025, describing it as filling the context window with the right information for the next step. — [Simon Willison, 27 Jun 2025](https://simonwillison.net/2025/jun/27/context-engineering/); [secondary: mrprompts Substack](https://mrprompts.substack.com/p/context-engineering)
- Willison (27 June 2025) wrote that the term "has recently started to gain traction as a better alternative to prompt engineering" and that he thought it "may have sticking power". — [simonwillison.net](https://simonwillison.net/2025/jun/27/context-engineering/)
- Anthropic's "Effective context engineering for AI agents" defines it as strategies for "curating and maintaining the optimal set of tokens" during inference. It names "context rot" and treats context as a finite attention budget. Its techniques are just-in-time retrieval (keeping identifiers and loading content with tools), compaction, structured note-taking, sub-agent architectures, and minimal non-overlapping tool sets. — [Anthropic engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (details partly from secondary summaries: [agentic-ai readthedocs](https://agentic-ai.readthedocs.io/en/latest/ContextEngineering/anthropic/))
- Thoughtworks: a Thoughtworks blog names agents.md, Context7 and Mem0 as context-related technologies. A digest of Technology Radar Vol. 34 (April 2026) says context engineering moved to **Adopt**, with spec-driven development and Agent Skills listed as "feedforward controls" for coding-agent harnesses. Ring placements come from the secondary digest and were not verified on thoughtworks.com. — [Thoughtworks blog](https://www.thoughtworks.com/insights/blog/machine-learning-and-ai/vibe-coding-context-engineering-2025-software-development); [Radar Vol. 34 digest (secondary)](https://agentic-ai.readthedocs.io/en/latest/AgenticTechStack/thoughtworks-radar-vol34/)
- A Thoughtworks Medium piece frames SDD itself as a context-engineering problem: splitting requirements and planning from implementation "essentially compresses the context into specs", with constraints in Cursor rules or AGENTS.md. — [Thoughtworks on Medium](https://thoughtworks.medium.com/spec-driven-development-d85995a81387)
- "Context-Driven Development" as a named methodology: I found no primary source. The real practice is called "context engineering".

**TDD with agents / Kent Beck's "Augmented Coding": established practice with a strong named proponent.**
- Kent Beck, "Augmented Coding: Beyond the Vibes", 25 June 2025. In vibe coding "you don't care about the code, just the behavior of the system". In augmented coding you care about "tidy code that works", meaning complexity, tests, and coverage, but "don't type much of it". — [Beck newsletter](https://newsletter.kentbeck.com/p/augmented-coding-beyond-the-vibes)
- His system-prompt rules include "Always follow the TDD cycle: Red → Green → Refactor", "Always follow the instructions in plan.md", "Always write one test at a time, make it run, then improve structure", "Never mix structural and behavioral changes in the same commit", and "Write just enough code to make the test pass". The artifacts are plan.md and the test suite. — [Beck newsletter](https://newsletter.kentbeck.com/p/augmented-coding-beyond-the-vibes)
- His warning signs that the agent is going off track: loops, functionality nobody asked for, and "cheating" such as disabling or deleting tests. — [Beck newsletter](https://newsletter.kentbeck.com/p/augmented-coding-beyond-the-vibes)
- Beck calls LLM coding tools "genies". He warns that genies left alone consume a project's optionality through single-minded feature focus, and that they lack taste (for example, they grow giant functions instead of refactoring). — [Beck, "Taming the Genie"](https://newsletter.kentbeck.com/p/taming-the-genie-like-kent-beck); [secondary summary](https://velog.io/@qlgks1/Kent-Beck-Augmented-Coding)
- Simon Willison's "Agentic Engineering Patterns" guide (launched 23 Feb 2026) has "Red/green TDD" as its second chapter. The agent writes the tests, watches them fail, and then implements. It guards against broken or unused code and leaves a regression suite as a side effect; the phrase "red/green TDD" is shorthand that capable models already understand. — [Willison red/green TDD](https://simonwillison.net/guides/agentic-engineering-patterns/red-green-tdd/); [launch post](https://simonwillison.net/2026/feb/23/agentic-engineering-patterns)

**Vibe coding → vibe engineering → agentic engineering: an established vocabulary. "Agentic engineering" appears to be winning as the name for the professional practice.**
- Karpathy coined "vibe coding" in an X post on 2 Feb 2025. In Feb 2026 he called that a "shower of thoughts throwaway tweet" and proposed "agentic engineering": "you are not writing the code directly 99% of the time, you are orchestrating agents who do and acting as oversight". He also said models are strongest in verifiable domains, which gives them a "jagged" profile. Secondary coverage only; I did not retrieve Karpathy's primary post. — [The New Stack](https://thenewstack.io/vibe-coding-is-passe-karpathy-has-a-new-name-for-the-future-of-software/); [Let's Data Science](https://letsdatascience.com/news/karpathy-explains-vibe-coding-to-agentic-engineering-2d34b5c2)
- An April 2026 Sequoia AI Ascent interview reportedly repeated that vibe coding was only the start and that agentic engineering is what matters. Chinese secondary write-up only. — [36kr](https://eu.36kr.com/de/p/3670333435798402)
- Willison proposed "vibe engineering" on 7 Oct 2025 for experienced professionals who use coding agents while staying accountable for the code. He called vibe coding "irresponsibly building software through dice rolls". "Vibe engineering" was used earlier by Tselovalnikov (31 Mar 2025) and O'Leary (29 Apr 2025). — [aiwiki (secondary)](https://aiwiki.ai/wiki/vibe_engineering); [developertoolkit glossary (secondary)](https://developertoolkit.ai/en/glossary/vibe-engineering/)
- On 23 Feb 2026 Willison defined agentic engineering as "professional software engineers using coding agents to improve and accelerate their work", and vibe coding (original sense) as ignoring the code entirely. The guide is "loosely modeled on Design Patterns", with chapters such as "Writing code is cheap now" and "Red/green TDD". — [Willison launch post](https://simonwillison.net/2026/feb/23/agentic-engineering-patterns)

**Plan-Driven / Plan Mode workflows: established as a vendor-built feature, not a branded methodology.**
- Anthropic's Claude Code best practices recommend Explore → Plan → Code → Commit. They say to tell Claude not to write code while exploring, to use subagents for investigation, and that "nothing in this list is set in stone". — [Anthropic engineering](https://www.anthropic.com/engineering/claude-code-best-practices)
- The current docs describe four phases (Explore, Plan, Implement, Commit). Plan mode is entered with Shift+Tab or `claude --permission-mode plan`; Claude reads but does not change files, and Ctrl+G opens the plan in an editor. — [Claude Code docs](https://code.claude.com/docs/en/best-practices)
- Beck's plan.md rule ("Always follow the instructions in plan.md") is the same plan-artifact pattern. — [Beck newsletter](https://newsletter.kentbeck.com/p/augmented-coding-beyond-the-vibes)

**Intent-Driven Development (IDD): an emerging label. Several competing definitions, no single originator found.**
- intent-driven.dev defines IDD as building with coding agents "by making your intent explicit and structuring the context around it". Its premise is that agents have no privileged access to your goals, constraints, or domain, so they drift when left to infer intent from short prompts. — [intent-driven.dev](https://intent-driven.dev/knowledge/intent-driven-development/)
- Manning's "Spec-Driven Development" book (chapter 1) calls IDD an AI-native approach to turning implicit intent into language and systems agents can use. It treats SDD and autonomous iteration as complementary to IDD; the bottleneck has moved from writing code to stating intent. — [Manning ch. 1](https://livebook.manning.com/book/spec-driven-development/chapter-1)
- Tools: DimonSmart.IntentDrivenDevelopment.Tool (NuGet) separates durable product intent from temporary tasks and TODOs. The Elixir community "ai-intent-driven-development" guidelines structure each intent as WHY / WHAT / HOW. — [NuGet](https://www.nuget.org/packages/DimonSmart.IntentDrivenDevelopment.Tool); [ElixirForum](https://elixirforum.com/t/ai-intent-driven-development-idd-guidelines-and-instructions-for-ai-coding-agents-ai-coding-assistants-and-llms/73187)
- Vendor framing: Devplan calls intent "the new bottleneck". — [Devplan](https://www.devplan.com/blog/intent-layer-ai-development)

**Prompt-Driven Development (PDD): a descriptive label for the default chat loop, not a disciplined method.**
- Microsoft's dev blog (19 May 2026) calls PDD the "typical starting pattern": open a chat, prompt, review, adjust, re-prompt. It says PDD works for small self-contained tasks, breaks down as scope grows, and that teams move to spec-driven development. — [Microsoft dev blog](https://developer.microsoft.com/blog/agentic-agile-why-agent-development-needs-agile-not-just-prompts/)
- Andrew Miller's Substack: a workflow where the LLM writes most or all of the code and the developer mainly prompts and reviews. — [andrewships Substack](https://andrewships.substack.com/p/prompt-driven-development)
- Academic adjacent: "Agentsway" (arXiv 2510.23664, Oct 2025) proposes a methodology for AI-agent-based teams in which agents such as Claude Code and Codex turn approved prompts into code. — [arXiv 2510.23664](https://arxiv.org/pdf/2510.23664)

**README / Documentation-Driven Development: an old practice (2010), revived informally for agents.**
- Tom Preston-Werner proposed README Driven Development on 23 Aug 2010: write the README before any code. — [Willison link blog, 2010](https://simonwillison.net/2010/Aug/23/readme)
- GitHub Blog's "Spec-driven development: Using Markdown as a programming language" keeps a README for users and a separate Markdown spec that the agent compiles into code. — [GitHub Blog](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-using-markdown-as-a-programming-language-when-building-with-ai/)
- Upsun argues that what agents need (architecture, build and test commands, conventions) is what a good README already holds, so fixing the README matters more than adding agent config files. — [Upsun](https://developer.upsun.com/posts/insights/why-your-readme-matters-more-than-ai-configuration-files)
- I found no statement by Preston-Werner about agents.

**BDD with agents: a real practice, small in scale. Gherkin is used as a structured agent input and output.**
- Automation Panda (Andy Knight), April 2026: agents write good Gherkin only when given explicit rules. Without them you get vague Then steps, UI-heavy scripts, and multi-behaviour scenarios. He published `gherkin-guidelines.md` as a context file for Cursor, Claude, Copilot, and Codex. — [Automation Panda](https://automationpanda.com/2026/04/27/bdd-gherkin-guidelines-for-ai-coding-and-testing/)
- Academic: BDDTestAIGen (ICAART 2025) uses fine-tuned LLMs and agentic AI to generate BDD tests. — [SciTePress](https://scitepress.org/Papers/2025/133744/133744.pdf)
- A University of Bern student project asks whether BDD specifications give better LLM code than informal descriptions. — [Uni Bern](https://seg.inf.unibe.ch/teaching/student-projects/current/t0082-behavior-driven-development-in-the-age-of-ai-assisted-programming/)

**Observability-Driven Development (applied to agents): established for services, only adjacent for coding agents.**
- Gartner's shift-left term "observability-driven development" means instrumenting code so its internal state shows through external data. — [The New Stack](https://thenewstack.io/observability-in-2025-opentelemetry-and-ai-to-fill-in-gaps/)
- Charity Majors (March 2025) says generative and agentic AI make observability principles, including testing and debugging in production, "more true than ever". She also says separating GenAI observability from software observability is "doomed". — [TechTarget](https://www.techtarget.com/searchitoperations/podcast/Charity-Majors-on-AI-observability-and-the-future-of-SRE)
- An ITNext piece argues that non-deterministic agent behaviour makes fast feedback loops more important. — [ITNext](https://itnext.io/agent-observability-can-the-old-playbook-handle-the-new-game-72c3f4581524)
- EDDOps's "online evaluation" layer is the agent-specific form of this. — [arXiv v3](https://arxiv.org/html/2411.13768v3)

**Agent-Driven Development (ADD): a marketing label.**
- Consultancy Twoday presents "Agent Driven Development" as a new operating model built on a spec-driven approach. That is promotional company content. — [Twoday](https://www.twoday.com/blog/agent-driven-development-transforms-the-software-industry)
- A GitHub topic page for "agent-driven-development" lists small projects that pair it with "spec-driven TDD" and "trust-but-verify orchestration". — [GitHub topic mirror](https://proxy-ga.blitzz.co/proxy/123456/github.com/topics/agent-driven-development)

### Inferences
- The real practices share one property: each names an artifact or check the agent cannot fake on its own, such as a failing test, an eval score, a plan the human approves, or curated context. The marketing labels mostly rename "write things down before prompting".
- IDD is closest to SDD. It differs mainly in insisting that durable *intent* (why and what) is kept apart from disposable tasks and implementation detail.
- PDD is the baseline the other methods are reacting against. Few people advocate it as a method.

### Gaps
- Karpathy's primary February 2026 post and its exact date were not retrieved; only secondary coverage.
- Willison's 7 Oct 2025 "Vibe engineering" post was not fetched directly; its date rests on secondary glossaries and his feed listing.
- The publication date of Anthropic's "Demystifying evals for AI agents" is unclear (secondary sources disagree: Jan 2026 vs Mar 2026).
- The Thoughtworks Radar ring placements (context engineering in Adopt, SDD in Assess) were not verified on thoughtworks.com.
- "Outcome-Driven Development" applied to coding agents: no traceable source found. Treat it as not an established term.
- Value Sensitive Design (Batya Friedman's tradition) was not researched within the budget. I found nothing tying it to coding-agent workflows, and it is likely not relevant as an "X-driven" agent method.
- No source found for "Context-Driven Development" as a distinct named method, separate from context engineering.

## Q2. Which have the most traction (talks, tools, vendor adoption, papers)?

### Takeaway
By evidence found: (1) context engineering, with frontier-lab guidance, a Thoughtworks Radar Adopt placement (secondary), and wide uptake; (2) the vibe → agentic engineering vocabulary, used by Karpathy and Willison with mainstream press coverage; (3) evals / EDD, with an arXiv process model, Vercel, an Anthropic guide, and paid courses; (4) TDD as an agent guardrail, backed by Beck and Willison; (5) plan mode, which ships in Claude Code. IDD, PDD, ADD, README-driven, and BDD-for-agents have niche tools or blog-level traction only.

### Cited Findings
- Context engineering: Anthropic engineering guide [link](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents); Thoughtworks Radar Vol. 34 Adopt (secondary) [link](https://agentic-ai.readthedocs.io/en/latest/AgenticTechStack/thoughtworks-radar-vol34/); Willison predicting "sticking power" [link](https://simonwillison.net/2025/jun/27/context-engineering/)
- EDD: arXiv paper in three versions [link](https://arxiv.org/html/2411.13768v3); Vercel production usage for v0 [link](https://vercel.com/blog/eval-driven-development-build-better-ai-faster); Anthropic agent evals guide [link](https://anthropic.com/engineering/demystifying-evals-for-ai-agents); Google Cloud Next session "Demystifying evals at the frontier of agentic development" [link](https://www.googlecloudevents.com/next-vegas/session/3890820/demystifying-evals-at-the-frontier-of-agentic-development)
- Agentic engineering: Karpathy coverage [link](https://thenewstack.io/vibe-coding-is-passe-karpathy-has-a-new-name-for-the-future-of-software/); Willison guide [link](https://simonwillison.net/guides/agentic-engineering-patterns)
- TDD guardrail: Beck [link](https://newsletter.kentbeck.com/p/augmented-coding-beyond-the-vibes); Willison [link](https://simonwillison.net/guides/agentic-engineering-patterns/red-green-tdd/)
- Plan mode as a product feature: [Claude Code docs](https://code.claude.com/docs/en/best-practices)
- IDD: small NuGet tool, community guidelines, a book chapter [NuGet](https://www.nuget.org/packages/DimonSmart.IntentDrivenDevelopment.Tool), [Manning](https://livebook.manning.com/book/spec-driven-development/chapter-1)

### Inferences
- Traction follows backing by a frontier lab or IDE vendor: context engineering, evals, and plan mode all ship in, or are documented by, the vendors that build the agents.

### Gaps
- No quantitative adoption data (surveys, download counts) was found for any of these.

## Q3. Overlaps, conflicts, and complementary layers

### Takeaway
These are mostly layers of one stack, not rival methods: context engineering is the substrate; SDD, IDD, README-driven, and plan mode are feedforward artifacts; TDD, BDD, and evals are feedback and verification; observability and online evals cover runtime. Thoughtworks' "feedforward controls" framing supports this reading. The real tension runs along one axis, from vibe coding / PDD (no durable artifacts, the human ignores the code) to augmented or agentic engineering (human accountability, tests, tidy code).

### Cited Findings
- Thoughtworks digest: SDD and Agent Skills are feedforward controls in coding-agent harnesses; context engineering is an architectural concern. — [Radar Vol. 34 digest (secondary)](https://agentic-ai.readthedocs.io/en/latest/AgenticTechStack/thoughtworks-radar-vol34/)
- SDD as compressed context, so SDD sits inside context engineering. — [Thoughtworks Medium](https://thoughtworks.medium.com/spec-driven-development-d85995a81387)
- EDD descends from TDD and BDD but replaces fixed test cases with offline and online evaluation, which suits probabilistic outputs. It is a superset of TDD for nondeterministic systems. — [arXiv v3](https://arxiv.org/html/2411.13768v3)
- Beck combines plan.md (plan-driven) with strict TDD (verification) and separate structure and behaviour commits. This is one hybrid workflow. — [Beck newsletter](https://newsletter.kentbeck.com/p/augmented-coding-beyond-the-vibes)
- Microsoft presents PDD → SDD as a maturity step as scope grows. — [Microsoft dev blog](https://developer.microsoft.com/blog/agentic-agile-why-agent-development-needs-agile-not-just-prompts/)
- Manning treats IDD as the umbrella, with SDD and autonomous iteration as complementary. — [Manning ch. 1](https://livebook.manning.com/book/spec-driven-development/chapter-1)
- Upsun: README vs AGENTS.md is a turf overlap between documentation-driven and context-file practices. — [Upsun](https://developer.upsun.com/posts/insights/why-your-readme-matters-more-than-ai-configuration-files)
- Anthropic's Explore → Plan → Code → Commit uses subagents for investigation to keep the main context clean. Plan mode and context engineering work together here. — [Anthropic engineering](https://www.anthropic.com/engineering/claude-code-best-practices)

### Inferences
- A suggested stack for comparison with SDD and with an "Organic Driven Development" orchestration approach. This is my synthesis, not a sourced claim:
  - context layer: context engineering, AGENTS.md, skills, memory
  - intent and spec layer: IDD, SDD, README-first, plan mode / plan.md
  - per-change verification: red/green TDD, BDD scenarios
  - system-level verification: EDD offline evals and graders
  - runtime: observability and online evals
  - stance: agentic engineering, meaning human accountability
- An orchestration approach that injects a contract via hooks, routes roles, and gates on reviews and tests is, in these terms, a harness that combines context engineering (layered or just-in-time contracts and skills) with feedforward (plan and spec) and feedback (TDD and review lenses) controls. EDD would apply to evaluating the orchestration itself, for example behaviour evals of agent rituals.
- Points of conflict:
  - heavy upfront specs (SDD/IDD) vs Beck-style incremental "one test at a time"
  - pre-specified tests (TDD) vs probabilistic acceptance criteria (EDD)
  - PDD/vibe coding's disposable artifacts vs every other method's durable ones.

### Gaps
- No empirical study was found comparing these methods head-to-head on coding-agent outcomes.
- Critiques of EDD's cost (eval-suite maintenance, LLM-judge reliability) and of plan mode were not specifically sourced within the budget.
