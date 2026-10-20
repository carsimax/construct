# odd_skills

odd_skills is a Claude Code plugin for Organic Driven Development (ODD). It ships orchestration rules, review lenses, and delivery skills as plugin components only: agents, skills, hooks, mods, workflows, and output styles. Engram stays an independent memory instance; this plugin depends on it.

## Quick path

1. Install the engram binary and register its MCP server:

   ```bash
   brew install gentleman-programming/tap/engram
   engram setup claude-code
   ```

2. Add the engram marketplace first. odd_skills declares `engram@engram` as a dependency, and the dependency resolves only from a marketplace you have already added:

   ```bash
   claude plugin marketplace add Gentleman-Programming/engram
   ```

3. Add this marketplace and install the plugin:

   ```bash
   claude plugin marketplace add <path-or-repo-of-odd_skills>
   claude plugin install odd-skills@odd-skills
   ```

   The install output ends with `(+ 1 dependency: engram)` when engram was not installed yet.

## Local development

Load the plugin for one session without installing it:

```bash
claude --plugin-dir ./plugins/odd-skills
```

Validate the marketplace and the plugin:

```bash
claude plugin validate --strict .
claude plugin validate --strict ./plugins/odd-skills
```

## Layout

| Path | Contents |
|---|---|
| `.claude-plugin/marketplace.json` | Local marketplace `odd-skills`; allows the cross-marketplace `engram` dependency |
| `plugins/odd-skills/` | The plugin (manifest name `odd-skills`) |
| `odd/tasks/` | ODD feature documents (specs, tasks, log) |

## Status

Work in progress. The plan and task list live in [`odd/tasks/odd-skills-plugin.md`](odd/tasks/odd-skills-plugin.md).
