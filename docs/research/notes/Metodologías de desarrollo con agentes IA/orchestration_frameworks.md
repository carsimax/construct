# Workflow and orchestration frameworks on top of AI coding agents (state as of 2026-10-27)

Scope: frameworks that structure *how* an agent works (phases, roles, skills, hooks, gates, review, memory), not pure spec tooling. Spec tools (Spec Kit, Kiro, Tessl, BMAD, OpenSpec) are covered elsewhere. In one line: GSD Core, CCPM, cc-sdd and claude-code-spec-workflow sit on the boundary because they are spec-driven loops with an orchestration layer.

Popularity numbers are GitHub stargazer counts read through the GitHub REST API on 2026-10-27 (`gh api repos/<owner>/<repo>`). Creation and last-push dates come from the same call.

## 1. Which frameworks exist and how popular are they?

### Takeaway
The field consolidated in 2025-2026 around a few cross-harness "methodology plugins". The largest by stars are obra/superpowers (~306k) and affaan-m/ECC (~291k). Next come ruflo (ex claude-flow, ~80k), OmO (ex oh-my-opencode, ~70k), GSD (~64k), wshobson/agents (~42k) and oh-my-claudecode (~40k). Almost all now target several harnesses (Claude Code, Codex, Cursor, OpenCode, Gemini CLI, Copilot CLI, Pi) instead of one. Roo Code, the host of SPARC and Boomerang, has been discontinued.

### Cited Findings
Popularity table (GitHub API, 2026-10-27):

| Framework | Repo | Stars | Created | Last push | Source |
|---|---|---|---|---|---|
| Superpowers | obra/superpowers | 306,462 | 2025-10-09 | 2026-10-23 (v7.0.1, 2026-10-21) | [GitHub](https://github.com/obra/superpowers) |
| ECC (formerly "everything-claude-code") | affaan-m/ECC | 290,910 | 2026-01-18 | 2026-10-26 | [GitHub](https://github.com/affaan-m/ECC) |
| Ruflo (formerly claude-flow) | ruvnet/ruflo (`ruvnet/claude-flow` redirects here) | 79,804 | 2025-06-02 | 2026-10-28 | [GitHub](https://github.com/ruvnet/ruflo) |
| OmO (formerly oh-my-opencode) | code-yeongyu/oh-my-openagent | 70,403 | 2025-12-03 | 2026-10-28 | [GitHub](https://github.com/code-yeongyu/oh-my-openagent) |
| Get Shit Done (GSD) | gsd-build/get-shit-done (archived redirect) → open-gsd/gsd-core | 64,205 (old) / 10,936 (new) | 2025-12-14 / 2026-05-22 | 2026-05-31 / 2026-10-28 | [old](https://github.com/gsd-build/get-shit-done), [new](https://github.com/open-gsd/gsd-core) |
| wshobson/agents | wshobson/agents | 41,885 | 2025-07-24 | 2026-10-26 | [GitHub](https://github.com/wshobson/agents) |
| oh-my-claudecode (OMC) | Yeachan-Heo/oh-my-claudecode | 40,333 | 2026-01-09 | 2026-10-27 | [GitHub](https://github.com/Yeachan-Heo/oh-my-claudecode) |
| 12-Factor Agents (HumanLayer principles) | humanlayer/12-factor-agents | 26,896 | 2025-03-30 | 2025-09-21 | [GitHub](https://github.com/humanlayer/12-factor-agents) |
| AGENTS.md format | agentsmd/agents.md | 25,166 | 2025-08-19 | 2026-09-10 | [GitHub](https://github.com/agentsmd/agents.md) |
| Roo Code (hosted SPARC/Boomerang) | RooCodeInc/Roo-Code | 24,254, **archived** | 2024-10-31 | 2026-05-15 | [GitHub](https://github.com/RooCodeInc/Roo-Code) |
| SuperClaude | SuperClaude-Org/SuperClaude_Framework | 23,912 | 2025-06-22 | 2026-09-27 | [GitHub](https://github.com/SuperClaude-Org/SuperClaude_Framework) |
| Ralph (Ryan Carson's PRD loop) | snarktank/ralph | 22,078 | 2026-01-07 | 2026-02-02 | [GitHub](https://github.com/snarktank/ralph) |
| HumanLayer (RPI skills + platform) | humanlayer/humanlayer | 12,665 | 2024-08-05 | 2026-10-27 | [GitHub](https://github.com/humanlayer/humanlayer) |
| ralph-claude-code | frankbria/ralph-claude-code | 9,717 | 2025-08-27 | 2026-10-25 | [GitHub](https://github.com/frankbria/ralph-claude-code) |
| CCPM | automazeio/ccpm | 8,421 | 2025-08-18 | 2026-10-19 | [GitHub](https://github.com/automazeio/ccpm) |
| TDD Guard (now "Probity") | nizos/tdd-guard | 2,369 | 2025-07-07 | 2026-10-26 | [GitHub](https://github.com/nizos/tdd-guard) |
| how-to-ralph-wiggum | ghuntley/how-to-ralph-wiggum | 1,768 | 2026-01-10 | 2026-01-11 | [GitHub](https://github.com/ghuntley/how-to-ralph-wiggum) |
| ruvnet/sparc | ruvnet/sparc | 478 | 2024-10-07 | n/a | [GitHub](https://github.com/ruvnet/sparc) |
| Cline (Memory Bank host) | cline/cline | 70,937 | 2024-07-06 | 2026-10-28 | [GitHub](https://github.com/cline/cline) |

Context and adjacent catalogs: hesreallyhim/awesome-claude-code has 56,689 stars ([GitHub](https://github.com/hesreallyhim/awesome-claude-code)). VoltAgent/awesome-claude-code-subagents has 26,116 ([GitHub](https://github.com/VoltAgent/awesome-claude-code-subagents)). davila7/claude-code-templates has 32,942 ([GitHub](https://github.com/davila7/claude-code-templates)). anthropics/claude-plugins-official has 44,954 ([GitHub](https://github.com/anthropics/claude-plugins-official)). For scale, the spec tools out of scope stand at BMAD-METHOD 54,643 ([GitHub](https://github.com/bmad-code-org/BMAD-METHOD)) and OpenSpec 73,174 ([GitHub](https://github.com/Fission-AI/OpenSpec)).

Distribution and adoption signals:
- Superpowers is in Anthropic's official Claude plugin marketplace (`/plugin install superpowers@claude-plugins-official`) and in the official Codex plugin marketplace. It also installs on Cursor, Gemini CLI, Copilot CLI, OpenCode, Antigravity, Devin CLI, Factory Droid, Grok Build, Kimi Code, Qwen Code, Pi and Hermes — [superpowers README](https://github.com/obra/superpowers)
- Superpowers is built by Jesse Vincent and Prime Radiant, which offers commercial enterprise support. It was first announced on 2025-10-09 — [README](https://github.com/obra/superpowers); [release post](https://blog.fsck.com/2025/10/09/superpowers/)
- wshobson/agents: 94 plugins, 202 agents, 185 skills and 105 commands. Contributors keep one Markdown source in Claude Code plugin format, and adapters generate the formats for Codex, Cursor, OpenCode, Antigravity, Copilot and Pi — [wshobson/agents README](https://github.com/wshobson/agents)
- ECC: 71 agents, 311 skills, 97 legacy command shims, plus hooks, memory, "continuous learning", and AgentShield security scanning. It installs into Claude Code, Codex, Qoder and Kimi Code — [ECC README](https://github.com/affaan-m/ECC)
- Ruflo describes itself as "Built by Reuven Cohen (rUv), originally as Claude Flow", with a first commit on 2025-06-02. The full install advertises "98 agents, 60+ commands, 30 skills, MCP server, hooks, daemon" and "314 MCP tools" — [ruflo README](https://github.com/ruvnet/ruflo)
- OmO (oh-my-opencode) moved off OpenCode. OmO 5.0 runs on "senpi, our fork of pi" as a standalone `omo` binary, and `omo setup` migrates users from the OpenCode edition — [OmO README](https://github.com/code-yeongyu/oh-my-openagent)
- GSD moved: "This repository is no longer the active home… continues as GSD Core in the Open GSD repository" — [gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done)
- Roo Code is archived on GitHub (API `archived: true`, last push 2026-05-15) — [GitHub](https://github.com/RooCodeInc/Roo-Code). A search summary of a Japanese article dated October 2026 says Roo Code ended service on 2026-05-15 and names "Zoo Code" as a successor — [issoh.co.jp](https://www.issoh.co.jp/md/tech/6211) (secondary source, not verified directly).
- Anthropic's official marketplace ships its own workflow plugins: `code-review`, `feature-dev`, `hookify`, `pr-review-toolkit`, `ralph-loop` — [claude-plugins-official/plugins](https://github.com/anthropics/claude-plugins-official/tree/main/plugins)

### Inferences
- Star counts near 300k for Superpowers and ECC are an order of magnitude above the rest and above most dev tools. Treat them as relative popularity at best. Stars can be inflated, and I found no independent install telemetry.
- The common trajectory is "Claude Code prompt pack → multi-harness plugin → standalone harness or platform". OmO forked Pi. HumanLayer became a hosted platform ("riptide"). Ruflo is now a "meta-harness" with a daemon.
- GSD's star split (64k old vs 11k new) shows that a repo move loses most of the visible popularity.

### Gaps
- No reliable install or usage telemetry for any framework, only stars.
- I did not find the current home or star count of the original "Sisyphus" OpenCode agent. The OmO README no longer uses the name. OMC's npm package is still called `oh-my-claude-sisyphus` ([OMC README](https://github.com/Yeachan-Heo/oh-my-claudecode)).

## 2. How each framework structures work (phases, roles, discipline, verification, memory, routing, artifacts, sizing)

### Takeaway
Two families. **Prompt/skill methodologies** (Superpowers, SuperClaude, Memory Bank, RPI, Anthropic and OpenAI guidance) enforce discipline mostly through injected instructions and skill descriptions. **Harness and loop systems** (Ralph loop, ralph-claude-code, OMC, Ruflo, ECC, TDD Guard) add deterministic enforcement through Stop or PreToolUse hooks, external bash loops, circuit breakers, or daemons. Almost none gates *publication* (push or PR) on recorded reviews. Superpowers reviews per task and blocks on critical issues, but in-prompt. Anthropic's docs explicitly recommend command hooks for any rule that "can't have exceptions".

### Cited Findings

#### obra/superpowers (v7.0.1, 2026-10-21)
- **Injection:** one `SessionStart` hook (matcher `startup|clear|compact`) runs `hooks/session-start`. It injects the `using-superpowers` bootstrap, which makes the agent check for skills before any task. No other hook events are registered — [hooks/hooks.json](https://github.com/obra/superpowers/blob/main/hooks/hooks.json); [README](https://github.com/obra/superpowers)
- **Skills (15):** brainstorming, using-git-worktrees, writing-plans, executing-plans, subagent-driven-development, dispatching-parallel-agents, test-driven-development, systematic-debugging, verification-before-completion, requesting-code-review, receiving-code-review, finishing-a-development-branch, writing-skills, using-superpowers, diagnosing-superpowers — [skills/](https://github.com/obra/superpowers/tree/main/skills)
- **Phases:** brainstorming → worktree → writing-plans → subagent-driven-development or executing-plans → TDD → requesting-code-review between tasks → finishing-a-development-branch (merge/PR/keep/discard). "Mandatory workflows, not suggestions" — [README](https://github.com/obra/superpowers)
- **Sizing:** "Small changes get agreed in chat; projects get a written design document". Plans are split into "bite-sized tasks (2-5 minutes each)" with exact file paths, complete code and verification steps — [README](https://github.com/obra/superpowers)
- **Roles:** no agents directory (the `agents/` path returns 404). Roles are prompt templates inside the SDD skill: implementer, task reviewer (spec compliance + code quality), and a final whole-branch reviewer. "Critical issues block progress" — [SDD SKILL.md](https://github.com/obra/superpowers/blob/main/skills/subagent-driven-development/SKILL.md); [README](https://github.com/obra/superpowers)
- **Execution autonomy:** SDD says "Do not pause to check in… between tasks". Decisions go into a ledger as `Ruling: <what> — <why> — <cost if wrong>`. Only four things stop the agent: irreversible or destructive ops, security-sensitive actions, external side effects such as a merge, push or publish, and a plan "so broken that every path forward is a guess" — [SDD SKILL.md](https://github.com/obra/superpowers/blob/main/skills/subagent-driven-development/SKILL.md)
- **Memory:** a per-plan git-ignored workspace under `.superpowers/sdd/` with a `progress.md` ledger. The rationale: "controllers that lost their place have re-dispatched entire completed task sequences — the single most expensive failure observed" — [SDD SKILL.md](https://github.com/obra/superpowers/blob/main/skills/subagent-driven-development/SKILL.md)
- **TDD strictness:** the TDD skill "Deletes code written before tests" — [README](https://github.com/obra/superpowers)
- **Self-diagnosis:** the `diagnosing-superpowers` skill reads the session transcript and reports why skills misfired or tokens were burned — [README](https://github.com/obra/superpowers)
- **Model routing:** none found in the README.

#### HumanLayer: Research → Plan → Implement / Advanced Context Engineering ("frequent intentional compaction")
- **Phases:** Research (understand the code and information flow), Plan (exact changes, files, per-phase test and verification steps), Implement (phase by phase, compacting status back into the plan after each verified phase). Only implementation runs in a git worktree — [ace-fca.md](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/ace-fca.md)
- **Context rule:** "keeping utilization in the 40%-60% range". "You only have approximately 170k of context window". "Subagents are about context control", not role-play — [ace-fca.md](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/ace-fca.md)
- **Human gates:** human review goes to research and plans, the "highest-leverage" points. "A bad line of a plan could lead to hundreds of bad lines of code". "I can't read 2000 lines of golang daily. But I can read 200 lines of a well-written implementation plan." — [ace-fca.md](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/ace-fca.md)
- **Artifacts:** `thoughts/shared/research/`, `thoughts/shared/plans/`, and the commands `research_codebase.md`, `create_plan.md`, `implement_plan.md` in `.claude/commands/` — [ace-fca.md](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/ace-fca.md)
- **Claimed results:** a BAML bug fix in a 300k-LOC Rust codebase was merged. About 35k LOC were shipped in about 7 hours. A team of three spent about $12k/month on Opus. A failure case: a parquet-java Hadoop removal "did not go well" — [ace-fca.md](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/ace-fca.md) (author's own claims, published around August 2025 per in-text references).
- **Current form:** the RPI skills ship as `apps/riptide-rpi-claude-plugin`. The skill set has grown beyond three phases: create-research-questions, create-research, create-design-discussion, create-structure-outline, create-prd, create-tdd, create-plan, describe-pr, ci-commit. The HumanLayer repo is now a platform that runs Claude Code, Codex, OpenCode and Pi on your machines, with "tasks, sessions, plans, and reviews" synced across apps — [humanlayer README](https://github.com/humanlayer/humanlayer); [repo tree](https://github.com/humanlayer/humanlayer/tree/main/apps/riptide-rpi-claude-plugin/skills)
- **Overlap:** 12-Factor Agents is the principles document for building LLM software (26.9k stars, last push 2025-09-21). It is not a coding workflow — [GitHub](https://github.com/humanlayer/12-factor-agents)

#### Ralph Wiggum loop (Geoffrey Huntley, 2025-07-14) and descendants
- **Core:** `while :; do cat PROMPT.md | claude-code ; done`. "Only one thing" per loop. Specs live one per file in a specs folder, the plan in `@fix_plan.md`, and the agent should "deterministically allocate the stack the same way every loop" — [ghuntley.com/ralph](https://ghuntley.com/ralph/)
- **Subagents and backpressure:** the main context acts as a scheduler. Searches and writes can run in parallel subagents, but builds and tests run in only one. Tests, typecheckers and static analyzers provide "back pressure" — [ghuntley.com/ralph](https://ghuntley.com/ralph/)
- **Author's own limits:** models tend toward placeholder implementations. Ralph may wrongly conclude something is unimplemented and duplicate it ("the Achilles' heel"). You may wake up to a non-compiling codebase. "There's no way in heck would I use Ralph in an existing code base" — [ghuntley.com/ralph](https://ghuntley.com/ralph/)
- **Anthropic `ralph-loop` plugin:** implements the loop with a **Stop hook** that blocks exit and feeds back the same prompt until a `--completion-promise` string appears. It runs inside the session, with state persisting in files and git — [ralph-loop README](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/ralph-loop)
- **snarktank/ralph (Ryan Carson):** a `/prd` skill writes `tasks/prd-*.md`, and a `/ralph` skill converts it to `prd.json`. `ralph.sh` (Amp or Claude Code, default 10 iterations) then picks the highest-priority story with `passes: false`, implements it, runs typecheck and tests, commits if they pass, marks it `passes: true`, and appends learnings to `progress.txt`. Each iteration is a fresh instance — [snarktank/ralph](https://github.com/snarktank/ralph)
- **frankbria/ralph-claude-code:** a "dual-condition exit gate" (completion indicators plus an explicit `EXIT_SIGNAL`), rate limiting (100 calls/hour), a circuit breaker for stuck loops, and a three-layer API-limit detector — [README](https://github.com/frankbria/ralph-claude-code)

#### oh-my-claudecode (OMC) and OmO (oh-my-opencode lineage)
- **OMC:** the canonical surface since v4.1.7 is Team mode, a staged pipeline `team-plan → team-prd → team-exec → team-verify → team-fix (loop)`. It uses Claude Code native agent teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) or tmux CLI workers running codex, gemini, antigravity, claude or cursor — [OMC README](https://github.com/Yeachan-Heo/oh-my-claudecode)
- **OMC autopilot profiles:** allowed stage sequences are `[ralplan, execution]`, `[ralplan, execution, ralph]`, `[ralplan, execution, qa]` and `[ralplan, execution, ralph, qa]`. "Ralph" is the persistence-until-verified stage — [OMC README](https://github.com/Yeachan-Heo/oh-my-claudecode)
- **OMC roles and routing:** "19 specialized agents (with tier variants)". "Smart model routing - Haiku for simple tasks, Opus for complex reasoning", claimed to save "30-50% on tokens". Role names include executor, critic, code-reviewer and security-reviewer. Per-role routing for external workers is set via `team.roleRouting.<role>.model`. Prompt keywords include `deepsearch` and `ultrathink` — [OMC README](https://github.com/Yeachan-Heo/oh-my-claudecode)
- **OmO:** the `ultrawork`/`ulw` keyword makes the agent read the codebase, plan, "prove each step before moving on", and verify "on the real surface". `mass ulw` fans the job out to "a graph of agents", each on the model that fits it. "Kibitzer" memory is a git repo of Markdown files, with "a small, cheap model" beside the main agent that "nudges the main agent before it repeats a mistake". Ultragoal and UltraQA ideas come from oh-my-codex — [OmO README](https://github.com/code-yeongyu/oh-my-openagent)

#### Ruflo (claude-flow) and SPARC
- **Architecture:** "User → Ruflo (CLI/MCP) → Router → Swarm → Agents → Memory → LLM providers". "The hooks system automatically routes tasks, learns from successful patterns, and coordinates agents". The `ruflo-mods` plugin "routes prompts and enforces policy in-process". The lite plugin path installs no hooks. The full path installs hooks, a daemon and an MCP server — [ruflo README](https://github.com/ruvnet/ruflo)
- **Plugins:** swarm, autopilot (autonomous loop), federation across machines, agentdb (vector memory), rag-memory, rvf (save/restore memory), intelligence ("learn from past successes"), goals, jujutsu (diff risk scoring and reviewer suggestions), ddd, `ruflo-sparc` ("Guided 5-phase development methodology with quality gates"), metaharness — [ruflo README](https://github.com/ruvnet/ruflo)
- **SPARC:** Specification, Pseudocode, Architecture, Refinement, Completion. It was originally a custom Roo Code "SPARC Orchestrator" mode (`.roomodes`) that delegated subtasks. Roo later built in Orchestrator ("Boomerang") mode, where each subtask has its own isolated context — [Roo docs: boomerang tasks](https://docs.roocode.com/features/boomerang-tasks); [ruvnet gist](https://gist.github.com/elepopp/074333fd9d73c053d0764bd55c95173f) (via search summary)

#### SuperClaude (v4.3.0 stable; v5.0 announced, not yet available)
- A "meta-programming configuration framework" that works through "behavioral instruction injection and component orchestration". It has 30 `/sc:*` slash commands, 20 specialized agents (including a PM Agent for "continuous learning through systematic documentation" and a Deep Research agent), 7 behavioral modes, and "confidence-based validation". Optional MCPs: Serena (session persistence), Sequential, Tavily, Context7, Mindbase. The built-in memory is "ReflexionMemory". It installs from PyPI — [SuperClaude README](https://github.com/SuperClaude-Org/SuperClaude_Framework)

#### ECC (affaan-m)
- Advertised loop: "plan -> test -> implement -> review -> verify -> remember -> improve". It "reviews its own work from a fresh context". Hooks provide "enforcement, session summaries, continuous learning, instincts, and context controls". The installer offers a user-selectable "hook profile" (e.g. Standard). `continuous-learning-v2` holds "instinct-based learning with confidence scoring" with `/instinct-status|import|export` — [ECC README](https://github.com/affaan-m/ECC)

#### wshobson/agents
- A catalog rather than a methodology: plugins group specialist agents, skills and commands (e.g. `python-development` has 3 agents and 16 skills). Agents declare model aliases (`opus`, `sonnet`, `haiku`, `fable`, `inherit`) that adapters map per harness, which gives static per-agent model routing — [wshobson/agents README](https://github.com/wshobson/agents)

#### GSD Core (Get Shit Done; spec/orchestration boundary)
- A five-step loop per phase: Discuss → Plan ("verify the plan fits a fresh context window") → Execute ("parallel waves; each executor starts with a clean 200k-token context") → Verify → Ship (create PR, archive phase). It targets "context rot" by running heavy work in fresh subagents with structured artifacts. Commands: `/gsd-new-project`, `/gsd-onboard` — [GSD Core README](https://github.com/open-gsd/gsd-core)

#### CCPM (spec/orchestration boundary)
- PRD → epic → GitHub issues → parallel agents in git worktrees. GitHub Issues serve as the shared memory and state — [CCPM README](https://github.com/automazeio/ccpm)

#### Cline Memory Bank
- A custom-instructions convention: six files (`projectbrief.md`, `productContext.md`, `activeContext.md`, `systemPatterns.md`, `techContext.md`, `progress.md`) that Cline "MUST" read at the start of every task. "update memory bank" triggers a full review of all files. Nothing enforces it beyond the prompt — [Cline docs: Memory Bank](https://docs.cline.bot/features/memory-bank)

#### TDD Guard / Probity (gate-only tool)
- Hook-based TDD enforcement: it "blocks implementation without failing tests" and "prevents code beyond current test requirements". The validation model is configurable (faster vs more capable), it can be toggled per session, and there is a "strengthening enforcement" guide against agent bypass. It grew into Probity for Claude Code, Codex and Copilot CLI — [tdd-guard README](https://github.com/nizos/tdd-guard)

#### Anthropic Claude Code best practices (current docs)
- The current page no longer leads with "explore-plan-code-commit". It is organized as "tell Claude what it can't see, give it a check to run, and enforce the rules that can't have exceptions" — [Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- **Deterministic vs non-deterministic:** prompts, CLAUDE.md and skills are model-decided. Hooks, deny rules and managed settings are harness-enforced. "If something has to happen every time, make it a hook, a deny rule, or a managed setting. CLAUDE.md is for guidelines, and Claude is allowed to decide a guideline doesn't apply." `prompt`/`agent` hooks are not deterministic. For real enforcement, use `command`/`http` hooks with `onFailure: "block"` — [best practices](https://code.claude.com/docs/en/best-practices)
- **Verification ladder:** in the prompt → `/goal` (a separate model checks the condition each turn) → Stop hook (exit 2 sends Claude back; capped at 8 consecutive blocks, configurable via `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`) → review by "someone who didn't write the code" (`/code-review` in a fresh subagent). Also: "ask Claude for evidence", and `/verify` builds and runs the app — [best practices](https://code.claude.com/docs/en/best-practices)
- **Spec-first for unclear work:** "Interview me until you could write the spec, then write it to SPEC.md", then build from a fresh session. Review the diff against SPEC.md with "skip style", because "A reviewer that's asked to find problems will always find something" — [best practices](https://code.claude.com/docs/en/best-practices)
- **Roles via tool limits:** a reviewer subagent with only `tools: Read, Grep, Glob` "is enforced by Claude Code rather than requested in a prompt". Built-in Explore takes broad searches. Use `model: haiku` for simple subagent work — [best practices](https://code.claude.com/docs/en/best-practices)
- **"What you can stop doing":** "manage [context] aggressively" (most models now have a 1M window with auto-compaction). "Use subagents to protect your context window". "Delegate to a subagent for a better answer" ("A fresh reviewer does help… which is a different thing from delegating"). ALL-CAPS emphasis ("makes Claude over-apply the rule"). "think harder" phrases (effort is the control). "loop until done" lines ("more likely to cause over-work"). Describing architecture in CLAUDE.md — [best practices](https://code.claude.com/docs/en/best-practices)
- **Steering:** after two failed corrections, `/clear` and write a better prompt — [best practices](https://code.claude.com/docs/en/best-practices)

#### OpenAI Codex best practices / AGENTS.md
- AGENTS.md is "an open-format README for agents": repo layout, run/build/test/lint commands, conventions, do-not rules, how to verify. Keep it short, and add rules only after repeated mistakes. Files can be nested, and the closer file wins — [Codex best practices](https://learn.chatgpt.com/guides/best-practices) (redirected from developers.openai.com/codex/learn/best-practices; undated)
- Plan mode for complex or ambiguous work ("gather context, ask clarifying questions"), or an interview, or a PLANS.md template. Verification: write or update tests, run checks, review the diff. `/review` works against a base branch, uncommitted changes or a commit, and teams can reference `code_review.md` from AGENTS.md — [Codex best practices](https://learn.chatgpt.com/guides/best-practices)
- Skills: "Keep each skill scoped to one job". Subagents "offload bounded work from the main thread". "skills define the method and scheduled tasks define the schedule" — [Codex best practices](https://learn.chatgpt.com/guides/best-practices)
- **Sizing by effort:** small, well-scoped work → Low reasoning. Complex changes or debugging → Medium or High. Long agentic work → Extra High. "one chat per coherent unit of work" — [Codex best practices](https://learn.chatgpt.com/guides/best-practices)

### Inferences
- **Enforcement spectrum** (from the cited mechanisms):
  - Prompt only: Memory Bank, SuperClaude, Codex AGENTS.md, RPI commands.
  - Prompt plus a SessionStart bootstrap: Superpowers.
  - Stop-hook loops: ralph-loop, OMC ralph stage.
  - PreToolUse gates on edits: TDD Guard.
  - In-process mods and daemons: Ruflo, ECC hook profiles.
- **Publication gate:** none of the surveyed frameworks documents a gate that denies `git push` or `gh pr create` until recorded reviewer verdicts approve the ref. Superpowers' review blocks progress in-prompt and leaves merge/PR as a user choice. Anthropic's docs show Stop and PreToolUse hooks but no review-verdict store. This looks like a differentiator for an orchestration plugin that gates publication on reviews, but it is my inference from the READMEs read, not an exhaustive audit.
- **Sizing:**
  - Explicit rules: Superpowers (chat vs design doc; 2-5 minute tasks), GSD (plan must fit a fresh context), Codex (effort tiers), Ralph (one item per loop).
  - Mostly implicit: OMC/OmO (keyword escalation such as `ulw` and `mass ulw`).
- **Review independence:** Anthropic, Superpowers (task reviewer plus final reviewer), ECC ("fresh context") and OMC (critic/reviewer roles, cross-model reviewers via codex/gemini panes) converge on "a reviewer that didn't write it". Multi-lens or blind dual review was not seen in the surveyed READMEs.
- **Memory:** split between file ledgers and plans (Superpowers `progress.md`, RPI `thoughts/`, Ralph `progress.txt`/`prd.json`, Memory Bank, GSD artifacts), learned stores (ECC instincts, Ruflo vector/RAG, OmO Kibitzer, SuperClaude ReflexionMemory), and external trackers (CCPM GitHub Issues).
- **Model routing:**
  - Explicit: OMC (Haiku/Opus tiers, per-role routing), OmO (per-task model), Ruflo (router), wshobson (static per-agent aliases).
  - None documented: Superpowers.
- **Anthropic vs context-centric methods:** Anthropic's 2026 guidance partly undercuts older context-centric methodologies. It says context scarcity and "subagents to protect context" are no longer primary concerns with 1M windows. That conflicts with RPI's 40-60% utilization rule and GSD's "context rot" framing, which were written for about 170-200k windows.

### Gaps
- Per-framework model routing details for Superpowers, SuperClaude and GSD were not confirmed. The READMEs read do not document routing.
- The internals of Ruflo's "quality gates" in `ruflo-sparc` and of ECC's hook profiles were not read (plugin READMEs not fetched).
- The original Anthropic engineering post "Claude Code: Best practices for agentic coding" (explore → plan → code → commit; April 2025) was not re-fetched. The claim that the current docs page replaced that framing is based only on the current page's content.
- OmO's former OpenCode-era agent roster (Sisyphus, Oracle, Librarian, etc.) is not described in the current README, so it is not cited.

## 3. Known critiques

### Takeaway
The best-sourced critiques come from the framework authors and from Anthropic's own docs, not independent evaluations. The recurring themes: loops that duplicate or stub work and suit greenfield only, reviewers that over-find, prompt-only rules that the model can override, heavy token cost of subagent fan-out, and marketing claims (SPARC, Ruflo) that are not independently validated.

### Cited Findings
- Ralph: placeholder implementations, duplicate implementations after a wrong `ripgrep` conclusion, non-compiling results, and greenfield only — [ghuntley.com/ralph](https://ghuntley.com/ralph/)
- RPI: research that wasn't deep enough sank a 7-hour attempt (parquet-java). A research doc wrongly concluded a bug was invalid and had to be re-run — [ace-fca.md](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/ace-fca.md)
- Over-reviewing: "If you fix every finding, you end up with extra abstraction layers and tests for cases that can't happen" — [Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- Subagent cost: subagents "count against the same usage", can be "slower than doing the task where you are", and use "the same model (or a smaller one)… not a smarter answer" — [best practices](https://code.claude.com/docs/en/best-practices)
- Prompt-only discipline: "Claude is allowed to decide a guideline doesn't apply". Emphatic rules cause over-application — [best practices](https://code.claude.com/docs/en/best-practices)
- Superpowers admits misfires: the `diagnosing-superpowers` skill exists because "a skill fires when it shouldn't, stays silent when it should, or the agent ignores its plan, repeats work, or burns more tokens than you'd expect" — [superpowers README](https://github.com/obra/superpowers)
- SPARC/Ruflo hype: a Reddit commenter on r/RooCode said some of the material "sounds like BS" (via search summary) — [r/RooCode thread](https://redlib.ssps.io/r/RooCode/comments/1kvzufb/help_orchastrator_mode). Ruflo's README itself hedges its lineage claim: "This establishes Ruflo's lineage, not a universal first" — [ruflo README](https://github.com/ruvnet/ruflo)
- Agents bypass gates: TDD Guard ships a dedicated "Strengthening enforcement" doc to "prevent agents from bypassing validation" — [tdd-guard README](https://github.com/nizos/tdd-guard)
- Platform risk: Roo Code (the host of SPARC and Boomerang) is archived — [GitHub](https://github.com/RooCodeInc/Roo-Code)

### Inferences
- Frameworks that grew to hundreds of agents and skills (ECC 311 skills, Ruflo 314 MCP tools, wshobson 185 skills) trade discoverability and context cost for breadth. Anthropic's "Keep CLAUDE.md short" and Codex's "Keep each skill scoped to one job" point the other way.
- Autonomy-first designs (Superpowers SDD "do not pause", OmO "stops when it's done", Ralph loops) shift risk onto downstream review. That raises the value of a hard publication gate.

### Gaps
- I found no independent, quantitative comparison (benchmarks, controlled evals) between these frameworks. All performance claims are self-reported (e.g. OMC "30-50%" token savings, HumanLayer's 35k LOC in 7 hours).
- A targeted search for 2026 critiques of HumanLayer RPI (or a "QRSPI" successor) returned nothing relevant.
- No critique found specifically of Superpowers or ECC from independent practitioners within the tool-call budget.
