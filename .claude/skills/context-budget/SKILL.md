---
name: context-budget
description: What Claude Code loads into context, what survives compaction, what invalidates the prompt cache, and how CLAUDE.md, rules, and auto memory load, for deciding where construct text belongs (session contract, subagent contract, hook context, skill, agent body, output style) and what it costs. Use before adding or growing injected text, changing a contract, adding a SessionStart/SubagentStart/UserPromptSubmit context hook, or switching models or effort mid-session.
---

# Context budget in construct

Sources (read 2026-10-23): [context window](https://code.claude.com/docs/en/context-window.md), [prompt caching](https://code.claude.com/docs/en/prompt-caching.md), [memory](https://code.claude.com/docs/en/memory.md). Hook output limits: `settings-hooks` skill. Skill loading: `agents-and-skills-authoring` skill.

## Construct's injected text and its budgets

| Text | Channel | Budget (ours) | Hard platform limit |
| :- | :- | :- | :- |
| `hooks/contract/session.md` | `SessionStart` `additionalContext` (`startup\|resume\|clear\|compact`) | 8,000 chars (test) | 10,000 chars per hook output |
| `hooks/contract/subagent.md` | `SubagentStart` `additionalContext` | 3,000 bytes (test) | 10,000 chars |
| feature state | `SessionStart` on `compact\|resume` | 2,500 chars | 10,000 chars |
| skill `!` state (`skill-context.mjs`) | skill render | 1,500 chars | large output becomes a file path plus preview |
| skill bodies | on invocation | keep under 500 lines | 5,000 tokens each survive compaction |
| skill descriptions | always listed | short, key use first | 1,536 chars each; listing is 1% of the window |
| agent bodies | the subagent's system prompt | short | combined descriptions > 15,000 tokens warn |

Over 10,000 chars the platform replaces hook output with a file path and a 2,000-char preview: the contract would silently stop being read. The 8,000 test is the margin, not a target.

## What loads when

- Startup: system prompt and tool definitions, output style, then CLAUDE.md levels (managed → user → project → local, concatenated, walk-up from root to cwd), unscoped `.claude/rules/*.md`, auto memory (`MEMORY.md` first 200 lines or 25 KB), MCP tool names, skill descriptions, then hook context.
- CLAUDE.md is a user message after the system prompt, not part of it; compliance is not guaranteed. That is why construct enforces with hooks and keeps the contract short.
- A plugin's root `CLAUDE.md` is never loaded. Nested CLAUDE.md files and `paths:` rules load on demand when a matching file is read or edited.
- Subagents get CLAUDE.md and AGENTS.md but **not** the output style, parent history, or parent auto memory (forks excepted). The subagent contract is the only construct text a subagent is guaranteed to get.

## What survives compaction

- Kept: system prompt, output style.
- Re-read from disk: project-root CLAUDE.md, unscoped rules, auto memory, the plan-mode plan, up to 5 recently edited files (over 5,000 tokens → path only).
- Skills: descriptions rebuilt (v2.1.304+); bodies re-attached at **5,000 tokens each, 25,000 total**, oldest dropped. Truncation keeps the start of the file.
- **Earlier hook context is only summarized.** The documented way to re-inject it is a `SessionStart` hook matching `compact`, which construct uses for the contract and the feature state. Any new context that must survive compaction needs the same matcher.
- Path-scoped rules and nested CLAUDE.md are not re-injected until a matching file is touched again.

## Prompt cache

- Layers: system prompt + tools → project context (CLAUDE.md, auto memory, unscoped rules) → conversation. Exact-prefix match: a change anywhere recomputes everything after it.
- **Invalidates**: model switch (including a skill's or command's `model:` frontmatter), effort change on most models (Opus 5.5, Sonnet 5.5, Haiku 5.5, Fable 5.1 keep it with an API key or subscription), fast mode on, adding or removing upfront MCP tool definitions, a bare-name deny rule (`Bash`, `mcp__*`) when tool search is off, `/compact` (conversation layer), a Claude Code upgrade.
- **Keeps**: file edits, permission mode changes, output-style changes, skill invocation (unless it sets `model:`), subagent spawn, mid-session CLAUDE.md edits (which also do nothing until `/clear`, `/compact`, or restart), plugin skills/agents/hooks/monitors changes.
- Consequence: per-role model routing costs a fresh cache per subagent anyway (a subagent never reads the parent cache), so routing a role to a different model is cheap; switching the **main** model or effort mid-session is not. Never put `model:` in a construct skill's frontmatter.
- TTL: 5 min default, refreshed on each hit; the main conversation gets 1 h on a Claude subscription. Subagents and workflows: 5 min. Settings: `promptCacheTtl`, `subagentPromptCacheTtl`; agent frontmatter `experimental.cacheTtl`.
- Check: `/usage` (`Prompt cache (main)`, v2.1.251+), or `claude -p "hello" --output-format json` → `usage.cache_creation`.
- Hook-context placement in the cache layers is not documented. Inference: it is appended to the conversation, so changing it affects only later turns.

## CLAUDE.md, rules, AGENTS.md, auto memory

- Repository `CLAUDE.md` target: under 200 lines; files over 4 MiB are skipped; `<!-- -->` comments are stripped before injection. `@path` imports (four hops max) do not save context: they load with the importing file.
- `.claude/rules/*.md`: only the `paths` frontmatter is read; invalid YAML loads the rule unconditionally.
- AGENTS.md is read only when no CLAUDE.md exists in cwd or above (built-in mod `cc-plugin-agents-md`, v2.1.277+).
- Auto memory lives in `~/.claude/projects/<project>/memory/` and is separate from Engram. Agent `memory` frontmatter uses its own directory.

## Where new construct text belongs

1. Must always hold → a hook that enforces it, not prose.
2. Needed every turn by the main thread → the session contract (watch the 8,000 budget).
3. Needed by every subagent → the subagent contract (watch the 3,000-byte budget).
4. Needed only for one topic → a skill, rules at the top of the file.
5. Needed by one role → the agent body.
6. Tone and reply format → the output style (subagents do not see it).

Diagnose with `/context`, `/memory`, `/doctor`, and `claude --debug`.
