---
name: plugin-evals
description: Rules of `claude plugin eval` (case layout, case.yaml and prompt.md fields, scaffold scripts, grader types, run isolation, tools and sandbox, ablation, scoring, cost, exit codes) for developing construct's evals in plugins/construct/evals/ and scripts/eval.sh. Use before adding or changing an eval case or grader, or when reading an eval result.
---

# Plugin evals in construct

Source (read 2026-10-23): <https://code.claude.com/docs/en/plugin-evals.md>. Requires Claude Code v2.1.269+. Evals spend real usage: every run and every judge call bills.

Construct today: cases in `plugins/construct/evals/<case>/` (`case.yaml` with `context.scaffold_script: fixture.sh`, `prompt.md`, `graders/*.md`, plus our own `outcome.sh`). `scripts/eval.sh` runs `claude plugin eval .` with `--scaffold --trust-plugin --keep-temp --runs 1 --model sonnet` and an explicit `--allow-tools` list, then writes `summary.json`.

## Case layout

- A directory is a case if it holds `prompt.md` and/or `case.yaml`; nest cases under a non-case directory to group them. Each case needs at least one grader (`invalid case.yaml` naming `graders` otherwise).
- `prompt.md`: the body is sent verbatim (`@path` is not expanded); unknown frontmatter keys are an error. Fields: `name`, `description`, `tags`, `plugins`, `runs` (default 3, 1–50), `expected_outcome`, `model`, `max_turns` (default 10, max 200; hitting it is a run error), `timeout_seconds` (default 300), `allowed_tools`, `append_system_prompt`, `env` (keys must match `EVAL_[A-Z0-9_]*`).
- `case.yaml`: `schema_version: "1.1"` and `name` required; the same fields under `execution:`; only here: `context.scaffold_script`, `context.history_file` (a `.jsonl`; the prompt becomes the next turn), `context.add_dirs`, inline `graders`. `prompt.md` frontmatter overrides `case.yaml`; `graders/*.md` are appended.
- `results/` is git-ignored (`evals/results/` in our `.gitignore`).

## Scaffold scripts (`fixture.sh`)

- Run **only with `--scaffold`**, as you, outside the sandbox, in the empty workspace, with `HOME` set to the run's temp home and no `EVAL_*` vars. Non-zero exit or > 120 s scores the run 0 (`scaffold failed`).
- Use them for files and git state only: any `.claude/`, `CLAUDE.md`, or `.mcp.json` they write is **not loaded**.
- Scaffolded files are invisible to `file_exists` and the `files` target.

## Graders (`graders/<name>.md`, frontmatter `type` + options, body = rubric or pattern)

| Type | Cost | Passes when |
| :- | :- | :- |
| `regex` (`pattern`, `flags`, `match: not_contains` or `"count:N"`, `target`) | free | JS regex found; use `flags: i`, not `(?i)` |
| `tool_used` (`tool`, `input_match`, `min`, `max`) | free | call count in range; `min: 0, max: 0` = never called |
| `tool_order` (`before`, `after`) | free | first `before` precedes first `after` |
| `file_exists` (`path` glob, `exists`) | free | a file **created during the run** matches |
| `llm` (`criteria` = body, `focus`) | ~3 judge calls per run | PASS in ≥ 2 of 3 votes |
| `baseline` (`baseline_file`, `criteria`) | ~3 judge calls per run | at least as good as a reference transcript |

- There are **no script graders**. Our `outcome.sh` is a construct convention run by `scripts/eval.sh`, outside `claude plugin eval` scoring.
- Targets: `last_message` (default), `trace` (JSON lines, quotes escaped as `\"`; `llm` sees only the first 12 and last 12 messages), `files` (created paths only, not contents), `{ source: file, path: <path> }` (contents), `mock_calls`.
- Common keys: `weight` (default 1), `arm: with-only | both`.
- Skill triggering: `tool_used` with `tool: Skill` and `input_match: '"skill"\s*:\s*"(?:[\w-]+:)?review"'`. Delegation: `tool_used` on `Agent` with an `input_match` on `construct:<role>` (inferred from the generic rules, not a documented recipe).

## What a run is

- A fresh `claude -p` child with **only the plugin** loaded: temp home, empty temp cwd, temp config. No user settings, hooks, CLAUDE.md, memory, skills, MCP, or other plugins. Managed policy still applies. The eval dir is unreadable to the agent.
- `claude -p` means **mods draw nothing**: the panel cannot be evaluated here (use `claude plugin test`). Mod event hooks and plugin command hooks do run, outside the sandbox, and can change graded files; treat scores as advisory.
- Permissions never prompt; ungranted tools are removed. `allowed_tools` grants only read-only tools (`Read`, `Glob`, `Grep`, `Skill`, `Agent`, `TodoWrite`, `Task*`, `AskUserQuestion`, ...). `Bash`, `Write`, `Edit`, `WebFetch`, `WebSearch` need `--allow-tools`, which applies to every case. Neither the case nor a skill's `allowed-tools` can widen grants.
- Any Bash grant runs under the OS sandbox: writes confined to the workspace, home and Claude config unreadable, network limited to `WebFetch(domain:…)` grants. No sandbox backend → Bash runs are refused.
- Git inside runs has hooks and credential helpers disabled (`GIT_CONFIG_COUNT`). That is why `scripts/probe-review.sh` exists for the review-fires path, and why our pre-push hook cannot be evaluated here.
- MCP: `--mocks record` (default) answers from mock files and never starts real servers.

## Scoring, ablation, cost

- Run score = weighted fraction of graders passed; case score = mean over runs; a case passes at `≥ --threshold` (default `1.0`).
- Default two arms (with plugin, without): 3 runs each, so 6 runs per case. `--ablation none` runs one arm. Baseline runs fail `Agent type 'construct:<role>' not found`, which is expected.
- In two-arm mode, `tool_used` on `Skill` and `arm: with-only` graders are not scored (indicators only), unless every grader is excluded or `arm: both`.
- Cost ≈ cases × runs × 2 + 3 judge calls per `llm`/`baseline` grader per run. `--max-cost-usd` is checked before each run starts; started runs finish, so spend can overshoot.
- `-j` 1–8 (shares the rate limit). `--case <glob>`, `--tag`, `--json [path]`, `--keep-temp`, `--output-dir`, `--no-publish`.

## Exit codes

`0` all cases at threshold; `1` a case below threshold, load failure, no cases, untrusted without `--trust-plugin`, API-error run (since v2.1.299); `2` partial (cost ceiling, rejected credential; JSON has `partial: true`); `130` interrupted; `143` terminated. `Δ` never affects the exit code.

## Before adding a case

- Prefer free graders (`tool_used`, `regex`, `tool_order`) over `llm`; use `llm` only for judgment no pattern can express.
- A case must fail without the behavior it covers: check that `Δ` is not near zero, or the case tests the base model, not construct.
- If a new case needs a tool, add it to the `--allow-tools` list in `scripts/eval.sh`; the case cannot grant it.
