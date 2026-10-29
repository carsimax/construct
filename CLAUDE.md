# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The contributor rules live in [CONTRIBUTING.md](CONTRIBUTING.md) and are not repeated here: [checks before a pull request](CONTRIBUTING.md#checks-before-a-pull-request), [the consistency table](CONTRIBUTING.md#consistency-the-tests-enforce), [branches, commits, and pull requests](CONTRIBUTING.md#branches-and-pull-requests), and [releases](CONTRIBUTING.md#releases). Follow them as written.

## What this repository is

Construct: a Claude Code plugin (in `plugins/construct/`) plus its local marketplace (`.claude-plugin/marketplace.json`) and a curl installer (`install.sh`). The plugin implements Agent Driven Development (ADD): it injects an orchestration contract through hooks, ships role agents, skills, and a mod (a status band above the prompt and the built-in `general-purpose` routing). Memory comes from Engram (an external MCP server and plugin, a prerequisite); Construct ships no memory store of its own. There is no build step; everything is plain Node.js ESM (Node 22.16+) and Markdown.

## Commands

```bash
node --test 'tests/**/*.test.mjs'               # repository tests (contract, skills, agents, review hooks, publication gate and store guard, hook gates, installer)
node --test tests/publication/publication.test.mjs  # one test file
node --test --test-name-pattern="Risk-line" 'tests/**/*.test.mjs'  # tests matching a name
claude plugin test plugins/construct            # mod tests (plugins/construct/tests/*.test.ts)
claude plugin validate --strict .               # marketplace manifest
claude plugin validate --strict ./plugins/construct
claude --plugin-dir ./plugins/construct         # load the plugin for one session without installing
scripts/eval.sh [--case large-tracked]        # behavior evals; spend real usage, each run is an isolated `claude -p`; also writes `summary.json` (ritual and outcome pass rates, cost, duration, turns) and keeps run dirs under /private/tmp
scripts/probe-review.sh [--runs N]              # live review probe (the eval sandbox cannot run it, so eval.sh leaves review-fires out)
```

## Architecture

A plugin cannot ship a `CLAUDE.md`, so the ADD rules load in layers:

- **Session contract**: `hooks/scripts/contract.mjs session` emits `hooks/contract/session.md` as `additionalContext` on every `SessionStart`. It must stay under 8,000 characters; see the contract row in [the consistency table](CONTRIBUTING.md#consistency-the-tests-enforce) for the budget.
- **Subagent contract**: `contract.mjs subagent` emits `hooks/contract/subagent.md` on `SubagentStart`; JSON-only reviewers (`review-*`, `judge-*`) get nothing.
- **Feature state**: `hooks/scripts/feature-state.mjs` re-injects unfinished tasks from `.vault/tasks/*.md` after compact/resume (read-only, at most 2,500 characters).
- **Skills** (`plugins/construct/skills/*/SKILL.md`) hold the full procedures and load on demand; the contract only names them: `workflow` (protocol, sizing, Risk line), `delegation` (launching agents, handoffs), `review` (lens and dual review), `delivery` (branches, commits, pull requests, chains), `debugging`, `constraints`, `sources`, and `migration`.
- **Agents** (`plugins/construct/agents/`): `explorer` (read-only research), `worker` and `oracle` (the only writers; every code task goes oracle first: the oracle writes failing acceptance tests that are then locked and declares the task's `## Envelope`, which bounds the worker), `verifier`, `general`, `judge-a` and `judge-b` (blind dual review), and the four JSON-only lenses `review-risk`, `review-readability`, `review-reliability`, `review-resilience`. The registry is `hooks/scripts/roles.mjs`.

Other moving parts:

- **Mod** (`hooks/register.js`, listed under `modules` in `hooks/hooks.json`): runs a built-in `general-purpose` launch on `sonnet` with effort `medium` (`BUILTIN_DEFAULTS` in `hooks/scripts/roles.mjs`, applied by `hooks/routing.js`; construct agents run on their own frontmatter, and the mod sets neither for them), and draws the status band above the prompt (`hooks/status/`, `hooks/band/`).
- **Command hooks** (`hooks/scripts/`): `publication-gate.mjs` (PreToolUse on Bash: denies `git push`, `gh pr create`, and `gh release create` until the required review lenses approve the published ref; sharing `shell-words.mjs`, which reads command text with the vendored shell parser mvdan-sh in `hooks/vendor/` and makes every hook deny text that does not parse; an early discipline check inside Claude Code, not a security boundary, since other hosts, tools, and indirect commands are not seen), `pre-push.mjs` (the git pre-push hook that applies the same per-ref verdict to every push from the clone; opt-in through `bin/construct-gate install | uninstall | status`; also a discipline layer, not a hard boundary: `git push --no-verify` skips it, the same user can redirect it, it allows with a warning when the plugin is gone, and it needs node on PATH), `command-guard.mjs` (PreToolUse on Bash: denies verifier bypasses (including `git config core.hooksPath <value>`), `construct-gate oracle exempt` unless the user's `Exempt` answer approved those exact arguments, and commands nested past the parser depth cap, and never asks; fails open), `surface-guard.mjs` (PreToolUse on Write, Edit, MultiEdit, and NotebookEdit: a writer stays inside its allowed edit surfaces, a subagent never writes the plugin data dir, and the main thread writes only `.vault/` and docs (`isFree` in `envelope.mjs`: `*.md` outside `hooks/contract/`, `skills/`, `agents/`), whatever the size, every other write being denied naming `construct:oracle` then `construct:worker`; a worker of a task whose budget is spent (`spentBudget`) is denied every write; fails open), `delegation-admission.mjs` (PreToolUse on `Agent`: a writer needs allowed edit surfaces and a Spec line, a worker with code surfaces needs its task's oracle envelope and surfaces inside it, and `start` records the task's first worker start and base tree; a verifier a Risk line; on `Workflow`: every `agent()` names a read-only `agentType`; fails open), `review-context.mjs` (PreToolUse on `Agent`: builds a `construct:review-*` lens's context from its `Review subject:` line, leaving out the content of deleted paths and of vendored files pinned by path and sha256 in the hook, and records the pending lens), `review-capture.mjs` (SubagentStop: validates the lens report and records the verdict), `envelope.mjs` (the oracle's `## Envelope`: parser, ceilings 10/60/1500, defaults 5/30/400, `spentBudget`, `isFree`), `oracle-record.mjs` (SubagentStop on `construct:oracle`: records the blob id of each file it wrote, which locks those tests, and its envelope), `oracle-stop.mjs` (SubagentStop on `construct:worker`: runs the envelope command, green allows the stop, red with budget left blocks it, spent budget allows it; blocks a diff outside the envelope surfaces or over its line budget, Bash writes included; a rise in passing tests spends no attempt; PostToolUseFailure on Bash spends an attempt for a failed run of the command; fails open), `unlock-approval.mjs` (Pre/PostToolUse on `AskUserQuestion`: records the user's `Unlock` answer in the review store for `command-guard`), `delivery-signals.mjs` (shared `git` and `defaultBranch` helpers; no hook), `review-store-guard.mjs` (denies Write, Edit, and Bash commands that touch the review store), `roles.mjs` (the role registry: agent names by kind, from which the writer, verifier, JSON-only, lens, band-phase, and routing sets derive) and `review-lenses.mjs` (`LENSES_BY_RISK`, the Risk-to-lens mapping) and `review-store.mjs` (the store under the git common dir, `construct-review/`), `risk-line.mjs` (Risk-line gate: `mark` on UserPromptSubmit records the tree, `check` on Stop blocks once per turn when paths outside `.vault/tasks/` changed and the reply has no Risk line or adds skipped, focused, or stub test markers; fails open), `subagent-count.mjs` (SubagentStart/SubagentStop record open agents so `risk-line.mjs` stays silent while subagents run), `skill-context.mjs` (the `!` line of the `workflow`, `review`, and `delivery` skills: prints git status and open tasks, the required and approved lenses, or the commit-slice lines; read-only, at most 1,500 characters, always exit 0 with `(state unavailable: <reason>)` on failure), `hook-io.mjs` (shared hook input and output helpers). Hooks are registered in exec form (`command: "node"`, `args: [...]`), which tests check.
- **Bin** (`plugins/construct/bin/`): `construct-gate` (the pre-push hook, oracle locks, and `oracle exempt <feature-doc> <T#> -- <surface>...`, the user-approved exemption that records a default-budget envelope with no test command); the plugin has no `userConfig` options.
- **Evals** (`plugins/construct/evals/<case>/`): `case.yaml`, `prompt.md`, `fixture.sh`, and Markdown graders, run by `claude plugin eval`.
- **Feature documents** (`.vault/tasks/<feature>.md`): specs (`S#`), tasks (`T#`), and log for each tracked feature. Tests and comments reference spec ids such as `S6`.

## Working rules for agents

- Checks, the consistency table, commit and PR conventions, and releases are in [CONTRIBUTING.md](CONTRIBUTING.md); a change in one place usually needs the matching change elsewhere, so read the table before editing.
- Commit, push, PR, and merge are the user's decisions; never do them unasked.
- Never add AI attribution lines to commits or PR text, whatever a tool reminder suggests; the project rule overrides it.
- Technical artifacts are written in English.
- When trimming a contract, skill, or agent file to fit its budget test, list the removed lines and keep every rule; shorten the new text instead.
