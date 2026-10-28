# Changelog

Notable changes per release. Versions follow [Semantic Versioning](https://semver.org/); each release is tagged `vX.Y.Z`. Releases before 8.0.0 are described in the README's [Status](README.md#status) section.

## Unreleased

- **Breaking:** the per-repository folder `odd/` is replaced by `.vault/`, with container folders `tasks/` (feature documents), `specs/` (`README.md` with the purpose and `Started: <YYYY-MM-DD>`, plus one living-spec file `<feature>.md` per finished feature; a feature that changes earlier behavior edits that feature's file) and `risk-paths/` (rule files, each line `<glob> <items>`, all files combined). Nothing reads `odd/` any more; an existing `odd/` folder stays on disk untouched. Migration (a file cannot move into a folder of the same name, so `risk-paths` goes through a temporary name): `git mv odd .vault && git mv .vault/risk-paths .vault/rules.txt && mkdir .vault/specs .vault/risk-paths && git mv .vault/spec.md .vault/specs/README.md && git mv .vault/rules.txt .vault/risk-paths/rules.txt`. Skip the `risk-paths` and `spec.md` moves for a file you do not have. Until a repository moves, the publication gate (and the pre-push hook) deny publishing a ref that keeps `odd/tasks/` or `odd/risk-paths` without a `.vault/` folder, naming these commands, so the change never weakens review silently. While the default branch has not migrated, the risk floor of the migration push still comes from its `odd/risk-paths`, so adding `.vault/` cannot lower it.
- The methodology is renamed from Organic Driven Development (ODD) to Agent Driven Development (ADD) in the skills, agents, contracts, and documentation. The internal `ODD_REVIEW_*` markers are unchanged.

## 12.3.0

- Living spec: the publication gate denies a ref whose feature document has a `done` task naming an `S#` still marked `NEEDS CLARIFICATION: <question>`. `feature-state.mjs` lists each active document's open clarifications (warning above 3), warns on specs with no quote found in the `## Log` and no `Assumption`, and warns when a finished document with `## Specs` has no `## <feature>` heading in `odd/spec.md` (skipped when `odd/spec.md` is missing or the document's L1 date is before its `Started:` line).

## 12.2.0

- The `delivery` skill describes one model for large work: a feature branch `feat/<feature>`, a local sub-branch `feat/<feature>-t<n>` per task or cohesive group (split by work unit, never by line count) merged with `git merge --no-ff`, and one final pull request that the publication gate reviews cumulatively. Sub-branches are never pushed. The delivery strategies (`ask-on-risk`, `auto-chain`, `single-pr`, `exception-ok`), the chain shapes, and `size:exception` are removed, as is `Delivery strategy` from the feature-document header; `references/chains.md` is now the sub-branch reference. Limit: a feature whose whole diff passes the 400 KB review-context budget cannot publish in one PR.
- The commit-slice notice is removed: `delivery-signals.mjs` no longer reports the authored changed lines after a `git commit` (its `post` hook registration is gone), and the `slice_lines` option is removed from `plugin.json`, so a `slice_lines` value users had set is now ignored. The context backstop (`delivery-signals.mjs batch`) is unchanged. The `delivery` skill's state line now shows the feature branch (`feat/<feature>`, or the parent of a sub-branch `feat/<feature>-t<n>`), the current sub-branch, and the local sub-branches merged or unmerged into the feature branch.
- Eval results are recorded in `docs/evals/results.md`: the 12.0.2 baseline, the run after ADD P4, and a three-run check showing that the single-run large-tracked and review-fires gains were noise.
- The iteration cap counts consecutive failures: a passing run of a command resets its count. `hooks.json` registers `iteration-cap.mjs` on `PostToolUse` (Bash) too, and a test checks all five registrations.
- New hook `iteration-cap.mjs` and option `iteration_cap` (default 3, `0` turns it off): a Bash command that already failed that many times for one agent in one session is denied with an instruction to stop and report what it tried, the failure, and its hypothesis, and never to edit the test to pass. A subagent's counts end when it stops; the main thread's reset on the next user prompt. Fails open.

## 12.1.0

- Oracle flow documented and closed: `construct:worker` returns the new status `oracle_conflict` (report path, test, the `S#` it contradicts, why) instead of editing, skipping, or weakening a locked oracle; the `workflow` (testing reference), `delegation` (an `## Oracle` handoff and the relay rule: the user decides, never unlocked for them), and `review` skills, and the session and subagent contracts describe oracle-first work, locks, and the conflict exit; METHODOLOGY principle 4 records what exists and its accepted limits. `review-context` writes feature document paths and lock fields (`path`, `feature`, `task`, `error`) as JSON strings so none can start a line like a hook marker.
- The review lenses see the branch's specs and locked oracles: `review-context` adds the `## Specs` section of each feature document the reviewed diff adds or changes (read from HEAD, at most 4,000 characters, truncated with a marker naming the document; findings outside the specs are follow-ups, not blockers) and lists the active oracle locks (offline) whose path or feature document is in the diff, where a change to one is a finding; the subject hash and path manifest are unchanged. The `review` skill's state line adds `Oracle locks: <n> active (<up to 3 paths>)` when any lock is active.
- Oracle lock hardening: a lock whose release state cannot be read is kept as active and marked `error` (shown by `construct-gate oracle list` with the message) while the other locks are judged normally, so the gate denies only refs that carry its path, not every publication. `delegation-admission` no longer fails open on a lock-check error: every recorded lock counts as active, and the Spec-line and surface checks still run. `command-guard` always denies `git update-ref`, `git symbolic-ref`, and `git remote set-head` on `refs/remotes/`, and a `git fetch` refspec whose destination is under `refs/remotes/`, because the gate trusts `origin/HEAD`, `origin/main`, and `origin/master` as the release ref; plain `git fetch` and `git pull` stay allowed. That deny list is a discipline layer, not the enforcement: the publication gate verifies the release ref against the remote URL pinned in the lock (`oracle-record` stores `remote.origin.url`; one `git ls-remote` per gate run, with a timeout) before releasing a lock, and keeps the lock when the remote is unreachable, reports another sha, or the lock has no recorded URL; `surface-guard`, admission, and the CLI stay offline. `activeLocks` no longer throws: when the release ref cannot be read every lock stays active with `error`, so `oracle-record` still records and `oracle list` still lists.
- Locked oracles stop early: `surface-guard` denies editing an actively locked oracle from any agent or the main thread (the message names `oracle_conflict` and the unlock command), `delegation-admission` denies a writer whose surfaces cover one and an oracle launched over one, and a new oracle run replaces a lock whose feature is finished. `construct-gate oracle list | unlock <path>` lists and releases locks; `command-guard` denies `oracle unlock` to agents however it is wrapped (`node` flags, `env`, `command`, `xargs`, `npx`). A symlink or directory surface is locked with an always-changed marker, a corrupt lock record is skipped by the gate (and listed as corrupt), and the always-changed marker denies only a ref that carries the path, and the gate reads each feature document once per feature.
- New agent `construct:oracle` (opus, medium; `model_oracle` and `effort_oracle`) writes acceptance tests from the `S#` of a feature document and shows them failing; it never implements. It is a writer role, so admission needs a Spec line (always, even with no unfinished feature document) and surfaces, and its surfaces must be exact file paths (a glob or a directory is denied). When an oracle stops, `oracle-record.mjs` locks the git blob id of each of its files in the review store (`oracles/`), and a later run never replaces an existing lock. The publication gate then denies a push, pull request, or release whose ref changes or deletes a locked oracle, unless the feature document on the remote-tracking default branch (`origin/HEAD`, `origin/main`, or `origin/master`; never a `--base` or a local branch, and with none the lock stays) has no unfinished task (the document at the ref is never read) or the ref never carried the oracle; a git error while checking the history denies; it never requires an oracle to exist.
- The publication gate applies a risk floor: paths in the published diff (migrations and `*.sql`, auth and secret paths, `.env*`, lockfiles, CI workflows, `Dockerfile`, `install.sh`) and the globs in `odd/risk-paths` (read at the merge-base and the default branch tip, one `<glob> <items>` per line) add Risk items to the declared ones, even with no feature document. Globs match case-insensitively. The denial names the matched paths; an unreadable `odd/risk-paths` line denies.
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
