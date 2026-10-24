# Changelog

Notable changes per release. Versions follow [Semantic Versioning](https://semver.org/); each release is tagged `vX.Y.Z`. Releases before 8.0.0 are described in the README's [Status](README.md#status) section.

## Unreleased

## 8.7.0

- New option `slice_lines` (default `1500`, was a fixed 400): the commit-slice budget that delivery-signals reports against.
- `inline_edit_max_lines` now defaults to `150` (was `20`); set it to `20` to keep the old limit.
- CI runs the repository tests, the mod tests, and both manifest validations on every pull request.
- `SECURITY.md`, issue forms, and a pull request template.
- This changelog.

## 8.6.1

- Memory through the MCP tools first: the session contract, the SessionStart Memory line, and the skills tell Claude to recall with `mem_search` and save with `mem_save` (loading a deferred tool through tool search), and to use the `construct-memory` CLI only when a tool is missing or fails. `construct:explorer` keeps the CLI. In live runs, 10 of 10 recall, save, and subagent prompts used the tools first, against 1 of 3 recall prompts on 8.6.0.

## 8.6.0

- The read counter and `construct-memory review passive`.
- Passive learnings stay out of relation candidates, and more harness notices stay out of stored prompts.
- A hardened memory MCP server.

## 8.5.0

- The plugin's own memory MCP server, `memory`, with ten engram-style `mem_*` tools over the `construct-memory` CLI.

## 8.4.0

- Memory closer to engram: passive learnings load apart and rank lower, near-duplicate learnings are skipped, harness notices are not stored as prompts, a `SessionEnd` hook closes the session, and `construct-memory relations pending` lists unjudged candidates.

## 8.3.0

- `delegation-admission` also runs on `PreToolUse` for `Workflow`: a workflow script is admitted only when every `agent()` call names a literal read-only `agentType`, so writes go through `construct:worker` with the `Agent` tool.

## 8.2.0

- The `workflow`, `review`, and `delivery` skills load the repository's real state (`hooks/scripts/skill-context.mjs`).
- The commit slice runs only on Bash `git` calls, and the context backstop once per tool batch (`PostToolBatch`).
- `construct:explorer` is capped at 30 turns and `construct:verifier` at 50.
- `delegation`, `review`, and `workflow` are model-only skills.

## 8.1.0

- `construct-gate install | uninstall | status`: an opt-in git pre-push hook that applies the publication gate's verdict to every push from the clone.
- The README states what each gate layer guarantees.

## 8.0.0

- Breaking: the main thread makes small inline edits (up to `inline_edit_max_lines` lines per call, default 20; `0` restores the 7.x rule). See the README's "Upgrading to 8.0".
- `scripts/eval.sh` writes `summary.json` (pass rates, cost, duration, turns).
- The `small-delegated*` evals are renamed `small-inline*`, and each eval case can ship an `outcome.sh` that checks the result in a clean directory.
