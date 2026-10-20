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

## How the ODD contract loads

A plugin cannot ship a `CLAUDE.md`, so odd_skills loads its rules in three layers:

| Layer | Mechanism | Content |
|---|---|---|
| Session contract | `SessionStart` hook (startup, resume, clear, compact) | ODD protocol, task size, high-risk list, Risk line, and delegation triggers, under 8,000 characters |
| Subagent contract | `SubagentStart` hook | Artifact language, edit surfaces, scratch, and the `## Key Learnings` closing block. JSON-only reviewers (`review-*`, `jd-judge-*`) get nothing |
| Skills | Loaded on demand | `odd-workflow`, `odd-delegation`, `task-size-risk`, `lossless-prompts` |

The contract texts live in `plugins/odd-skills/hooks/contract/`.

## Agents and model routing

The plugin ships 13 agents. Each role's model and effort can be changed in `/config`, where every option appears as a row such as `ODD Worker model` or `RDD Risk effort`.

| Role | Agent | Model | Effort |
|---|---|---|---|
| ODD Explorer | `odd-skills:odd-explorer` | haiku | default |
| ODD Worker | `odd-skills:odd-worker` | sonnet | medium |
| ODD Verify | `odd-skills:odd-verify` | opus | medium |
| JD Judge A | `odd-skills:jd-judge-a` | opus | medium |
| JD Judge B | `odd-skills:jd-judge-b` | sonnet | medium |
| JD Fix Agent | `odd-skills:jd-fix-agent` | sonnet | medium |
| RDD Risk | `odd-skills:review-risk` | opus | medium |
| RDD Readability | `odd-skills:review-readability` | sonnet | medium |
| RDD Reliability | `odd-skills:review-reliability` | sonnet | medium |
| RDD Resilience | `odd-skills:review-resilience` | sonnet | medium |
| RDD Refuter | `odd-skills:review-refuter` | opus | medium |
| RDD Validator | `odd-skills:review-validator` | opus | medium |
| General delegation | `odd-skills:odd-general` and the built-in `general-purpose` | sonnet | medium |

How the routing works:

- The plugin's mod (`hooks/register.js`) applies the configured model when a subagent spawns and the configured effort on each of its requests.
- The configured model replaces any model passed for that agent at call time.
- An effort of `default` keeps the model's own effort.
- If the mod cannot run, each agent keeps the model and effort in its own frontmatter.

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

Run the tests:

```bash
node --test tests/                       # repository consistency checks
claude plugin test plugins/odd-skills    # mod tests (*.test.ts)
```

Run the behavior evals (they spend real usage; each run is an isolated `claude -p` session):

```bash
cd plugins/odd-skills
claude plugin eval . --scaffold --trust-plugin --runs 1 --model sonnet \
  --allow-tools Write Edit "Bash(npm test*)" "Bash(node *)" "Bash(git *)" "Bash(mkdir *)" "Bash(ls *)" "Bash(cat *)"
```

## Layout

| Path | Contents |
|---|---|
| `.claude-plugin/marketplace.json` | Local marketplace `odd-skills`; allows the cross-marketplace `engram` dependency |
| `plugins/odd-skills/` | The plugin (manifest name `odd-skills`) |
| `plugins/odd-skills/agents/` | The 13 role agents |
| `plugins/odd-skills/skills/` | Delivery and review skills (`branch-pr`, `chained-pr`, `work-unit-commits`, `judgment-day`, ...) |
| `plugins/odd-skills/hooks/` | `hooks.json`, the mod (`register.js`), and its routing helpers |
| `plugins/odd-skills/hooks/contract/` | Session and subagent contract texts injected by hooks |
| `plugins/odd-skills/evals/` | Behavior eval cases run by `claude plugin eval` |
| `plugins/odd-skills/tests/` | Mod tests run by `claude plugin test` |
| `tests/` | Repository tests run by `node --test` |
| `odd/tasks/` | ODD feature documents (specs, tasks, log) |

## License notice

Part of the agents and skills are adapted from MIT-licensed material; see [`plugins/odd-skills/NOTICE`](plugins/odd-skills/NOTICE).

## Status

Work in progress. The plan and task list live in [`odd/tasks/odd-skills-plugin.md`](odd/tasks/odd-skills-plugin.md).
