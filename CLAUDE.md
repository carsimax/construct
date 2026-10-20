# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

Construct: a Claude Code plugin (in `plugins/construct/`) plus its local marketplace (`.claude-plugin/marketplace.json`) and a curl installer (`install.sh`). The plugin implements Organic Driven Development (ODD): it injects an orchestration contract through hooks, ships role agents, skills, a mod (model/effort routing and a status band), an output style, and a theme. It depends on the separate `engram@engram` plugin for memory. There is no build step; everything is plain Node.js ESM (Node 20+) and Markdown.

## Commands

```bash
node --test tests/                              # repository tests (contract, skills, agents, odd-assess, odd-review, hook gates and guard, installer)
node --test tests/assess/cli.test.mjs           # one test file
node --test --test-name-pattern="Risk-line" tests/   # tests matching a name
claude plugin test plugins/construct            # mod tests (plugins/construct/tests/*.test.ts)
claude plugin validate --strict .               # marketplace manifest
claude plugin validate --strict ./plugins/construct
claude --plugin-dir ./plugins/construct         # load the plugin for one session without installing
scripts/eval.sh [--case small-delegated]        # behavior evals; spend real usage, each run is an isolated `claude -p`
```

`scripts/eval.sh` evaluates a temporary copy of the plugin whose manifest drops the `engram@engram` dependency, because isolated eval runs cannot resolve it and the plugin would otherwise not load.

## Architecture

A plugin cannot ship a `CLAUDE.md`, so the ODD rules load in layers:

- **Session contract**: `hooks/scripts/contract.mjs session` emits `hooks/contract/session.md` as `additionalContext` on every `SessionStart`. The injected text, including the CodeGraph index notice, must stay under 8,000 characters; `tests/contract.test.mjs` checks every notice variant with long project paths, so `session.md` itself has about 7,400 characters of room and is near it now (`wc -c`). Rewrite text in place instead of appending.
- **Subagent contract**: `contract.mjs subagent` emits `hooks/contract/subagent.md` on `SubagentStart`; JSON-only reviewers (`review-*`, `jd-judge-*`) get nothing.
- **Feature state**: `hooks/scripts/feature-state.mjs` re-injects unfinished tasks from `odd/tasks/*.md` after compact/resume (read-only, at most 2,500 characters).
- **Skills** (`plugins/construct/skills/*/SKILL.md`) hold the full procedures and load on demand; the contract only names them.
- **Output style**: `output-styles/principal-engineer.md`, forced with `force-for-plugin`.

Other moving parts:

- **Mod** (`hooks/register.js`, listed under `modules` in `hooks/hooks.json`): routes each agent role's model and effort from the plugin's `userConfig` (`model_<role>`, `effort_<role>`, where role is the agent name with dashes turned into underscores; see `hooks/routing.js`), and renders the status band (`hooks/status/`). Agent frontmatter is the fallback when the mod cannot run.
- **Command hooks** (`hooks/scripts/`): `secret-guard.mjs` (PreToolUse deny for protected paths and destructive commands), `review-context.mjs` / `review-capture.mjs` / `review-gate.mjs` (RDD review plumbing), `risk-line.mjs` (Risk-line gate: `mark` on UserPromptSubmit records the tree, `check` on Stop blocks once per turn when paths outside `odd/tasks/` changed and the reply has no Risk line; fails open), `subagent-count.mjs` (SubagentStart/SubagentStop record open agents so `review-gate.mjs` and `risk-line.mjs` stay silent while subagents run), all sharing `hook-io.mjs`. Hooks are registered in exec form (`command: "node"`, `args: [...]`), which tests check.
- **CLIs on the PATH** (`plugins/construct/bin/`): thin entry points into `lib/`. `odd-assess` (`lib/assess/`) classifies a diff's risk from git stats, signals, and sinks; `odd-review` (`lib/review/`) runs the receipt-driven review lifecycle, its mode switch, and its store.
- **Evals** (`plugins/construct/evals/<case>/`): `case.yaml`, `prompt.md`, `fixture.sh`, and Markdown graders, run by `claude plugin eval`.
- **Feature documents** (`odd/tasks/<feature>.md`): specs (`S#`), tasks (`T#`), and log for each tracked feature. Tests and comments reference spec ids such as `S6`.

## Consistency the tests enforce

Many tests cross-check text against code, so a change in one place usually needs the matching change elsewhere:

- Adding or removing an agent: update the S6 table in `tests/agents-config.test.mjs`, the `userConfig` options in `plugin.json`, and the agent table in `README.md`.
- Adding or removing a skill: update `EXPECTED` in `tests/skills.test.mjs`; relative links inside skills must resolve.
- Every construct component a contract names must exist; every `odd-review` command or flag that `rdd-review` names must exist in `lib/review/`.
- `scripts/eval.sh` may grant only the commands the eval cases need.
- Help text and `README.md` change together with any changed command, option, or message.

## Releases and commits

- Conventional Commits; no AI attribution lines in commits.
- A release bumps `version` in `plugins/construct/.claude-plugin/plugin.json` in a `chore: release X.Y.Z` commit, and the PR title carries the version, e.g. `feat(delegation): ... (0.3.0)`.
- `main` is protected; work goes through a feature branch and PR. Commit, push, PR, and merge are the user's decisions.
- Technical artifacts are written in English.
