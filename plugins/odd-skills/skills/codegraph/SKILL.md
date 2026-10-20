---
name: codegraph
description: "Answer structural codebase questions with CodeGraph before broad file searches: repo maps, architecture, call flow, dependencies, symbol references, impact analysis, and how-does-X-work questions. Trigger: any structural or codebase question, or before editing symbols whose callers matter."
license: MIT
metadata:
  author: odd_skills
  version: "1.0"
---

## Activation Contract

Load this skill before answering a structural or codebase question (architecture, call flow, dependencies, references, impact) or before changing symbols whose callers matter. For one known file or symbol, a direct read is fine.

## Hard Rules

- Use CodeGraph before broad Read, Glob, or Grep exploration for structural questions.
- Prefer the `mcp__codegraph__codegraph_explore` MCP tool. It returns the relevant source, call paths, and blast radius in one call.
- Without the MCP tool, use the upstream CLI's read-only commands: `codegraph status`, `codegraph query`, `codegraph explore`, `codegraph node`, `codegraph files`, `codegraph callers`, `codegraph callees`, `codegraph impact`, `codegraph affected`.
- Never run `codegraph uninit`, `codegraph install`, `codegraph uninstall`, or `codegraph upgrade`. Run `codegraph index` only to recover a corrupted index.
- Never initialize CodeGraph in `$HOME`, a temporary directory, or a folder that is not a project.
- Every git worktree needs its own `.codegraph/` index. Never copy, symlink, or reuse another checkout's index.
- Place worktrees that may need CodeGraph under the home directory (for example `<repo-parent>/<repo>-worktrees/<name>`), never under `/tmp`.

## Decision Gates

| Situation | Action |
|---|---|
| `<project-root>/.codegraph/` exists | Use the MCP tool, or run `codegraph sync -q <project-root>` before CLI reads |
| `.codegraph/` missing in a real git project | Run `codegraph init <project-root>` once, then continue |
| Target directory is not a git root | Do not initialize; explain that `git -C <dir> init` would be needed and fall back to file tools |
| `codegraph sync` fails | Do not trust the existing index; say so and fall back to file tools |
| MCP tool and CLI both unavailable | Fall back to Read, Glob, and Grep, and say why |

## Execution Steps

1. Resolve the project root. For an existing repository use `git rev-parse --show-toplevel`. For initialization, the agent's working directory is authoritative; never replace it with an enclosing repository.
2. Check for `<project-root>/.codegraph/` before any broad file exploration.
3. Initialize when missing (see Decision Gates), then query.
4. For CLI reads, run `codegraph sync -q <project-root>` first, including after edits. The MCP server syncs only while its file watcher is running.
5. Answer from the returned source and call paths, citing `path:line`.

## Setup

The plugin does not ship MCP servers, so it never duplicates servers the user already registered. Register them once at user scope:

```bash
claude mcp add --scope user codegraph -- codegraph serve --mcp
claude mcp add --scope user context7 -- npx -y --package=@upstash/context7-mcp@2.2.5 -- context7-mcp
```

The tool names are then `mcp__codegraph__*` and `mcp__context7__*`, which the plugin's agents reference.

## Output Contract

Return the answer with `path:line` evidence. State when you fell back to file tools, and why.
