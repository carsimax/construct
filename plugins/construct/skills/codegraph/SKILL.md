---
name: codegraph
description: "Answer structural codebase questions with CodeGraph before broad file searches: repo maps, architecture, call flow, dependencies, symbol references, impact analysis, and how-does-X-work questions. Trigger: any structural or codebase question, or before editing symbols whose callers matter."
license: MIT
metadata:
  author: Construct
  version: "1.0"
---

## Activation Contract

Load this skill before answering a structural or codebase question (architecture, call flow, dependencies, references, impact) or before changing symbols whose callers matter. For one known file or symbol, a direct read is fine.

## Hard Rules

- Use CodeGraph before broad Read, Glob, or Grep exploration for structural questions.
- Prefer the `mcp__codegraph__codegraph_explore` MCP tool. It returns the relevant source, call paths, and blast radius in one call. It is the only CodeGraph tool the MCP server exposes (others stay unlisted unless `CODEGRAPH_MCP_TOOLS` is set).
- Without the MCP tool, use the upstream CLI's read-only commands: `codegraph status`, `codegraph query`, `codegraph explore`, `codegraph node`, `codegraph files`, `codegraph callers`, `codegraph callees`, `codegraph impact`, `codegraph affected`.
- Never run `codegraph init`, `codegraph uninit`, `codegraph install`, `codegraph uninstall`, or `codegraph upgrade`. Indexing stays the user's decision: ask them to run `codegraph init`. Run `codegraph index` only to recover a corrupted index.
- Never suggest initializing CodeGraph in `$HOME`, a temporary directory, or a folder that is not a project.
- Every git worktree needs its own `.codegraph/` index. Never copy, symlink, or reuse another checkout's index.
- Create worktrees that may need CodeGraph under the user's home directory. For a repository rooted there, place them as a sibling of the repository root at `<repo-parent>/<repo>-worktrees/<name>`, where `<repo-parent>` is the immediate parent directory of the repository root (repo `~/Projects/Rust/foo` → `~/Projects/Rust/foo-worktrees/<name>`). Never use `/tmp` or `/var/tmp`; generic temporary-work guidance does not override this rule.

## Decision Gates

| Situation | Action |
|---|---|
| `<project-root>/.codegraph/` exists | Use the MCP tool, or the CLI read commands |
| `.codegraph/` missing in a real git project | Do not initialize. Ask the user to run `! codegraph init <project-root>`, and use file tools meanwhile. If the session notice says indexing started in the background (the user's opt-in `codegraph_auto_index` option), do not run init either: use file tools until `codegraph status` reports the index complete (`"state":"complete"` in `--json`) |
| Target directory is not a git root | Do not suggest init; explain that `git -C <dir> init` would be needed and fall back to file tools |
| Index looks stale (banner after edits) | Run `codegraph sync -q <project-root>` once, then retry |
| `codegraph sync` fails | Do not trust the existing index; say so and fall back to file tools |
| MCP tool and CLI both unavailable | Fall back to Read, Glob, and Grep, and say why |

## Execution Steps

1. Resolve the project root. For an existing repository use `git rev-parse --show-toplevel`; otherwise the agent's working directory is authoritative.
2. Check for `<project-root>/.codegraph/` before any broad file exploration.
3. If it is missing, ask the user to run `codegraph init` (see Decision Gates) and continue with file tools.
4. Query. The MCP server and its daemon watch files and auto-sync (2 s debounce); results carry a staleness banner after edits. Sync manually only when that banner or the results show staleness.
5. Answer from the returned source and call paths, citing `path:line`.

## Index scope

A `codegraph.json` at the repo root tunes what gets indexed (the user edits it; the agent only suggests):

- `exclude`: gitignore-style patterns that drop committed vendored or generated directories.
- `include`: forces gitignored source into the index.
- `deprioritize`: stays indexed but ranks lower in results (for example `scripts/`).

## Setup

The plugin does not ship MCP servers, so it never duplicates servers the user already registered. Install the CLI, then register once at user scope. CodeGraph needs `alwaysLoad: true` so `codegraph_explore` is available from the first prompt instead of deferred behind tool search. `claude mcp add` has no such flag, so use `add-json` (or edit `~/.claude.json`):

```bash
npm install -g @colbymchenry/codegraph   # or the upstream install.sh
claude mcp add-json --scope user codegraph '{"type":"stdio","command":"codegraph","args":["serve","--mcp"],"alwaysLoad":true}'
```

Allow the tool without prompts by adding `"mcp__codegraph__*"` to `permissions.allow` in `~/.claude/settings.json`. The tool name is `mcp__codegraph__codegraph_explore`, which the plugin's agents reference.

## Output Contract

Return the answer with `path:line` evidence. State when you fell back to file tools, and why.
