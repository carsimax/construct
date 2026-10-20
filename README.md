# odd_skills

odd_skills is a Claude Code plugin for Organic Driven Development (ODD). It ships orchestration rules, review lenses, and delivery skills as plugin components only: agents, skills, hooks, mods, workflows, and output styles. Engram stays an independent memory instance; this plugin depends on it.

## Requirements

- Claude Code with plugin support.
- Node.js 20 or later for the plugin's scripts and hooks (`bin/odd-assess`, and the hook scripts as they land). Claude Code's native install does not bundle Node.js.
- `git` on the PATH for `odd-assess`.
- The engram binary and marketplace (see Quick path).

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
| Output style | `/config` → Output style → `Neutral` | Reply tone, language, response length, verification, and working rules (no AI attribution in commits, one question at a time) |

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

## Risk assessment: odd-assess

`bin/odd-assess` is a Node.js port of the deterministic risk classifier that decides whether a change needs review. The plugin's `bin/` directory is on the `PATH` of the Bash tool while the plugin is enabled.

```bash
odd-assess                                   # current working state against HEAD
odd-assess --base-ref main --committed-only  # main..HEAD, committed changes only
odd-assess --json                            # machine-readable result
odd-assess --escalate-item 2 --escalate-reason "touches the login guard" --json
```

| Option | Meaning |
|---|---|
| `--cwd DIR` | Repository path (default: current directory) |
| `--base-ref REF` | Assess `REF` to `HEAD`. Tracked files must be clean, or pass `--committed-only` to ignore them |
| `--committed-only` | Acknowledge that `--base-ref` ignores dirty tracked changes. It only qualifies `--base-ref`: passing it alone is a usage error (exit `2`) |
| `--escalate-item N`, `--escalate-reason TEXT` | Raise the tier to `high` by citing high-risk item 1 to 6 (reason at most 500 bytes). Both flags or neither; a tier is never lowered |
| `--json` | Print the `odd-skills.review-assessment/v1` object instead of a short summary |

Without `--base-ref`, the candidate is the working tree (tracked plus untracked, not ignored), frozen through a temporary index. Your real index is never changed.

The JSON result has `risk` (`passive`, `medium`, `high`), `reasons`, `changed_paths`, `changed_lines`, `candidate`, `review_due`, `review_due_reason`, and `lenses` (empty for passive and medium, the four canonical lenses for high). Only `high` makes a review due; `medium` reports `under_budget` and `passive` reports `passive`. When the exact candidate already has a receipt from `odd-review acknowledge`, `candidate.consumed` is `true` and the result reports `review_due: false` with `review_due_reason: "already_reviewed"`, whatever the tier.

Exit codes: `0` for any successful assessment, including a fail-closed one (`risk: "high"` with one `unassessable` reason, for example when `--base-ref` names a missing ref); `2` for bad usage, with the message on stderr.

## Review lifecycle (`odd-review`)

`bin/odd-review` runs the review lifecycle without any external binary: it freezes the candidate, serves immutable evidence to the review agents, validates their results, drives one bounded correction, and records a receipt. It never asks for consent; that belongs to the review skill.

```bash
odd-review start --lenses risk,reliability --lenses-reason "touches the login guard"   # or --base-ref main --committed-only
odd-review context --lineage L --lens risk          # evidence for one lens (binding + block)
odd-review capture --lineage L --lens risk --input result.json     # one per selected lens ("-" reads stdin)
odd-review capture-refuter --lineage L --input refuter.json        # only after refutation_required
odd-review correct --lineage L                      # once, after correction_required
odd-review capture-validation --lineage L --input validator.json
odd-review status --lineage L
odd-review acknowledge --lineage L                  # only when approved; writes the receipt
```

States: `collecting` to `approved`, `refutation_required`, or `correction_required`; `refutation_required` to `approved` or `correction_required`; `correction_required` to `validation_required`; `validation_required` to `approved` or `escalated` (a human decision); `approved` to `acknowledged`.

- Every command prints JSON with the exact `next` commands. Exit `0` is success, `1` a refused transition (`{"error":{"code","message"}}` on stderr), `2` bad usage.
- Lenses are `review-risk`, `review-resilience`, `review-readability`, and `review-reliability`; the short names work and the canonical order is kept.
- The candidate is frozen into immutable git trees (the working state goes through a temporary index). `context` serves name-status, numstat, and one verbatim patch per changed path from those trees only, and refuses with `context_budget_exceeded` above 400 KB (`--max-bytes N` overrides it); split the change into smaller slices when that happens.
- `capture` validates the result against the agent's output contract: matching `subject_hash`, no unknown or missing fields, a completed inspection that lists exactly the changed paths, a selected lens, and one capture per lens.
- Only a BLOCKER or CRITICAL finding introduced by the candidate blocks. Deterministic ones need a correction; inferential ones go to the refuter first. Everything else is advisory and lands in the receipt.
- `correct` is allowed once per lineage and may change at most `min(200, ceil(n/2))` lines, where `n` is the reviewed line count. A correction over the budget is refused and does not use up the one correction.
- `acknowledge` accepts only `approved` and refuses a replay. `start` refuses a candidate that already has a receipt.

Store: `$(git rev-parse --git-common-dir)/odd-review/`, so nothing is written into the worktree and linked worktrees share it.

```
odd-review/transactions/<lineage>.json   # one per review; <lineage>.lock while a command writes it
odd-review/receipts/<target hex>.json    # written by acknowledge
```

Writes are a temporary file plus a rename. A second writer on a locked transaction is refused (`transaction_locked`); a lock left by a dead process is reclaimed. No command changes the index, `HEAD`, or the working tree.

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
node --test tests/                       # repository checks, odd-assess and odd-review tests
claude plugin test plugins/odd-skills    # mod tests (*.test.ts)
```

Run the behavior evals (they spend real usage; each run is an isolated `claude -p` session):

```bash
scripts/eval.sh                 # all cases, 1 run per arm, sonnet
scripts/eval.sh --case small-inline
```

`scripts/eval.sh` evaluates a temporary copy of the plugin without the `engram@engram` dependency, because isolated eval runs cannot resolve it and the plugin would not load.

## Layout

| Path | Contents |
|---|---|
| `.claude-plugin/marketplace.json` | Local marketplace `odd-skills`; allows the cross-marketplace `engram` dependency |
| `plugins/odd-skills/` | The plugin (manifest name `odd-skills`) |
| `plugins/odd-skills/agents/` | The 13 role agents |
| `plugins/odd-skills/skills/` | Delivery and review skills (`branch-pr`, `chained-pr`, `work-unit-commits`, `judgment-day`, ...) |
| `plugins/odd-skills/hooks/` | `hooks.json`, the mod (`register.js`), and its routing helpers |
| `plugins/odd-skills/bin/` | Executable scripts put on the `PATH` (`odd-assess`) |
| `plugins/odd-skills/lib/assess/` | `odd-assess` modules: git, stats, passive, signals, sinks, content, classify, escalation, output |
| `plugins/odd-skills/hooks/contract/` | Session and subagent contract texts injected by hooks |
| `plugins/odd-skills/evals/` | Behavior eval cases run by `claude plugin eval` |
| `plugins/odd-skills/tests/` | Mod tests run by `claude plugin test` |
| `tests/` | Repository tests run by `node --test` |
| `odd/tasks/` | ODD feature documents (specs, tasks, log) |

## License notice

Part of the agents and skills are adapted from MIT-licensed material; see [`plugins/odd-skills/NOTICE`](plugins/odd-skills/NOTICE).

## Status

Work in progress. The plan and task list live in [`odd/tasks/odd-skills-plugin.md`](odd/tasks/odd-skills-plugin.md).
