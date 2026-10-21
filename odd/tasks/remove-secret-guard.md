# Remove secret-guard

Objective: remove the `secret-guard` PreToolUse hook and every layer it runs (protected paths, catastrophic `rm -rf`, `command-guard` deny/ask tiers, `write-scope`, `test-lint`), so tool calls are never denied or prompted by construct for those reasons. Branch: `chore/remove-secret-guard`, baseline `8743462` (main, 1.4.0). Delivery strategy: ask-on-risk. Test runner: `node --test tests/`; `claude plugin validate --strict ./plugins/construct`; `claude plugin test plugins/construct`.

## Specs

Source: the user's "Quiero que esto se elimine quiero que mis flujo sea completamente autonomo" (L1) and the choice "Eliminar completamente" (L2).

- **S1 — No guard hook.** `hooks.json` has no PreToolUse entry for `Read|Edit|Write|MultiEdit|NotebookEdit|Grep|Glob|Bash` running `secret-guard.mjs`. Files `secret-guard.mjs`, `write-scope.mjs`, `test-lint.mjs` are deleted. Reading `.env`, writing to the repository from the main thread, `git push`, `rm -r`, and the other former deny/ask shapes produce no construct hook output.
- **S2 — Publication gate keeps working.** `publication-gate.mjs` imports `extractHeredocs`, `nestedLines`, `substitutionBodies` from `command-guard.mjs`. These helpers (and what they depend on, e.g. `headIndex` and the wrapper table) move to `shell-words.mjs`; `command-guard.mjs` is deleted. `tests/publication/**` stays green unchanged in behavior. Assumption: shared tokenizer code stays in `shell-words.mjs`; nothing is re-implemented.
- **S3 — Tests follow.** Test files that only exercise the removed layers are deleted. Mixed files (`tests/guard/audit-t1.test.mjs`, `tests/guard/wrapper-gaps.test.mjs`) keep their publication-gate and `shell-words` cases, relocated or retargeted; only guard-only cases go. A test asserts `hooks.json` registers no `secret-guard.mjs`.
- **S4 — Docs and contract follow.** README guard sections (`README.md` ~348-400, layout row ~434, publication-gate line ~325 mention of `command-guard`), `CLAUDE.md` command-hooks line, `hooks/contract/subagent.md` line 17 (the guard workaround), comments in `delegation-admission.mjs`, `shell-words.mjs`, `publication-gate.mjs` stop describing the removed hook. Historical `odd/tasks/*.md` logs are not rewritten.
- **S5 — Release 2.0.0.** Source: "dale a la release 2.0.0" (L9). Follow CONTRIBUTING "Releases" and mirror release commit `73180d5` (1.4.0): `plugin.json` version, `install.sh` `CONSTRUCT_REF` and header URL, README badge, install URLs, and current-version paragraph (naming the guard removal as breaking), `tests/install/install.test.mjs`. Branch `chore/release-2.0.0`; tag `v2.0.0` only after the user merges.
- **Out of scope (named, not done):** the publication gate (RDD `git push` deny when review is due), delegation admission, and the contract prose that reserves commit/push/PR/merge to the user. They still limit autonomy; changing them is a separate decision.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1-S4 | Remove guard, move helpers, tests, docs | odd-worker | 2 | done | `05365a2` |
| T2 | S1-S3 | Independent verification | odd-verify | — | done | |
| T3 | S5 | Release 2.0.0 | odd-worker | 5 | done | see L10 |

## Log

- **L1 (2026-10-21, user):** "Quiero que esto se elimine quiero que mis flujo sea completamente autonomo, es decir lo mas parecido al modo bypass permision, se puede?"
- **L2 (2026-10-21, user):** "Eliminar completamente" (over: remove only the ask tier; make it configurable).
- **L3 (2026-10-21, mapping):** `publication-gate.mjs:22` imports three helpers from `command-guard.mjs`; `wrapper-gaps.test.mjs:9` imports `headIndex`. No skill, agent, or eval depends on the guard; `subagent.md:17` documents its workaround.
- **L4 (2026-10-21, progress):** T1 in the working tree: four scripts and nine `tests/guard/` files deleted; unwrapping helpers moved as-is to `shell-words.mjs` (now-dead `isRootOrHome` dropped); surviving cases in `tests/guard/shell-words.test.mjs`; hooks.json assertion RED 1 → GREEN. `node --test tests/`: 1136 tests, 1133 pass, 3 fail, all locking cases in `tests/review/invariants.test.mjs` that fail identically on baseline `8743462` (47/3, parent worktree check). `claude plugin test`: 161 pass. Both validates pass. README 1.4.0 release note still names secret-guard (history, kept).
- **L5 (2026-10-21, blocked):** The work-unit commit was denied by the Claude Code auto-mode classifier ("Security Weaken"). Not retried; waiting on the user. T2 (odd-verify) not started.
- **L6 (2026-10-21, user):** "Puedes hacer el push por mi". Committed `05365a2` and pushed `chore/remove-secret-guard` to origin. The slice is 2,557 changed lines, almost all whole-file deletions, so it stays one commit. No PR opened.
- **L7 (2026-10-21, verify):** `odd-verify` on `05365a2`: S1-S4 pass, no blockers. Probes (`git push`, `rm -rf /`, `rm -r`, `git reset --hard`, Write) produce no decision from the remaining hooks; baseline answered ask/deny. Moved helpers are textually identical to baseline. Suite in an export: 1136/1136 (baseline 1301/1301; 165 fewer = deleted guard tests). Advisories: no version bump or release note yet for the BREAKING change; `nestedLines`/`extractHeredocs`/`substitutionBodies` have only end-to-end coverage (as on baseline); a stale worktree from another session at `3a13356` is still registered. Merge, release: user.
- **L8 (2026-10-21, user):** "Fusionado". Merged to main as `15826e4` (#29). Open: the 2.0.0 release (user).
- **L9 (2026-10-21, user):** "dale a la release 2.0.0". Branch `chore/release-2.0.0` from `15826e4`; S5 and T3 added.
- **L10 (2026-10-21, progress):** T3: version 2.0.0 in `plugin.json`, `install.sh` (`CONSTRUCT_REF`, header URL), README (badge, install URLs, marketplace pin, current-version paragraph, "Upgrading from 1.4.0" list), install test. `node --test tests/install/`: 30 pass; full suite 1133/1136 (same 3 baseline locking failures); both validates pass. RED not observed (test pin and sources changed in one call). Push, PR, merge, tag `v2.0.0`: user.
