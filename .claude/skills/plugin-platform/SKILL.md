---
name: plugin-platform
description: Construct overlay on the official plugin-structure skill. Current plugin platform rules (userConfig, path variables, versions and cache, loading precedence, claude plugin CLI, /reload-plugins, --plugin-dir), corrections where plugin-structure is out of date, and construct's own layout. Use together with plugin-structure when changing plugin.json, marketplace.json, userConfig, bin/, component layout, the installer, or when a change "does nothing" after install or reload.
---

# The plugin platform in construct

**Load the official `plugin-structure` skill first** (anthropics/claude-code plugin-dev) for directory layout, naming, and component organization. This file adds what it lacks and corrects what is stale. Order of authority: the live docs, then this file, then `plugin-structure`.

## Corrections to plugin-structure

| plugin-structure says | Current docs |
| :- | :- |
| `plugin.json` is required | optional; only `name` is required inside it |
| version must follow semver | not checked against semver; any string, and it pins users until it changes |
| `"command": "bash ${CLAUDE_PLUGIN_ROOT}/..."` unquoted | shell form must double-quote; prefer exec form with `args` |
| no `userConfig`, `${CLAUDE_PLUGIN_DATA}`, `bin/`, output styles, `modules`, `types` | all exist; see below |
| custom paths for components | `commands`, `agents`, `outputStyles` replace their default folder; `skills` adds to it |

Sources (read 2026-10-23): [manifest reference](https://code.claude.com/docs/en/plugins/manifest-reference.md), [components](https://code.claude.com/docs/en/plugins/components.md), [loading](https://code.claude.com/docs/en/plugins/loading.md), [CLI reference](https://code.claude.com/docs/en/plugins/cli-reference.md). Version-gated details change; re-read before relying on one. Hook semantics: `settings-hooks` skill. Mod module: `mods` skill.

Construct today: `plugins/construct/.claude-plugin/plugin.json` sets `name`, `displayName`, `version` (8.1.0), `license`, `description`, `author`, `keywords`, `types`, and 35 `userConfig` options. `.claude-plugin/marketplace.json` lists it with the relative source `./plugins/construct`.

## plugin.json rules

- Only `name` is required (kebab-case; no `claude-`, `anthropic-`, `cc-plugin-` prefixes). Components are namespaced under it: `construct:worker`, `/construct:review`.
- Unknown top-level keys are stripped with a warning (fails `--strict`). Unknown keys **inside** `userConfig` options, `channels`, `lspServers`, `monitors` are errors: the plugin does not load.
- Component paths are relative and start with `./`, use forward slashes, and must stay inside the plugin root (`..` is rejected).
- `skills` **adds** to the `skills/` scan; `commands`, `agents`, `outputStyles`, `workflows`, `experimental.themes`, `experimental.monitors` **replace** their default folder (the folder is then ignored with a warning). `hooks` merges with `hooks/hooks.json`.
- `types` points to a `.d.ts` that declares a mod's `$.state` and `$` nouns.
- `settings` (or a root `settings.json`, which wins): only `agent` and `subagentStatusLine` take effect. Plugin defaults are the lowest layer.
- A root `CLAUDE.md` is **not** loaded as context (validate warns). That is why construct injects its contract through hooks.
- `homepage` must parse as a URL or the plugin fails to load.

## userConfig

- Option fields: `type` (`string`, `number`, `boolean`, `directory`, `file`), `title`, `description`; optional `required`, `default`, `options` (string only, not with `multiple`/`sensitive`, v2.1.271+; `default` must be one of them), `multiple`, `sensitive`, `min`/`max`. Keys: letters, digits, `_`, not starting with a digit.
- Values reach components as:
  - `CLAUDE_PLUGIN_OPTION_<KEY>` (uppercased) in hook processes, for every option. This is what construct's hooks read.
  - `${user_config.KEY}` in MCP/LSP config, exec-form hook `args`, and **skill and agent Markdown bodies** (non-sensitive only).
  - Rejected (component fails) in shell-form hook `command`, monitor `command`, MCP `headersHelper`. Monitors get neither form.
- Non-sensitive values live under `pluginConfigs` in user `settings.json`; `sensitive` ones in the OS credential store.
- Rows appear in `/config` (v2.1.269+), except `sensitive` and `multiple`. `claude plugin install` never prompts: `--config KEY=VALUE` or `claude plugin configure --values-stdin`.
- Adding, renaming, or removing an option, or changing its `type`/`options`, is a consumed-contract change (Risk item 3): stored user values may stop loading.

## Path variables

| Variable | Value | Use |
| :- | :- | :- |
| `${CLAUDE_PLUGIN_ROOT}` | the installed version's directory, `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`; for a local-path marketplace, the source directory | read-only code; changes on every update, never write state here |
| `${CLAUDE_PLUGIN_DATA}` | `~/.claude/plugins/data/<id>/` (`construct@construct` → `construct-construct`) | durable caches; survives updates, deleted on last uninstall unless `--keep-data` |
| `${CLAUDE_PROJECT_DIR}` | session-start project root | does not follow worktrees |

Exported to hook processes: ROOT, DATA, PROJECT_DIR, OPTION_*. **None of them are in the Bash tool's environment**, in the main session or subagents. Construct's per-repository stores live under the git common dir, not `CLAUDE_PLUGIN_DATA`, so they are shared by worktrees.

## Components

- `bin/`: on the Bash tool's `PATH` while enabled, **after** the user's own entries (cannot shadow `git`). Needs `chmod +x`. claude.ai and Cowork refuse to install a plugin with `bin/`.
- Agents: `agents/*.md`, recursive; subfolders become name segments. Plugin agents **ignore** `permissionMode`, `hooks`, `mcpServers`, `initialPrompt`. Details: `agents-and-skills-authoring` skill.
- Skills: `skills/<dir>/SKILL.md` → `/construct:<dir>`; frontmatter `name` replaces the last segment.
- Hooks: `hooks/hooks.json` with a top-level `"hooks"` key; a `modules` key lists mod modules. If two enabled plugins share a manifest name, only one registers hooks and only one loads its module (Errors tab, v2.1.296+).
- Output styles: `output-styles/<name>.md` → `construct:<name>` in `/output-style`.
- Monitors and workflows exist too: monitors run only interactively, never with `-p`, and not in repository (project-scope) plugins.

## Versions, cache, and "my change does nothing"

- Version resolution: manifest `version`, then marketplace entry `version`, then a source-derived value (12-char git SHA for git sources; `unknown` for a non-git local directory).
- A pinned `version` keeps users on the cached copy until the string changes: `construct is already at the latest version (8.1.0).` So every release bumps `version` (see CONTRIBUTING releases).
- Relative-path plugins in a local-path marketplace load **in place**: edits apply at the next session or `/reload-plugins`, no bump needed, no Node dependency install.
- Old version directories get `.orphaned_at` and are removed after 14 days.
- Node deps install only for copied plugins with `package.json` plus `bun.lock`, `npm-shrinkwrap.json`, or `package-lock.json` (v2/v3), `--ignore-scripts`, 60 s timeout. Construct has no runtime dependencies; keep it that way.

## Which settings load the plugin

`enabledPlugins`, lowest to highest: `--add-dir` (only `true`), user `~/.claude/settings.json`, project `.claude/settings.json`, local `.claude/settings.local.json`, `--settings`, managed (`true` forces, `false` blocks). The highest source that names the id wins. A project-only enable of an external-source plugin is not fetched. Claude Code does not scan `.claude/plugins/`.

## CLI and reload

- `claude plugin validate --strict <path>`: warnings fail; exit `0`, `1`, or `2`; `--json` (v2.1.259+). Run on both `.` and `./plugins/construct`.
- `claude plugin test [dir]`: mod tests (`*.test.ts`), no session or network.
- `claude plugin eval`: see the `plugin-evals` skill.
- `install`/`uninstall`/`update`/`enable`/`disable` take `-s, --scope user|project|local` (`update` also `managed`); `enable` on an already-enabled plugin exits `1` (`already_in_goal_state`). `uninstall --keep-data`.
- `claude plugin tag [path]` creates `<name>--v<version>` and checks that `plugin.json` and the marketplace entry agree.
- `/reload-plugins [--force]` reloads hooks, skills, agents, MCP, LSP; prints `Reloaded: N plugins · N skills · ...`. It refuses without `--force` when the change would invalidate the prompt cache; monitors need a restart. Not documented for output styles or mod modules: restart the session to be sure.
- `--plugin-dir <path>` (repeatable; directory or `.zip`): loads in place as `<name>@inline`, silently overrides a same-named installed copy (`--debug` logs `Plugin "<name>" from --plugin-dir overrides installed version`), unless managed settings lock the name or `claude plugin disable <name>@inline` was run.
