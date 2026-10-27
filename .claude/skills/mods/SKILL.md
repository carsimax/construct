---
name: mods
description: Claude Code mod capabilities and limits for developing construct. Use when designing or changing a construct feature, a hook, the panel, routing, a command, or a gate, to decide whether a mod (hooks/register.js), a settings hook (hooks/scripts/*.mjs), a skill, or an MCP server is the right mechanism.
---

# Mods in construct

Source: <https://code.claude.com/docs/en/plugins/mods/overview> (read 2026-10-23). Re-read the linked page before relying on a detail that may have changed; the docs win over this file.

A mod is plugin code (JS/TS) that Claude Code runs **in its own process**. `register(on)` registers handlers ("hooks") for events. Settings hooks (our `hooks/scripts/*.mjs`, exec form in `hooks.json`) are external processes; the docs call those "settings hooks".

## What only a mod can do

- Draw UI: a pane beside the transcript or a band above the prompt, with tabs, buttons, text fields. → [interface](https://code.claude.com/docs/en/plugins/mods/interface.md)
- Restyle Claude Code's own UI: tool-call rows, spinner, the question dialog. Never the permission prompt.
- Step into a tool call or request: hold it while asking the user, answer it without running the tool, send one request to another model. → [events](https://code.claude.com/docs/en/plugins/mods/events.md)
- `/command` that runs a function at once, with no Claude turn, even while Claude works. → [api](https://code.claude.com/docs/en/plugins/mods/api.md#add-a-command-or-a-tool)
- Share state between hooks through module variables (one hook records, another shows).

## Handler semantics

Each handler runs **before** Claude Code acts and receives `($, e, next)`:

- Observe: `return next(e)`.
- Rewrite: `return next({ ...e, ...changes })`.
- Answer: return a result without calling `next`; the default behavior does not run.

Anything outside the handler's own code (draw, command, model call, file read, process, network) goes through `$` (the mods API). That is why `claude plugin validate` can list a mod's `hooks:` and `calls:` without running it; check that output after adding a new `$` call.

## Where it runs (matters for evals and tests)

| Host | Hooks run | Drawing shows |
| :- | :- | :- |
| `claude` terminal, JetBrains | yes | yes |
| Desktop Code tab (not WSL) | yes | yes, except terminal-only elements |
| VS Code panel | yes | yes, extension ≥ 2.1.299 (≥ 2.1.304 without feature-flag fetch, e.g. Bedrock) |
| `claude -p`, Agent SDK | yes | **no** |
| Remote Control | yes, on the local machine | local terminal only |
| Cloud session | yes, if the plugin reaches it | no |

Consequences for construct:

- `scripts/eval.sh` runs `claude -p`: routing hooks fire, the panel never draws. Test panel behavior with `claude plugin test plugins/construct`, not evals. → [test](https://code.claude.com/docs/en/plugins/mods/test.md)
- A drawing feature needs a fallback (a transcript line or a command's text reply) where nothing draws.
- Minimum versions: terminal v2.1.287, Desktop v2.1.286. Keep `MIN_CLAUDE` in `hooks/status/` consistent with any new API used.

## What turns a mod off

- `disableAllHooks: true`, `--safe-mode`, `--bare`, and an org's `allowManagedModsOnly` stop the mod but leave the plugin's skills, agents, commands, and MCP servers loaded. Agent frontmatter is construct's fallback for routing; any new mod feature needs an equivalent "mod absent" behavior.
- `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` is ignored from v2.1.287.
- Built-in mods (`cc-plugin-sec-default`, `cc-plugin-diff`, ...) are not stopped by those flags. `cc-plugin-sec-default` runs first and can skip later handlers for an event.
- Check what loaded: `/plugin` shows `N mod active · <names>`. → [troubleshoot](https://code.claude.com/docs/en/plugins/mods/troubleshoot.md)

## Trust and permission limits

- Mods are not sandboxed: they run as the user (files, processes, network, env secrets, every prompt and tool call, model usage).
- A mod can approve a tool call before the user is asked. With managed settings or a Team/Enterprise login, that approval does **not** pass `ask` rules or `PreToolUse` hooks by default; without them it can. Never rely on a mod approval to get past construct's own gates, and never use one to skip a gate. → [permissions precedence](https://code.claude.com/docs/en/permissions.md#precedence-among-rules-hooks-and-mods)
- The publication gate, surface guard, and command guard stay settings hooks: they must also work when mods are disabled.

## Choosing the mechanism

| Need | Use |
| :- | :- |
| Pane, band, spinner/tool-row restyle, instant `/command`, rewriting an event, per-role model/effort routing | Mod (`hooks/register.js`) |
| Block, allow, or log an event with a script; also usable as a git hook or from the CLI (`pre-push.mjs`) | Settings hook (`hooks/scripts/`) |
| Instructions Claude should follow | Skill |
| Claude needs to reach an external system | MCP server |

`disableAllHooks` stops settings hooks too; see [what runs under allowManagedHooksOnly](https://code.claude.com/docs/en/settings-reference#what-runs-under-allowmanagedhooksonly) before claiming a mechanism survives a setting.

## What construct already uses

`hooks/register.js` handles `session.start`, `session.compact`, `turn.start`, `turn.step`, `turn.complete`, `tool.call`, `tool.check`, `agent.spawn`, `command.run` (`/construct`), and `ui.render` (`Pane`). It calls `$.ui.open/close/invalidate`, `$.command.register`, `$.process.run`, `$.fs.list/read`, `$.session.*`, `$.clock.now`. Unused capabilities worth considering before adding a settings hook or more prompt text: the band above the prompt, spinner/tool-row restyle, holding a tool call for a user question, answering a tool call directly, and model calls from a hook.

## References

- Reference (events, methods, elements, limits): <https://code.claude.com/docs/en/plugins/mods/reference.md>
- Create: <https://code.claude.com/docs/en/plugins/mods/create.md>
- Admin and policy mods: <https://code.claude.com/docs/en/plugins/mods/admin.md>
- Built-in mod sources (`diff`, `agents-md`, `sec-default`, `telemetry`): <https://github.com/anthropics/claude-code/tree/main/mods>
- Samples (`token-weather`, `blast-radius`, `replay-theater`): <https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods>
