# Limits hook

Objective: a hook records the session limits in the plugin data directory when the main thread runs `construct-limits set`, so the limits live in one directory and the subagent rule no longer depends only on command text. Branch: feat/limits-hook (sub-branches feat/limits-hook-t<n>). Baseline: dd417c2. Test runner: node --test 'tests/**/*.test.mjs'; claude plugin test plugins/construct.

## Specs

- **S1 — The hook records the limits.** "Rediseño con hook (Recommended)" (L1): "a PreToolUse hook stores the main thread's `construct-limits set` in CLAUDE_PLUGIN_DATA (one directory, decision by agent_id)".
  - Given the main thread (no `agent_id`) runs a Bash command whose simple commands include `construct-limits set inline=<N> cap=<N>` (basename match at any path, as command-guard matches it) When the PreToolUse hook runs Then it validates the arguments with the same rules as today (whole numbers >= 0, keys `inline`/`cap`, clamps 500/10, a `set` of one key keeps the other) and writes them to `dataDir()/limits/<session_id>.json`, keyed by the hook input `session_id`, and returns `additionalContext` naming the active limits (`inline=<N> cap=<N>`).
  - Given invalid arguments When the hook runs Then nothing is written and the context says the set was rejected.
  - Given a subagent (`agent_id` present) When it runs `construct-limits set` Then the hook records nothing (command-guard keeps denying it).
  - Given `construct-limits show` from any agent When the hook runs Then it returns `additionalContext` with the active limits of the session.
- **S2 — One directory.** "Fixes the fallbackDir fail-open and the cross-directory set" (L1).
  - `readLimits` reads only `dataDir()`; no hook reads or creates the temp fallback directory for limits; `pruneState` prunes `limits` under `dataDir()` only.
  - The CLI no longer writes state: `set` validates and exits non-zero with a message on invalid input (exit 0 otherwise, printing the requested values); `show` prints that the hook reports the active limits in its context. Help text and docs say the hook records the values.
  - Assumption: a direct Write of the limits file by an agent stays possible (discipline layer, as documented).
- **S3 — Docs.** Assumption: README, CLAUDE.md (command hooks list and bin), session contract if it names how limits are stored, CHANGELOG Unreleased.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1, S2, S3 | `limits-record.mjs` PreToolUse hook (registered in exec form), shared argument parser in limits.mjs, CLI without writes, single-directory read and prune; tests and docs | worker | 2, 3 | done | 8386968 |

## Log

- **L1 (2026-10-28):** "Rediseño con hook (Recommended)" chosen in the menu after #105 merged; its description: "New feature before the release: a PreToolUse hook stores the main thread's `construct-limits set` in CLAUDE_PLUGIN_DATA (one directory, decision by agent_id). Fixes the fallbackDir fail-open and the cross-directory set. Then the 14.0.0 release."
- **L2 (2026-10-28):** T1 done: 1311/1311 tests, 98/98 mod tests. A `set` is recorded at PreToolUse, before the command runs, with the same validation as the CLI. `node bin/construct-limits set` (an interpreter wrapper) is not recorded; direct runs are.
- Next step: lenses on the cumulative diff, push, and the PR.
