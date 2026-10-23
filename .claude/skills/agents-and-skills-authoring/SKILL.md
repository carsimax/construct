---
name: agents-and-skills-authoring
description: Construct overlay on the official agent-development, skill-development, and skill-creator skills. Current frontmatter rules, what plugin agents ignore, startup context, model precedence, nesting, skill compaction, `!` dynamic context, and workflows, with corrections where the official skills are out of date. Use together with them before adding or editing a construct agent, skill, role, or workflow, or when an agent or skill behaves differently than its file says.
---

# Agents, skills, and workflows in construct

**Load the official skills first**: `agent-development` (system prompt design, triggering examples, `scripts/validate-agent.sh`), `skill-development` (structure, progressive disclosure), and `skill-creator` (anthropics/skills: drafting, evaluating, and tuning a skill's description with its eval loop). This file adds what they lack and corrects what is stale. Order of authority: the live docs, then this file, then the official skills.

## Corrections to the official skills

| Official skill says | Current docs |
| :- | :- |
| agent `model` and `color` are required | only `name` and `description` are required |
| agent `model`: `inherit`, `sonnet`, `opus`, `haiku` | also `fable` and full model ids |
| `color`: `blue`, `cyan`, `green`, `yellow`, `magenta`, `red` | `red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink`, `cyan` |
| no `effort`, `maxTurns`, `skills`, `memory`, `isolation`, `disallowedTools`, ... | all exist; plugin agents ignore `permissionMode`, `hooks`, `mcpServers`, `initialPrompt` |
| skill frontmatter mostly `name`, `description`, `version` | `version` is not a Claude Code field; see the field list below |
| `skill-creator` eval scripts (`scripts/run_eval.py`) | they run `claude -p` and Python; for construct's plugin skills, prefer `claude plugin eval` (see `plugin-evals`) |

Sources (read 2026-10-23): [sub-agents](https://code.claude.com/docs/en/sub-agents.md), [skills](https://code.claude.com/docs/en/skills.md), [workflows](https://code.claude.com/docs/en/workflows.md). Re-read before relying on a version-gated detail. Lines marked **observed** come from our own live probes (construct memory), not the docs.

## Subagent files (`plugins/construct/agents/*.md`)

- Required: `name` (≤ 256 chars, no `:`, hooks see it as `agent_type`, scoped as `construct:<name>`) and `description`. Unknown fields are **silently ignored**; `claude --debug` logs `does not recognize or apply` (v2.1.296+).
- **Plugin agents ignore `permissionMode`, `hooks`, `mcpServers`, `initialPrompt`.** Guards go in `hooks/hooks.json`, never in agent frontmatter.
- Honored: `tools` (omitted = inherit all), `disallowedTools` (applied first; `Bash(git push *)` removes the whole tool), `model` (`sonnet`, `opus`, `haiku`, `fable`, full id, `inherit`), `effort` (`low`…`max`), `maxTurns` (partial result, resumable), `autoCompactWindow` (integer `100000`–`1000000`; `200k` reads as 200), `skills` (preloads full content, first 32; cannot preload `disable-model-invocation` skills; does not restrict access), `memory` (`user`/`project`/`local` `MEMORY.md`, first 200 lines or 25 KB, auto-enables Read/Write/Edit), `background`, `omitClaudeMd` (v2.1.271+), `isolation: worktree` (branches from the **default branch**, not the parent's `HEAD`), `color`, `experimental.cacheTtl` (`5m`/`1h`).
- Unparseable YAML: the agent still loads under its file name with every field ignored. A JSON-only lens with broken frontmatter silently loses its `tools` limits; `claude plugin validate --strict` must stay green.
- Scope priority: managed > `--agents` > `.claude/agents/` > `~/.claude/agents/` > plugin (lowest). A user agent with the same name shadows ours.

### Model precedence (routing)

1. Per-invocation `model` on the Agent call; **a mod's `agent.spawn` hook replaces it** (that is how `hooks/routing.js` routes).
2. Frontmatter `model` (construct's fallback when the mod cannot run).
3. `CLAUDE_CODE_SUBAGENT_MODEL`.
4. The main model.

`CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` (v2.1.257+) ignores 1 and 2. A family alias resolves to the main model's exact id when it is in that family. Values are checked against `availableModels`. Frontmatter `effort` overrides session effort but not `CLAUDE_CODE_EFFORT_LEVEL`; Agent tool `effort` exists from v2.1.292.

### What a subagent sees

- Gets: its own body as system prompt (not Claude Code's), the task message, all CLAUDE.md levels and AGENTS.md (Explore and Plan skip them), a git status snapshot, preloaded skills, the `SubagentStart` `additionalContext` (our subagent contract).
- Does **not** get: parent history, skills the parent loaded, files the parent read, the output style, parent auto memory. Hand off by reference to `odd/tasks/<feature>.md`, never by "as discussed".
- Combined non-built-in descriptions over 15,000 tokens raise a startup warning. Keep `description` short and the detail in the body.

### Nesting, concurrency, background

- Nesting depth 3 below main by default (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`; `1` disables). A subagent spawns only if `Agent` is in its tools. Construct's rule "subagents never launch agents" therefore needs `Agent` absent from every role's `tools`.
- 20 concurrent subagents (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`), error `Concurrent subagent limit reached`.
- Subagents spawned from main start in the background by default. Background subagents get a narrower built-in tool set; every subagent loses `AskUserQuestion`, `EnterPlanMode`, `Workflow`, `ScheduleWakeup`. A worker cannot ask the user directly, hence the `needs_interaction` relay.
- Resume with `SendMessage` (`to` = id or name) keeps history and tools. Transcripts: `~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl`.

## Skill files (`plugins/construct/skills/*/SKILL.md`)

- Frontmatter is read only if `---` is the first line. Invalid YAML: the skill loads with **no fields**, so it cannot be matched by description. Unknown fields are ignored.
- Fields: `name` (sets the last segment, `/construct:<name>`), `description` + `when_to_use` (truncated together at **1,536 chars**; key use case first), `disable-model-invocation` (also hides the description and blocks preload), `user-invocable`, `argument-hint`, `arguments` (`$name`), `allowed-tools` (pre-approves for the invoking turn only; does not restrict), `disallowed-tools`, `model` and `effort` (rest of the turn), `context: fork` + `agent` + `background`, `hooks` (registered on invocation, stay for the session), `paths` (globs relative to cwd), `shell`.
- Substitutions: `$ARGUMENTS`, `$N`, `${CLAUDE_SESSION_ID}`, `${CLAUDE_EFFORT}`, `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_SKILL_DIR}` (the skill's own directory, not the plugin root), `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${user_config.KEY}` (non-sensitive).
- Loading: descriptions are always in context; the body loads on invocation as one message and is not re-read. Listing budget is 1% of the context window; overflow drops the least-invoked descriptions first.
- **Compaction keeps only the first 5,000 tokens** of the latest invocation of each skill, 25,000 tokens total, most recent first. Put the rules that must survive at the top. Keep `SKILL.md` under 500 lines.
- Plugin skills coexist with same-named skills elsewhere and are not affected by `skillOverrides`.

### `!` dynamic context (`skill-context.mjs`)

- `` !`cmd` `` at line start or after whitespace, or a ` ```! ` fence. Runs once before Claude sees the skill; output is not re-scanned; cwd is the session shell's cwd (use `${CLAUDE_SKILL_DIR}` or `${CLAUDE_PLUGIN_ROOT}` for paths); stderr is merged; 2-minute timeout.
- **Any non-zero exit aborts the whole invocation** (`Shell command failed for pattern "..."`), except exit 1 from search/compare commands. **Observed** in our probes too. That is why `skill-context.mjs` always exits 0 and prints `(state unavailable: <reason>)`.
- Injected commands never prompt: outside auto mode anything but allow aborts (`Shell command permission check failed`). Pre-approve through `allowed-tools`.
- `disableSkillShellExecution: true` replaces the command with `[shell command execution disabled by policy]` for plugin skills too. The skill text must still make sense without the injected state.

## Workflows (`workflows/*.js`)

- `export const meta = { name, description }` must be the first statement, a plain literal. Plugin workflows run as `/construct:<name>`.
- API: `agent(prompt, { schema, label, stallMs })` (resolves `null` on stop or unrecoverable error), `parallel()`, `pipeline()`, `phase()`, `log()`, global `args`. No `import()`, filesystem, shell, `Date.now()`, or `Math.random()`.
- Limits: 16 concurrent agents by default, 1,000 agents per run, 4,096 items per `parallel`/`pipeline`.
- Hooks for workflow agents are not documented. **Observed**: `agent()` in a workflow does **not** fire `PreToolUse:Agent`, so `review-context.mjs` and delegation admission do not see those launches. Never route a gate-relevant launch (lens, writer) through a workflow.
- In `-p` the launch needs an allow rule (`Workflow(<name>)`), auto or bypass mode, or a `PreToolUse` allow. Disable with `disableWorkflows` or `CLAUDE_CODE_DISABLE_WORKFLOWS=1`.

## Checks for a change here

`node --test 'tests/**/*.test.mjs'` (agents and skills tests), `claude plugin validate --strict ./plugins/construct`, and, for delegation behavior, an eval case (see `plugin-evals`).
