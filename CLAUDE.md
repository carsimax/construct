# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The contributor rules live in [CONTRIBUTING.md](CONTRIBUTING.md) and are not repeated here: [checks before a pull request](CONTRIBUTING.md#checks-before-a-pull-request), [the consistency table](CONTRIBUTING.md#consistency-the-tests-enforce), [branches, commits, and pull requests](CONTRIBUTING.md#branches-and-pull-requests), and [releases](CONTRIBUTING.md#releases). Follow them as written.

## What this repository is

Construct: a Claude Code plugin (in `plugins/construct/`) plus its local marketplace (`.claude-plugin/marketplace.json`) and a curl installer (`install.sh`). The plugin implements Organic Driven Development (ODD): it injects an orchestration contract through hooks, ships role agents, skills, a mod (model/effort routing and a status panel), and an output style. Memory is built in (`construct-memory`, a per-repository SQLite store), with no external plugin. There is no build step; everything is plain Node.js ESM (Node 22.16+) and Markdown.

## Commands

```bash
node --test tests/                              # repository tests (contract, skills, agents, review hooks, publication gate and store guard, hook gates, installer)
node --test tests/publication/publication.test.mjs  # one test file
node --test --test-name-pattern="Risk-line" tests/   # tests matching a name
claude plugin test plugins/construct            # mod tests (plugins/construct/tests/*.test.ts)
claude plugin validate --strict .               # marketplace manifest
claude plugin validate --strict ./plugins/construct
claude --plugin-dir ./plugins/construct         # load the plugin for one session without installing
scripts/eval.sh [--case small-delegated]        # behavior evals; spend real usage, each run is an isolated `claude -p`
```

## Architecture

A plugin cannot ship a `CLAUDE.md`, so the ODD rules load in layers:

- **Session contract**: `hooks/scripts/contract.mjs session` emits `hooks/contract/session.md` as `additionalContext` on every `SessionStart`. It must stay under 8,000 characters; see the contract row in [the consistency table](CONTRIBUTING.md#consistency-the-tests-enforce) for the budget.
- **Subagent contract**: `contract.mjs subagent` emits `hooks/contract/subagent.md` on `SubagentStart`; JSON-only reviewers (`review-*`, `judge-*`) get nothing.
- **Feature state**: `hooks/scripts/feature-state.mjs` re-injects unfinished tasks from `odd/tasks/*.md` after compact/resume (read-only, at most 2,500 characters).
- **Skills** (`plugins/construct/skills/*/SKILL.md`) hold the full procedures and load on demand; the contract only names them.
- **Output style**: `output-styles/principal-engineer.md`, forced with `force-for-plugin`.

Other moving parts:

- **Mod** (`hooks/register.js`, listed under `modules` in `hooks/hooks.json`): routes each agent role's model and effort from the plugin's `userConfig` (`model_<role>`, `effort_<role>`, where role is the agent name with dashes turned into underscores; see `hooks/routing.js`), and renders the status panel (`hooks/status/`, `hooks/panel/`). Agent frontmatter is the fallback when the mod cannot run.
- **Command hooks** (`hooks/scripts/`): `publication-gate.mjs` (PreToolUse on Bash: denies `git push`, `gh pr create`, and `gh release create` until the required review lenses approve the published ref; sharing `shell-words.mjs`), `command-guard.mjs` (PreToolUse on Bash: denies verifier bypasses, asks before destructive commands; fails open), `surface-guard.mjs` (PreToolUse on Write, Edit, MultiEdit, and NotebookEdit: a writer stays inside its allowed edit surfaces and the main thread writes only `odd/tasks/`; fails open), `review-context.mjs` (PreToolUse on `Agent`: builds a `construct:review-*` lens's context from its `Review subject:` line and records the pending lens), `review-capture.mjs` (SubagentStop: validates the lens report and records the verdict), `review-store-guard.mjs` (denies Write, Edit, and Bash commands that touch the review store), `roles.mjs` (the role registry: agent names by kind, from which the writer, verifier, JSON-only, lens, panel-phase, and routing sets derive) and `review-lenses.mjs` (`LENSES_BY_RISK`, the Risk-to-lens mapping) and `review-store.mjs` (the store under the git common dir, `construct-review/`), `risk-line.mjs` (Risk-line gate: `mark` on UserPromptSubmit records the tree, `check` on Stop blocks once per turn when paths outside `odd/tasks/` changed and the reply has no Risk line or adds skipped, focused, or stub test markers; fails open), `subagent-count.mjs` (SubagentStart/SubagentStop record open agents so `risk-line.mjs` stays silent while subagents run), `failure-streak.mjs` (PostToolUseFailure: the 5th failure of one tool by one agent within 10 minutes adds a change-strategy note; fails open), `memory-store.mjs` (the per-repository SQLite memory under the git common dir, `construct-memory/`, behind `bin/construct-memory`) and `memory-hooks.mjs` (SessionStart context, UserPromptSubmit prompt capture, SubagentStop passive learnings), all sharing `hook-io.mjs`. Hooks are registered in exec form (`command: "node"`, `args: [...]`), which tests check.
- **Evals** (`plugins/construct/evals/<case>/`): `case.yaml`, `prompt.md`, `fixture.sh`, and Markdown graders, run by `claude plugin eval`.
- **Feature documents** (`odd/tasks/<feature>.md`): specs (`S#`), tasks (`T#`), and log for each tracked feature. Tests and comments reference spec ids such as `S6`.

## Working rules for agents

- Checks, the consistency table, commit and PR conventions, and releases are in [CONTRIBUTING.md](CONTRIBUTING.md); a change in one place usually needs the matching change elsewhere, so read the table before editing.
- Commit, push, PR, and merge are the user's decisions; never do them unasked.
- Never add AI attribution lines to commits or PR text, whatever a tool reminder suggests; the project rule overrides it.
- Technical artifacts are written in English.
