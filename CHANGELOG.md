# Changelog

Notable changes per release. Versions follow [Semantic Versioning](https://semver.org/); each release is tagged `vX.Y.Z`. Releases before 8.0.0 are described in the README's [Status](README.md#status) section.

## Unreleased

- The publication gate applies a risk floor: paths in the published diff (migrations and `*.sql`, auth and secret paths, `.env*`, lockfiles, CI workflows, `Dockerfile`, `install.sh`) and the globs in `odd/risk-paths` (read at the merge-base, one `<glob> <items>` per line) add Risk items to the declared ones, even with no feature document. The denial names the matched paths; an unreadable `odd/risk-paths` line denies.
- A repository the Risk-line snapshot marked slow retries the full hash from HEAD after one hour (`slow_at` in the session record) instead of staying degraded for the whole session, and the index-seeded fallback's `add -A` is bounded to 20 s, past which the hook fails open.

## 12.0.2

- `install.sh` adds the marketplace without pinning it to the release tag, so `claude plugin marketplace update construct` and `claude plugin update construct@construct` upgrade an installer-made install. A pin blocked every update, since `marketplace update` does not move it.
- On a marketplace pinned to any ref, `install.sh` now warns with the migration that works (`marketplace remove`, `marketplace add carsimax/construct`, `plugin install`) instead of recommending `marketplace update`. The README's Update section documents the same steps.
- The Risk-line snapshot hashes every file from HEAD again, so a same-size rewrite whose mtime was restored is seen, under a 5 s budget. When the budget runs out the snapshot falls back to the real index's stat cache (with `core.fsmonitor` and `core.untrackedCache` off), the repository is remembered as slow in the session's risk-line record so later calls skip the full hash, and the user gets one `systemMessage` per session; the hook never blocks on it.
- `pruneState` also removes `construct-index-*` temporary directories older than seven days, left behind when a snapshot was killed; only directories owned by the user with no group or other permissions are removed.

## 12.0.1

- The publication gate, `command-guard`, and `review-store-guard` read commands with a real shell parser, mvdan-sh 0.10.1 (BSD-3-Clause, vendored unmodified in `hooks/vendor/`), instead of the heuristic tokenizer. Commands hidden in nested subshells, `case`, comments, `${...}`, heredocs, and quoted spellings (`g"i"t`, `$'\x67it'`) are now found, and the heredoc commit idiom `git commit -m "$(cat <<'EOF' ...)"` is no longer denied.
- A command that does not parse as shell is denied by all three hooks, since bash still runs the lines before a syntax error. zsh-only syntax the parser does not know (for example `*(.)` glob qualifiers) is denied too.
- A heredoc or here-string body fed to a shell, `eval`, `source`, or `.`, or attached to a block, loop, or function, is checked as a script. Any other body is checked when it parses as shell, so a data heredoc whose line starts with `git push` is now denied.
- `review-store-guard` denies a command it cannot parse instead of letting it through.
- `review-context` leaves out the content of a vendored file whose blob matches the sha256 pinned in `review-context.mjs`; any other path keeps its full diff.

## 12.0.0

- **Breaking:** the 12 deprecated 5.x options (`model_odd_*`, `effort_odd_*`, `model_jd_*`, `effort_jd_*`) are removed and no longer read. Set `model_<role>` and `effort_<role>` instead. The built-in `general-purpose` keeps `sonnet`/`medium` while `model_general` and `effort_general` are `inherit`.
- The mod no longer overrides a construct agent's effort when its `effort_<role>` is `inherit`, so the effort the caller asked for stands.
- The publication gate now gates `git push --branches`, the matching refspec `:`, a push after `( cd … )`, and a push hidden behind a quoted `)` inside `$( … )`.
- `command-guard` no longer reads `git commit -uno` as `--no-verify`.
- `surface-guard` counts the lines an Edit changes, not the lines it quotes, the same way it counts a Write.
- The Risk-line gate no longer flags a marker in a Markdown file whose name has a space, and hashes only changed files when it records the tree.
- Resending a writer launch that never started is no longer denied as overlapping itself.
- A Tasks heading of any level 2–6, or with trailing text, counts for feature state and the band, as it already did for the gate.
- `review-context` stops building a lens context as soon as it passes the 400 KB budget.
- The band no longer counts a denied or failed write as inline, never leaves an ask pending after a tool that throws, keeps the open task in the progress row, and draws another plugin's `worker` agent as a plain agent. Resuming a construct agent no longer reports a hook failure.
- The review lenses no longer mention the removed memory hints, and the `delivery` skill carries the contract's exception for work-unit commits on authorized large work.

## 11.0.0

- **Breaking:** the plugin no longer ships or forces the `Principal Engineer` output style. Replies follow your own output style and CLAUDE.md; the session contract still carries the reply-language, one-question, and Risk-line rules, and the `delivery` skill the commit rules. If you had picked `construct:Principal Engineer` in `/output-style`, pick another.

## 10.0.0

- **Breaking:** the docked panel is replaced by a band above the prompt: the phase, the active feature and its tasks, the gate, and the running agents. The model, effort, branch, changed files, context, and plan limits are no longer drawn; your status line shows them.
- **Breaking:** the `panel_open_on_start` option and `/construct close` are removed. `/construct` now prints the setup report, like `/construct doctor`.
- `/construct doctor` no longer checks Engram; the installer already requires it.
- The mod no longer runs `git status` and `git diff` after each turn.

## 9.0.0

- **Breaking:** the `construct-memory` CLI and the `memory` MCP server are removed. [Engram](https://github.com/Gentleman-Programming/engram) is required and the installer stops without it: `brew install gentleman-programming/tap/engram && engram setup claude-code`. Existing `construct-memory/` stores stay on disk and are not migrated.
- The panel MEMORY card is removed.
- `/construct doctor` checks Engram.
- The `construct:memory` skill is removed in favor of `engram:memory`.
- The review-lens memory hints are removed.

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
