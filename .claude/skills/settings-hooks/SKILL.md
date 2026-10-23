---
name: settings-hooks
description: Construct overlay on the official hook-development skill. Current hook semantics (exec form, `if`, exit codes, JSON output, limits, timeouts, onFailure, permission precedence), corrections where hook-development is out of date, and how construct's hooks/scripts/*.mjs use them. Use together with hook-development before adding, changing, or debugging a construct hook, gate, or guard.
---

# Settings hooks in construct

**Load the official `hook-development` skill first** (anthropics/claude-code plugin-dev) for how to write a hook, its patterns, and its scripts (`scripts/validate-hook-schema.sh`, `scripts/test-hook.sh`, `scripts/hook-linter.sh`). This file adds what it lacks and corrects what is stale. Order of authority: the live docs, then this file, then `hook-development`.

Sources (read 2026-10-23): <https://code.claude.com/docs/en/hooks.md>, <https://code.claude.com/docs/en/permissions.md>. Mods (`hooks/register.js`) are a different mechanism: see the `mods` skill.

## Corrections to hook-development

| hook-development says | Current docs |
| :- | :- |
| `UserPromptSubmit` input `user_prompt`; Stop input `reason`; PostToolUse `tool_result` | `prompt`; Stop has `stop_hook_active`, `last_assistant_message`; PostToolUse has `tool_response` |
| `permission_mode: "ask\|allow"` | `default`, `plan`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions` |
| exit 0 "stdout shown in transcript" | stdout becomes context only on `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`, `PostModelSwitch`; elsewhere debug log |
| `suppressOutput` hides output | has no effect |
| `systemMessage` is shown to Claude | shown to the user as a warning |
| `"command": "bash ${CLAUDE_PLUGIN_ROOT}/..."` unquoted | shell form must double-quote the path; construct uses exec form (`command: "node"`, `args: [...]`) |
| command timeout example 60, implied default | default 600 s; 30 s on `UserPromptSubmit` |
| event list ends at `Notification` | many more: `SubagentStart`, `PostToolUseFailure`, `PostToolBatch`, `PermissionRequest`, `PostCompact`, `InstructionsLoaded`, `ConfigChange`, `FileChanged`, `WorktreeCreate`, `PreModelSwitch`, ... |
| no `if`, `onFailure`, `args`, output cap | all exist; see below |

## Rules that bite construct

- **Exit 2 blocks; anything else non-zero does not.** Exit 1 (an uncaught throw) is a non-blocking `hook error` and the action proceeds. That is why our hooks "fail open". `onFailure: "block"` (v2.1.295+) turns failure/timeout into a block, but has no effect on `Stop`, `SubagentStop`, `TaskCompleted`, `TeammateIdle`, or async hooks.
- **Valid JSON with a non-0/2 exit counts as success** and its fields decide (unless `onFailure: "block"`).
- **stdout is JSON only if it is exactly one JSON object** with nothing but whitespace around it. A stray `console.log` breaks the decision.
- **stdout becomes Claude's context only** on `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`, `PostModelSwitch`; elsewhere it goes to the debug log. Stderr of an exit-0 hook is never seen by Claude.
- **10,000-character cap** on `additionalContext`, `systemMessage`, `initialUserMessage`, and plain stdout; not raisable. Over it, the text is replaced by a file path plus a 2,000-character preview. Our contract budgets (8,000 session) sit under this.
- `<system-reminder>` inside `additionalContext` is escaped (`<` → `&lt;`).
- `suppressOutput` has **no effect**.
- **Timeout = no decision.** Default 600 s for command hooks; 30 s on `UserPromptSubmit`, `PreModelSwitch`, `PostModelSwitch`; 10 s on `MessageDisplay`. A `PreToolUse` timeout does not block (unless `onFailure: "block"`); a `UserPromptSubmit` timeout proceeds without context.
- **All matching hooks run in parallel.** Never assume ordering between two construct hooks on the same event; share state through files (the review store), not sequence.
- **Plugin hooks also run inside subagents.** Check `agent_id`/`agent_type` in the input to tell the main thread from a subagent.
- **Plugin `UserPromptSubmit`, `Stop`, `SubagentStop`, `TaskCompleted`**: exit 2 with empty stdout and stderr containing "No such file or directory" is treated as non-blocking (a missing script after uninstall does not wedge the session).

## Permission precedence (gates)

- Deny and ask **rules** still apply after a hook's `"allow"`, including managed deny rules. `updatedInput` is re-evaluated against rules.
- **Exit 2 stops the call before rules are evaluated**, so it blocks even when an allow rule matches.
- Across hooks: `deny` > `defer` > `ask` > `allow`.
- `permissionDecisionReason`: shown to the user for `ask`, to Claude for `deny`, debug log only for `allow`/`defer`.
- `"ask"` prompts carry a source label (`[plugin:<name>]`) and force a prompt even in auto mode.
- `"defer"` works only in `-p` with a single tool call; ignored with a warning interactively.
- In plan mode a `PreToolUse` `"allow"` has no effect on a non-read-only call (except `ExitPlanMode`).
- A mod's `tool.check` answers **after** `PreToolUse` hooks. With managed settings or a Team/Enterprise login, a mod approval cannot unblock a hook block; without them it can. Our gates are discipline, not a security boundary.

## Events construct uses

| Event | What it can do | Notes |
| :- | :- | :- |
| `SessionStart` | context only (`additionalContext`, plain stdout, `sessionTitle`, `watchPaths`, `reloadSkills`) | matcher `startup\|resume\|clear\|compact\|fork`; exit 2 shows stderr to user only; first response waits for it |
| `UserPromptSubmit` | block (`decision:"block"`, `reason` shown to user, not context), `additionalContext`, `suppressOriginalPrompt` | also fires for `/loop`, scheduled tasks, background subagents reporting back, cross-session messages; cannot replace the prompt |
| `PreToolUse` | `permissionDecision`, `updatedInput` (replaces the whole input), `additionalContext`; exit 2 blocks | not fired for `@` mentions |
| `PostToolUseFailure` | `additionalContext`; exit 2 shows stderr to Claude | input `error`, `is_interrupt`, `duration_ms`; Bash error first line is `Exit code N`; not fired for validation rejections or permission denials |
| `SubagentStart` | `additionalContext` for the subagent; cannot block | matcher is the agent type; plugin agents are `construct:<name>`, so anchor: `^construct:review-risk$` |
| `SubagentStop` | same as `Stop`; `block` sends `reason` to the subagent as its next instruction | input `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`; also fires for internal agents with `agent_type: ""`, which a named matcher does not match |
| `Stop` | `decision:"block"` (needs `reason`) or `additionalContext` | not run on user interrupt; input `stop_hook_active`, `last_assistant_message`, `background_tasks`, `session_crons` |

`stop_hook_active` is true while Claude continues because of a stop hook. After **8 consecutive continuations** the next block is overridden (resets when Claude calls a tool; `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` raises it). The Risk-line gate blocks once per turn; keep it that way.

Unused events worth knowing before adding prompt text: `PostToolUse` (block/`additionalContext`/`updatedToolOutput`), `PostToolBatch` (once per parallel batch), `PermissionRequest`, `PreCompact`/`PostCompact` (`compact_summary`), `InstructionsLoaded`, `ConfigChange`, `FileChanged`, `CwdChanged`, `WorktreeCreate`/`WorktreeRemove`, `TaskCreated`/`TaskCompleted`, `PreModelSwitch` (v2.1.251+).

## Matchers and `if`

- `"*"`, `""`, or omitted matches all. Only letters, digits, `_`, `-`, spaces, `,`, `|` → exact names. Anything else is an **unanchored** JS regex: `Edit.*` also matches `NotebookEdit`; write `^Edit$`.
- A matcher on an event without matcher support is silently ignored.
- Plugin MCP tools: `mcp__plugin_<plugin>_<server>__<tool>`; a whole server needs `.*`.
- `if` takes one permission rule (`"Bash(git push*)"`, `"Edit(**/src/**)"`), only on `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `PermissionDenied`. **On any other event a hook with `if` never runs.** No `&&`/`||`. Bash matching checks each subcommand, including `$()` and backticks, and runs the hook anyway when it cannot tell. It is a cheap pre-filter; the script must still parse the command (`shell-words.mjs`).

## Input fields

Common: `session_id`, `prompt_id`, `transcript_path` (written async, may lag; prefer `last_assistant_message`), `cwd` (follows worktrees and `cd`), `permission_mode`, `effort.level`, `hook_event_name`, `agent_id`/`agent_type` inside subagents. Tool events: `tool_name`, `tool_input`, `tool_use_id`. `file_path` is always absolute.

`tool_input`: Bash `command`, `description`, `timeout`, `run_in_background`; Write `file_path`, `content`; Edit `file_path`, `old_string`, `new_string`, `replace_all`; Agent `prompt`, `description`, `subagent_type`, `model`.

## Plugin hooks and environment

- Exec form (`command` + `args`, what our tests require): spawned directly, no shell, placeholders substituted as plain strings. Use `node` plus the script path (Windows `.cmd` shims cannot be spawned).
- `${user_config.*}` is substituted **only in exec form**; in shell form use `$CLAUDE_PLUGIN_OPTION_<KEY>`.
- `${CLAUDE_PROJECT_DIR}` is the session-start root and does **not** follow worktrees or `/cd`; use the input `cwd`. `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}` are exported too. There is no `$CLAUDE_MODEL`.
- Identical handlers across settings files are deduplicated; a plugin's copy stays separate.
- If a hook starts a background process, print the decision first and redirect the process output, or the call fails with `refusing to honor the suspect capture`.

## What disables hooks

- `disableAllHooks: true` (settings precedence applies: a project `false` overrides a user `true`; `--settings` wins), `--bare` (no project hooks), `--safe-mode`.
- Managed `allowManagedHooksOnly` blocks plugin hooks unless the plugin is force-enabled in managed `enabledPlugins`.
- Interactive sessions hold settings hooks until the folder is trusted; `-p` and SDK treat it as trusted.

## Debugging

`CLAUDE_CODE_DEBUG_LOG_LEVEL=verbose`, `/hooks` to see what loaded, and the "Debug your configuration" page: <https://code.claude.com/docs/en/debug-your-config.md>.
