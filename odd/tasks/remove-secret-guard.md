# Remove secret-guard

Objective: remove the `secret-guard` PreToolUse hook and every layer it runs (protected paths, catastrophic `rm -rf`, `command-guard` deny/ask tiers, `write-scope`, `test-lint`), so tool calls are never denied or prompted by construct for those reasons. Branch: `chore/remove-secret-guard`, baseline `8743462` (main, 1.4.0). Delivery strategy: ask-on-risk. Test runner: `node --test tests/`; `claude plugin validate --strict ./plugins/construct`; `claude plugin test plugins/construct`.

## Specs

Source: the user's "Quiero que esto se elimine quiero que mis flujo sea completamente autonomo" (L1) and the choice "Eliminar completamente" (L2).

- **S1 — No guard hook.** `hooks.json` has no PreToolUse entry for `Read|Edit|Write|MultiEdit|NotebookEdit|Grep|Glob|Bash` running `secret-guard.mjs`. Files `secret-guard.mjs`, `write-scope.mjs`, `test-lint.mjs` are deleted. Reading `.env`, writing to the repository from the main thread, `git push`, `rm -r`, and the other former deny/ask shapes produce no construct hook output.
- **S2 — Publication gate keeps working.** `publication-gate.mjs` imports `extractHeredocs`, `nestedLines`, `substitutionBodies` from `command-guard.mjs`. These helpers (and what they depend on, e.g. `headIndex` and the wrapper table) move to `shell-words.mjs`; `command-guard.mjs` is deleted. `tests/publication/**` stays green unchanged in behavior. Assumption: shared tokenizer code stays in `shell-words.mjs`; nothing is re-implemented.
- **S3 — Tests follow.** Test files that only exercise the removed layers are deleted. Mixed files (`tests/guard/audit-t1.test.mjs`, `tests/guard/wrapper-gaps.test.mjs`) keep their publication-gate and `shell-words` cases, relocated or retargeted; only guard-only cases go. A test asserts `hooks.json` registers no `secret-guard.mjs`.
- **S4 — Docs and contract follow.** README guard sections (`README.md` ~348-400, layout row ~434, publication-gate line ~325 mention of `command-guard`), `CLAUDE.md` command-hooks line, `hooks/contract/subagent.md` line 17 (the guard workaround), comments in `delegation-admission.mjs`, `shell-words.mjs`, `publication-gate.mjs` stop describing the removed hook. Historical `odd/tasks/*.md` logs are not rewritten.
- **Out of scope (named, not done):** the publication gate (RDD `git push` deny when review is due), delegation admission, and the contract prose that reserves commit/push/PR/merge to the user. They still limit autonomy; changing them is a separate decision.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1-S4 | Remove guard, move helpers, tests, docs | odd-worker | 2 | done, uncommitted | |
| T2 | S1-S3 | Independent verification | odd-verify | — | pending | |

## Log

- **L1 (2026-10-21, user):** "Quiero que esto se elimine quiero que mis flujo sea completamente autonomo, es decir lo mas parecido al modo bypass permision, se puede?"
- **L2 (2026-10-21, user):** "Eliminar completamente" (over: remove only the ask tier; make it configurable).
- **L3 (2026-10-21, mapping):** `publication-gate.mjs:22` imports three helpers from `command-guard.mjs`; `wrapper-gaps.test.mjs:9` imports `headIndex`. No skill, agent, or eval depends on the guard; `subagent.md:17` documents its workaround.
- **L4 (2026-10-21, progress):** T1 in the working tree: four scripts and nine `tests/guard/` files deleted; unwrapping helpers moved as-is to `shell-words.mjs` (now-dead `isRootOrHome` dropped); surviving cases in `tests/guard/shell-words.test.mjs`; hooks.json assertion RED 1 → GREEN. `node --test tests/`: 1136 tests, 1133 pass, 3 fail, all locking cases in `tests/review/invariants.test.mjs` that fail identically on baseline `8743462` (47/3, parent worktree check). `claude plugin test`: 161 pass. Both validates pass. README 1.4.0 release note still names secret-guard (history, kept).
- **L5 (2026-10-21, blocked):** The work-unit commit was denied by the Claude Code auto-mode classifier ("Security Weaken"). Not retried; waiting on the user. T2 (odd-verify) not started.
