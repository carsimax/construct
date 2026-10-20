# odd_skills — Claude Code plugin

Objective: build **odd_skills**, one installable Claude Code plugin (technical id `odd-skills`) made only of plugin components (agents, skills, hooks, mods, workflows, output styles, MCP config, userConfig, evals). It reproduces the Claude Code result of gentle-ai v4.2.0, the reference baseline only, with engram kept as an independent instance.
Tracker branch: `feat/odd-skills-plugin` (at `main` root commit `e639e15`). Delivery strategy: `ask-on-risk`; chain strategy: `feature-branch-chain` (L12). Test runner: `claude plugin validate --strict`, `node --test` for scripts, `claude plugin test` for the mod, `claude plugin eval` for behavior. Script runtime: Node.js ESM, no dependencies (decided in T0).

## Specs

- **S1 — Same result.** Convert gentle-ai into a Claude plugin "en el que todo se gestiona con agentes y skills tratando de tener el  mismo resultado". Scope: Claude Code only; support for OpenCode, Codex, Pi, Cursor, Gemini, and the other agents is dropped (assumption: implied by "un plugin para claude").
- **S2 — Plugin components only.** Built "exclusicamente con esos elementos:  agentes, skills, hooks y ahora los nuevos mods de claude", "aprovechando al 100% todas las capacidades de claude hoy en dia". This means no gentle-ai Go binary at runtime. Any deterministic logic ships inside the plugin (`bin/` scripts invoked by hooks or skills, or mods).
- **S3 — Engram stays independent.** "seguirmeos usando engram como instancia independiente". Accepted decision (L3, L4):
  - Declare `"dependencies": ["engram@engram"]`.
  - Do not register the engram MCP server in this plugin.
  - Do not copy or duplicate engram hooks, skills, or protocol text.
- **S4 — Reuse the local install.** Take into account "como esta instalado y como podriamos aprovecharlo al 100%" — current agents, skills, output styles, hooks, and `claude_phase_assignments` on this machine are the reference baseline.
- **S5 — Plan documentation.** "documenta todo el paln". This document is the plan. Implementation tasks remain pending until the user authorizes implementation.
- **S6 — Model and effort per role.** "y podemo definir estos modelos para cada apartado". Defaults, taken from the user's gentle-ai role screen:

  | Role | Plugin agent | Model | Effort |
  |---|---|---|---|
  | ODD Explorer | `odd-explorer` | haiku | default |
  | ODD Worker | `odd-worker` | sonnet | medium |
  | ODD Verify | `odd-verify` | opus | medium |
  | JD Judge A | `jd-judge-a` | opus | medium |
  | JD Judge B | `jd-judge-b` | sonnet | medium |
  | JD Fix Agent | `jd-fix-agent` | sonnet | medium |
  | RDD Risk | `review-risk` | opus | medium |
  | RDD Readability | `review-readability` | sonnet | medium |
  | RDD Reliability | `review-reliability` | sonnet | medium |
  | RDD Resilience | `review-resilience` | sonnet | medium |
  | RDD Refuter | `review-refuter` | opus | medium |
  | RDD Validator | `review-validator` (new agent) | opus | medium |
  | General delegation | `odd-general` (new agent) | sonnet | medium |

  - Defaults ship as `model` and `effort` in each agent's frontmatter.
  - User-editable overrides are wanted. Resolved in T0: `userConfig` options enforced by the mod (see Design → Model routing).
- **S7 — Naming.** "todo nos referimemos como odd_skills no como gentle-ai".
  - Product and project name: `odd_skills`.
  - Plugin manifest `name`: `odd-skills`. `claude plugin validate --strict` rejects `odd_skills`: "Plugin name "odd_skills" is not kebab-case. Claude Code accepts it, but the Claude.ai marketplace sync requires kebab-case".
  - Namespaced components follow it, for example `/odd-skills:rdd-review`.
  - gentle-ai is named only as the replicated reference, never in plugin artifacts, commands, or user-facing text.

## Design

### Fidelity summary

| Area | Replicable | Notes |
|---|---|---|
| Agents, skills, output styles | Fully | Copied and adapted |
| ODD orchestrator rules | Mostly | Hook-injected text has less authority than `CLAUDE.md`; capped near 10k chars |
| Risk tier (`review assess`) | Fully | Deterministic port of `internal/reviewtransaction/risk.go` |
| Frozen candidate and receipts | Mostly | `git write-tree` with a temp index gives an immutable tree hash; receipts bind to it. The locked, atomic-publish store is lost |
| Global permissions, deny list | Partially | Plugin `settings.json` drops `permissions`; a `PreToolUse` hook enforces the deny list instead |
| Main statusline | No | Plugins can set only `subagentStatusLine`; a mod panel substitutes |
| Engram, codegraph binaries | No (by design) | Installed outside the plugin |

Estimated overall fidelity: about 90%.

### Always-on contract

A plugin cannot ship `CLAUDE.md`. The current managed `~/.claude/CLAUDE.md` is 621 lines and is split as follows:

1. **`hooks/scripts/session-contract.sh`** (`SessionStart`, matchers `startup|resume|clear|compact`).
   - Emits a contract of at most 8k characters: ODD steps 1–7, Task Size, the high-risk list, the Risk line, the delegation triggers in one line each, and the language contract.
   - Uses factual wording, not imperative, to avoid prompt-injection defenses.
2. **Skills** hold the detail, loaded on demand:
   - `odd-workflow`
   - `odd-delegation`
   - `task-size-risk`
   - `lossless-prompts`
   - `rdd-review`
   - `codegraph`
3. **`SubagentStart` hook** injects the worker contract into every subagent: artifact language, the Key Learnings closing block, and allowed edit surfaces discipline.
4. **Not used:** `settings.json` `"agent"` as the main thread. It replaces Claude Code's default system prompt.

### Component map

| gentle-ai today | Plugin component |
|---|---|
| `CLAUDE.md` blocks `persona`, `orchestrator`, `agent-routing`, `codegraph-guidance` | Session contract plus skills (see Always-on contract) |
| `CLAUDE.md` block `engram-protocol` | Removed. The engram plugin injects its own protocol |
| `output-styles/neutral.md`, Gentleman style | `output-styles/` (optional `force-for-plugin`, `keep-coding-instructions: true`) |
| Gentleman theme | `experimental.themes` |
| Agents `review-risk`, `review-readability`, `review-reliability`, `review-resilience`, `review-refuter` | `agents/` with `tools: []`, `omitClaudeMd: true`, `maxTurns` |
| Agents `jd-judge-a`, `jd-judge-b`, `jd-fix-agent` | `agents/` |
| ODD worker classes (`odd-explorer`, `odd-worker`, `odd-verify`) | Real agents: haiku, sonnet, opus, each with `skills:` preload |
| `~/.gentle-ai/state.json` (`claude_phase_assignments`, `persona`, `rdd_mode`) | `userConfig` (persona, RDD on/off, model per role) |
| `gentle-ai review assess` | `bin/odd-assess` (port of `ClassifyRisk`; same tiers, escalation items 1–6) |
| `gentle-ai review start / capture-* / acknowledge` | `bin/odd-review` (freeze tree, inspect, validate captures, write receipt under `${CLAUDE_PLUGIN_DATA}`), driven by the `rdd-review` skill |
| Four-lens fan-out | `workflows/review-4lens.js` with a per-lens JSON `schema` (equivalent of `lens-result/v1`); the skill path is the fallback when workflows are disabled |
| `review stop-hook` | `Stop` hook: blocks with `{"decision":"block"}` when a high-risk diff has no receipt |
| Risk line and closure discipline | `Stop` hook of type `prompt` checking for a `Risk:` line and undeclared pending checks |
| `skill-registry refresh` and `.atl/skill-registry.md` | Removed. Agent `skills:` frontmatter preloads skills |
| `permissions` deny list (`.env`, `.ssh`, `*.pem`, `*.key`, `secrets/*`, cloud credentials) | `PreToolUse` hook `secret-guard.sh` |
| context7 and codegraph MCP entries | Plugin `.mcp.json` |
| `codegraph init` guidance | `codegraph` skill (calls the upstream CLI) |
| `judgment-day` skill | Skill plus `workflows/judgment-day.js` |
| Skills `chained-pr`, `work-unit-commits`, `branch-pr`, `comment-writer`, `cognitive-doc-design`, `skill-creator`, `skill-improver`, `go-testing` | `skills/` (copied; drop references to `gentle-ai` commands) |
| Feature tracking across compaction | `PreCompact` / `PostCompact` hooks re-inject the active `odd/tasks/*.md` |
| Todo sync | `TaskCreated` / `TaskCompleted` hooks update the feature document `## Tasks` |
| statusline | Mod panel showing ODD task progress and RDD state (experimental) |

### Model routing (S6)

Decided in T0. The mod enforces the per-role model and effort.

| Layer | Mechanism | Status |
|---|---|---|
| Defaults | Static `model:` and `effort:` in each plugin agent's frontmatter (the S6 table) | Confirmed |
| Per-user override | `userConfig` keys `model_<role>` and `effort_<role>`, each with `options`, editable in `/config` | Confirmed |
| Model enforcement | Mod `agent.spawn` hook: `next({ ...e, model: options['model_' + role] })`. The role comes from `e.subagentType`. The spawn result returns `agentId` | Confirmed (T0: frontmatter haiku → sent sonnet) |
| Effort enforcement | Mod `turn.step` hook: when `e.agentId` maps to a role, `next({ ...e, effort: options['effort_' + role] })` | Confirmed (T0: medium → low) |
| Frontmatter `${user_config.*}` | Not substituted. The literal string reaches the API (`model_not_found`) | **Rejected** |
| Mod failure | The mod fails open. Agents keep their frontmatter defaults | By design |
| General delegation | `odd-general` agent. The mod can also map `general-purpose` spawns to `model_general` | By design |

Note: a user or project agent with the same name overrides a plugin agent (docs: plugin agents have the lowest priority). The `/config` overrides make that unnecessary.

### Dropped

- Telemetry hooks.
- The TUI, installer, backups, and `sync`.
- Every non-Claude agent adapter.
- The provider defect handoff, which files issues against gentle-ai.
- Legacy `review-*` v1 commands.

### Engram contract

| Rule | Reason |
|---|---|
| Depend on `engram@engram`; list the engram marketplace in `allowCrossMarketplaceDependenciesOn` | Engram lives in another marketplace |
| Never ship an engram entry in `.mcp.json` | Plugin MCP tools would get a `mcp__plugin_odd-skills_engram__` prefix. Engram's `PreToolUse` session binding only matches `mcp__engram__` and `mcp__plugin_engram_engram__`. The user-scope `engram` server is also already registered |
| No engram `SessionStart` logic in this plugin | Avoids double context injection |
| Keep `## Key Learnings` in agent outputs | Engram's async `SubagentStop` hook captures them server-side |
| Binary install stays manual: `brew install engram`, `engram setup claude-code` | Plugins cannot install system binaries |

### Plugin layout

Repository root is the marketplace; the plugin lives in `plugins/odd-skills/`, so `odd/`, `README.md`, and repo tooling stay outside the plugin. Install id: `odd-skills@odd-skills`.

```
.claude-plugin/marketplace.json   # (repo root) marketplace `odd-skills`; allowCrossMarketplaceDependenciesOn: engram
plugins/odd-skills/               # plugin root; every path below is relative to it
.claude-plugin/plugin.json        # name, version, dependencies, userConfig, outputStyles, workflows
agents/                           # odd-*, review-*, jd-*
skills/                           # odd-workflow, odd-delegation, task-size-risk, lossless-prompts, rdd-review, codegraph, judgment-day, ...
hooks/hooks.json                  # SessionStart, SubagentStart, PreToolUse, Stop, PreCompact, PostCompact, TaskCreated, TaskCompleted
hooks/scripts/                    # session-contract.sh, subagent-contract.sh, secret-guard.sh, review-gate.sh, compact-state.sh, task-sync.sh
bin/                              # odd-assess, odd-review
output-styles/                    # neutral.md, gentleman.md
workflows/                        # review-4lens.js, judgment-day.js
mods/                             # status panel (experimental)
.mcp.json                         # context7, codegraph
evals/                            # behavior cases for the orchestrator contract
```

### Capability results (T0, CLI 2.1.304)

| Capability | Result | Evidence |
|---|---|---|
| Mod `tool.call` guard | Works | `echo SPIKE_MOD_BLOCK` returned `SPIKE_MOD_DENIED by odd-skills-spike mod` |
| Mod `register(on, options)` | Receives `userConfig` with defaults filled in | `options: { probe_model: "haiku", probe_effort: "low" }` |
| Mod `agent.spawn` model override | Works | Frontmatter `haiku`, sent `sonnet`, step model `claude-sonnet-5-5` |
| Mod `turn.step` effort override | Works | Subagent step effort `medium` → `low` |
| Mod registration | `hooks/hooks.json` needs `"modules": ["./register.js"]` | Without it, validate lists no mod hooks |
| `SessionStart` `additionalContext` | Works | Main thread reported `SPIKE_SESSION_CTX=alpha` |
| `SubagentStart` `additionalContext` | Works | Subagent reply included `SPIKE_SUBAGENT_CTX=bravo` |
| Plugin MCP tool prefix | `mcp__plugin_<plugin>_<server>__<tool>` | `mcp__plugin_odd-skills-spike_spikeecho__spike_echo` returned `ECHO:hi` |
| Plugin workflow with `schema` | Works; invoked as `/<plugin>:<name>` | `{"WORKFLOW_RESULT":{"tier":"medium","lenses":["risk","reliability"]}}` |
| `${user_config.*}` in agent frontmatter | Not substituted | API error `model_not_found` for `${user_config.probe_model}` |
| `${user_config.*}` in agent body | Not substituted when only defaults exist | Reply `MODEL_IN_BODY=${user_config.probe_model}`. Untested with a saved value (isolated config not logged in) |
| `CLAUDE_PLUGIN_OPTION_*` in hooks | Exported only for saved values, not defaults | Unset with defaults only; `opus` after `claude plugin configure --values-stdin` |
| Cross-marketplace dependency | Works when the engram marketplace is already added | `(+ 1 dependency: engram)`. Without it: `dependency "engram@engram" was not installed ... will not load without it` |
| `isolation: worktree` on plugin agent | Works | Agent ran in `.claude/worktrees/agent-<id>` |
| `memory: project` on plugin agent | Works; directory `odd-skills-<plugin>-<agent>` | Combined with worktree isolation, memory lands inside the worktree and is lost on cleanup. Do not combine them |
| `experimental.themes` | Validates | Runtime loading not exercised |

Design consequences:

- Hook scripts read settings through the mod or through explicit defaults, never assuming `CLAUDE_PLUGIN_OPTION_*` is set.
- The install runbook adds the engram marketplace before installing odd_skills.
- `odd-worker` may use `isolation: worktree` for parallel writers; no agent combines it with `memory`.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T0 | S2, S6 | Spike: confirm each unverified capability with a throwaway plugin via `claude --plugin-dir`; choose the script runtime and test runner | inline | none | done | no commit (not a git repo); evidence in Design → Capability results and L9 |
| T1 | S2, S3, S7 | `git init`, plugin skeleton, `plugin.json` with the `engram@engram` dependency, local marketplace, `claude plugin validate --strict` | inline | none (reassessed, L10) | done | `feat: scaffold odd-skills plugin and marketplace` |
| T2 | S1, S4, S6, S7 | Port agents (`review-*`, `jd-*`); create `odd-explorer`, `odd-worker`, `odd-verify`, `review-validator`, `odd-general`; apply the S6 model and effort table as static frontmatter; declare `model_<role>` / `effort_<role>` `userConfig` options; mod `agent.spawn` + `turn.step` routing with `claude plugin test` coverage | inline | none | done | `feat: port review lens and judgment-day agents` (slice 02) + `feat: add ODD role agents with configurable model routing` (slice 03) |
| T3 | S1 | Port skills; remove `gentle-ai` command references; drop `skill-registry` | inline | none | pending | — |
| T4 | S1, S2 | Split the orchestrator into the ≤8k session contract and the ODD skills; `SessionStart` and `SubagentStart` hooks; evals for small-inline, large-tracked, and Risk-line cases | inline | 6 | pending | — |
| T5 | S1, S4 | Output styles (Neutral, Gentleman), theme, `userConfig` | inline | none | pending | — |
| T6 | S1, S2 | `bin/odd-assess`: port `ClassifyRisk` with fixtures; differential check against `gentle-ai review assess` on the same diffs | inline | 6 | pending | — |
| T7 | S1, S2 | `bin/odd-review`: frozen tree via temp index, inspect, capture validation, receipt and acknowledgement | inline | 1 | pending | — |
| T8 | S1, S2 | `rdd-review` skill, `review-4lens` and `judgment-day` workflows, `Stop` review gate | inline | 6 | pending | — |
| T9 | S1 | `secret-guard.sh` `PreToolUse` deny list; `Stop` prompt hook for the Risk line | inline | 2 | pending | — |
| T10 | S1 | Compaction re-injection and task sync hooks | inline | none | pending | — |
| T11 | S1 | `.mcp.json` (context7, codegraph) and `codegraph` skill | inline | none | pending | — |
| T12 | S2 | Mod status panel (experimental; must fail open) | inline | 6 | pending | — |
| T13 | S1, S3, S4 | Migration runbook and README: back up `~/.claude`, remove `gentle-ai:*` blocks and gentle-ai hooks, run side by side with `--plugin-dir`, then `gentle-ai uninstall` keeping engram | inline | 5 | pending | — |

Route evidence: no Writer trigger reason is known yet (units are sequential and depend on T0/T1); revisit if T6 and T7 run in parallel.

Forecast: about 2,500–3,500 authored changed lines, above the 400-line budget. `ask-on-risk` will ask for the chain strategy before the first commit past the budget.

### Delivery slices (feature-branch-chain)

The tracker `feat/odd-skills-plugin` gets a draft, no-merge PR into `main`. Child PR 01 targets the tracker, and each later child targets its immediate parent.

```
main
 └── feat/odd-skills-plugin (tracker, draft PR, no merge)
      └── odd-skills/01-scaffold
           └── odd-skills/02-ported-agents
                └── odd-skills/03-role-routing
                     └── odd-skills/04-... (T3 onward)
```

| Slice | Branch | Tasks | Commits | Changed lines | Budget |
|---|---|---|---|---|---|
| 01 | `odd-skills/01-scaffold` | T1 | `feat: scaffold odd-skills plugin and marketplace` | 338 | within |
| 02 | `odd-skills/02-ported-agents` | T2 (ported agents) | `feat: port review lens and judgment-day agents` | 395 | within |
| 03 | `odd-skills/03-role-routing` | T2 (new agents, userConfig, mod, tests, docs) | `feat: add ODD role agents with configurable model routing` | about 796 | `size:exception` recommended: 352 lines are the `userConfig` JSON generated from agent frontmatter; the mod cannot ship without its options |

Push and PR creation remain the user's decision.

## Log

- **L1 (2026-10-19, user):** "Quiero un plan para hacer algo converirtir https://github.com/Gentleman-Programming/gentle-ai en un plugin para claude, en el que todo se gestiona con agentes y skills tratando de tener el  mismo resultado ya de hecho tengo instalado gentle-ai en mi maquina para que aparte del analisis exhautivo al repo veas como esta instalado y como podriamos aprovecharlo al 100% exclusicamente con esos elementos:  agentes, skills, hooks y ahora los nuevos mods de claude, lanza varios agentes que te ayuden ten en cuenta que seguirmeos usando engram como instancia independiente https://github.com/Gentleman-Programming/engram"
- **L2 (2026-10-19, evidence):** Four parallel investigations (gentle-ai repo, local install, engram repo, Claude Code plugin docs).
  - Key sources: `internal/assets/claude/orchestrator.md`, `internal/components/agentguidance/routing.go`, `internal/reviewtransaction/risk.go`, engram `plugin/claude-code/hooks/hooks.json`, https://code.claude.com/docs/en/plugins/components, https://code.claude.com/docs/en/plugins/mods/overview.
- **L3 (2026-10-19, user):** "Y con esto se prodra replicar lo mejor posible gentle-ai con lo que si podemos instalar con un plugin de claude aprovechando al 100% todas las capacidades de claude hoy en dia ?"
  - Plan extended with `.mcp.json`, `userConfig`, `SubagentStart`, compaction and task hooks, prompt hooks, workflow schemas, `omitClaudeMd`, themes, mods, and evals.
  - Correction: the frozen candidate is replicable with `git write-tree`.
- **L4 (2026-10-19, user):** "por que no se si engram se puede incluir como parte del plugin"
  - Answer: include engram as a dependency. Vendoring duplicates `SessionStart`. Plugin MCP registration breaks engram's `PreToolUse` session binding through the tool prefix.
- **L5 (2026-10-19, user):** "ok hagamoslo asi documenta todo el paln"
  - Decision: dependency approach accepted. This document created.
- **L6 (2026-10-19, user):** "de hecho engram ya es un pligun de claude me parece no? cuando lo instale puso un plugin en claude"
  - Verified locally: `engram@engram` v0.1.13 ships `hooks/`, `scripts/`, and `skills/` only. The MCP server is registered separately in `~/.claude.json` (`engram mcp --tools=agent`).
  - S3 dependency approach confirmed.
- **L7 (2026-10-19, user):** "y podemo definir estos modelos para cada apartado" (screenshot of the gentle-ai role model and effort screen).
  - Added S6.
  - New agents: `review-validator`, `odd-general`.
  - Model routing design added; T0 and T2 updated.
- **L8 (2026-10-19, user):** "por cierto todo nos referimemos como odd_skills no como gentle-ai"
  - Added S7.
  - Feature document renamed to `odd/tasks/odd-skills-plugin.md`; Engram topic changed to `odd/odd-skills-plugin/tasks`.
  - Evidence: `claude plugin validate --strict` on CLI 2.1.304 warns that `odd_skills` is not kebab-case and fails strict mode; `odd-skills` passes the name check.
- **L9 (2026-10-19, user):** "si vamos con la T0"
  - Spike plugin `odd-skills-spike` built in the session scratchpad and exercised with `claude -p --model haiku --plugin-dir`, plus an isolated `CLAUDE_CONFIG_DIR` for the install and dependency tests.
  - Results recorded in Design → Capability results.
  - Decisions:
    - Per-role model and effort are enforced by the mod (`agent.spawn`, `turn.step`), because frontmatter `${user_config.*}` is not substituted.
    - Script runtime is Node.js ESM with `node --test`.
  - Cleanup: spike transcripts under `~/.claude/projects/` and `~/.claude/plugins/data/odd-skills-spike-inline` removed; `~/.claude/settings.json` unchanged.
  - Next step: T1 (`git init`, plugin skeleton, local marketplace, `claude plugin validate --strict`).
- **L10 (2026-10-19, user):** "si sigue con t1"
  - Repository initialized:
    - `main` holds the empty root commit `e639e15`.
    - Work continues on `feat/odd-skills-plugin`.
  - Files added:
    - `.claude-plugin/marketplace.json`: marketplace `odd-skills`, allowlisting `engram`.
    - `plugins/odd-skills/.claude-plugin/plugin.json`: `odd-skills` 0.1.0, depends on `engram@engram`.
    - `README.md`: install order, with the engram marketplace added first.
    - `.gitignore`.
  - Layout decision: the repository root is the marketplace; the plugin is `plugins/odd-skills/`.
  - Checks:
    - `claude plugin validate --strict .`: `✔ Validation passed`.
    - `claude plugin validate --strict ./plugins/odd-skills`: `✔ Validation passed`.
    - Isolated install with the engram marketplace added: `Successfully installed plugin: odd-skills@odd-skills (scope: user) (+ 1 dependency: engram)`; both plugins enabled.
    - Isolated install without the engram marketplace: `Warning: dependency "engram@engram" was not installed ... "odd-skills" will not load without it`.
    - README install order verified by these two runs.
  - Risk reassessed from item 5 to none: only new files, which nothing consumes yet. No existing installer, dependency, or config is changed.
  - Commit `8830919` assessed with `review assess --base-ref e639e15 --committed-only`: tier `medium`, `review_due: false`, reason `under_budget` (338 lines). It stays pending in the open slice.
  - Next step: T2 (agents, S6 `userConfig`, mod routing).
- **L11 (2026-10-19, user):** "Si vamos con T2"
  - Agents, all 13 under `plugins/odd-skills/agents/`:
    - Ported from the installed copies: `review-{risk,readability,reliability,resilience,refuter}`, `jd-judge-{a,b}`, `jd-fix-agent`.
      - Bodies were kept apart from four changes:
        - The gentle-ai managed blocks (codegraph, artifact language, remote authorization) were removed. T4's `SubagentStart` contract replaces them.
        - The input markers were renamed from `GENTLE_AI_REVIEW_*` to `ODD_REVIEW_*`. The context comes from `odd-review context` (T7).
        - The `Skill Resolution` lines were dropped, since `skill-registry` is dropped.
        - Engram tools were changed from `mcp__plugin_engram_engram__*` to `mcp__engram__*`. The plugin prefix does not exist, because engram's plugin ships no MCP server.
      - The lenses, refuter, and validator gained `omitClaudeMd: true` and `maxTurns: 2`.
    - New agents: `odd-explorer`, `odd-worker`, `odd-verify`, `odd-general`, and `review-validator` (targeted post-correction validator).
  - `userConfig`: 26 options (`model_<role>`, `effort_<role>`), generated from the agent frontmatter. Model options are haiku, sonnet, opus, and fable. Effort options are `default` (no override), low, medium, high, xhigh, and max.
  - Mod:
    - `hooks/hooks.json` declares `modules: ["./register.js"]`.
    - `hooks/routing.js` derives the role from the agent name, so there is no duplicated table. Built-in `general-purpose` maps to `odd_general`.
    - `hooks/register.js` sets the model in `agent.spawn` and the effort in `turn.step` per subagent id. It fails open.
  - Checks:
    - `claude plugin validate --strict plugins/odd-skills`: `✔ Validation passed`. It reports the hooks `agent.spawn, turn.step`, `calls: nothing on $`, and the note `gating hook without .catch: agent.spawn` (fail-open by design).
    - `claude plugin test plugins/odd-skills`: RED before the mod existed (`no hooks module to load`), then `7 pass, 0 fail`.
    - Mutation check: making `modelFor` return null gave `4 pass, 3 fail`; restoring it gave `7 pass`.
    - `node --test tests/`: 4 pass. This guard test over static data passed on first run, so no RED was observed.
    - Real session (`claude -p --model haiku --plugin-dir`):
      - Subagent metadata `{"agentType":"odd-skills:odd-explorer",...,"model":"haiku"}` and transcript model `claude-haiku-5-5`.
      - `{"agentType":"general-purpose",...,"model":"sonnet"}` and `claude-sonnet-5-5`, overriding the haiku session model.
      - Session transcripts were removed afterwards.
  - Documented behavior: the configured role model replaces any per-invocation `model` passed for that agent.
  - Commit `ac366d9` (later split into slices 02 and 03, L12).
    - Generated `.atl/` files (written by the gentle-ai `skill-registry refresh` prompt hook) were removed from the commit and added to `.gitignore`.
    - `review assess --base-ref e639e15 --committed-only` on the open slice: `medium`, `review_due: false`, `under_budget`, 1523 changed lines. Pending in the slice.
  - The running count passed the 400-line delivery budget with this commit. Under `ask-on-risk`, the chain strategy must be asked before the next commit; it was not asked before this one.
  - Engram mirror for L11 is **pending**: `mem_save` was refused with `Claude host session "2f435feb-..." already ended` (resumed session). Resync on the next working engram session.
  - Next step: T3 (port skills) after the chain strategy answer.
- **L12 (2026-10-19, user):** "feature-branch-chain"
  - Chain strategy cached as `feature-branch-chain` (skill `chained-pr`).
  - Branch restructure (local, unpushed; no commit lost):
    - `odd-skills/01-scaffold` points at the T1 commit.
    - The T2 commit was split in one slicing pass: `odd-skills/02-ported-agents` holds the 8 ported agents and the `.atl/` ignore (395 lines), and `odd-skills/03-role-routing` holds the rest.
    - The tracker `feat/odd-skills-plugin` was moved back to `e639e15`.
  - Slice 03 exceeds the budget. The `size:exception` rationale is in Delivery slices.
  - Next step: T3 (port skills) on `odd-skills/04-skills`.
