# Oracle autonomy

Objective: locks no longer need a typed command: orphaned locks release themselves, and an agent can ask for an unlock that the user approves in the permission prompt. Branch: feat/oracle-autonomy (sub-branches feat/oracle-autonomy-t<n>). Baseline: 60536d3. Test runner: node --test 'tests/**/*.test.mjs'.

## Specs

- **S1 — Orphaned locks release themselves.** "Haz los das partes lan idea es que el flujo de desarrollo sea lo mas autonomo posible" (L2). A lock is released when its feature document was on the default branch (its history at the release ref touched the path) and is absent at the release ref now; a document that never reached the default branch keeps its lock. The gate applies this only with the release ref verified against the remote, like the finished-feature release.
- **S2 — Unlock on approval.** "Haz los das partes lan idea es que el flujo de desarrollo sea lo mas autonomo posible" (L2, L3). The main thread may run `construct-gate oracle unlock <path>` when the most recent AskUserQuestion answer in its session transcript chose an option labeled `Unlock` (case-insensitive) for a question that names that exact path; command-guard allows that command once. Without such an answer it denies, telling the agent to ask the user with AskUserQuestion (the question naming the path and the `oracle_conflict`, options `Unlock` and `Keep the test`). Subagents can never unlock. Assumption: the answer text in the transcript is written by the harness, not by the agent.
- **S3 — Docs.** "Haz los das partes lan idea es que el flujo de desarrollo sea lo mas autonomo posible" (L2). README, delegation skill (relay rule for `oracle_conflict`: the orchestrator may run the unlock and the user approves in the prompt), worker/oracle text where it says only the user may unlock, CHANGELOG.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1 | Orphaned-lock release in `activeLocks` | inline | 2, 3 | done | 5cf3903 |
| T3 | S1, S2 | Review fixes: literal pathspecs and a strict feature form for orphan release; exact backticked path; one shared path normalization; approvals recorded by a PostToolUse hook in the review store, not read from the transcript | worker | 2, 3 | done | 3cdd1bb |
| T4 | S2 | Second review fixes: agents cannot run the store-writing hook scripts; approvals bound to the session and expiring after 15 minutes; symlinked paths denied; unlock after a directory change denied | worker | 2, 3 | done | ee0a398 |
| T5 | S2 | Lone-command unlock on a plain file (no symlink), one live approval; replaces the per-case defenses | worker | 2, 3 | done | e62cd72 |
| T6 | S2 | The CLI releases a lock stored for a symlink path as typed, without following it (agents stay blocked by command-guard) | inline | 2 | done | 1690d90 |
| T2 | S2, S3 | command-guard allows an unlock the user approved through AskUserQuestion; docs | worker | 2, 3 | done | 56f406e |

## Log

- **L1 (2026-10-28):** "Ahora sobre ese punto de los candados hay algo que podamos hacer para que no sea explicito con comandos y que si sea algo que pueda decidir el orquestador o un agente"
- **L2 (2026-10-28):** "Haz los das partes lan idea es que el flujo de desarrollo sea lo mas autonomo posible" (part 1: orphaned locks release themselves; part 2: an agent's unlock asks the user in the permission prompt).
- **L3 (2026-10-28):** The docs do not say whether a hook `ask` prompts in `bypassPermissions` (the user's mode) and imply `dontAsk` denies it, so a permission-prompt design could either unlock silently or never reach the user. S2 uses an AskUserQuestion answer instead, which reaches the user in every mode.
- **L4 (2026-10-28):** Security review of T1/T2: glob pathspec in the orphan check; substring path match; cwd vs root normalization; an agent-writable transcript as the approval source. T3 fixes all four; the approval now comes from a PostToolUse hook on AskUserQuestion writing to the review store. Unverified: the AskUserQuestion PostToolUse `tool_response` shape (assumed equal to the transcript's `toolUseResult`); if it differs, approvals are not recorded and unlock stays denied (fail closed) until checked in a live session.
- **L5 (2026-10-28):** Second security review (T4): an agent could run unlock-approval.mjs itself to forge a record (HIGH); approvals had no session or expiry; symlinks and a directory change could make the approved path differ from the unlocked one. All fixed.
- **L6 (2026-10-28):** Third review round (same-line `ln -s && unlock`, `$VAR` paths, approval replay): T5 replaces case-by-case checks with one rule (the unlock is the whole command, on a plain file) and keeps one live approval. T6 restores the user's manual unlock of a symlink surface's own lock.
- Next step: review and the PR; after release, confirm one approval end to end.
