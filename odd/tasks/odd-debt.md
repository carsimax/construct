# ODD debt cleanup

Objective: close the follow-ups left in earlier feature documents that still apply on `main`. Branch: `fix/odd-debt`, baseline `6a32414` (main). Delivery strategy: ask-on-risk. Test runner: `node --test tests/`; `claude plugin test plugins/construct`; `claude plugin validate --strict ./plugins/construct`.

## Specs

- **S1 — Dead panel code.** Source: "`activeFeature` (`status/tasks.js`) and `buildBand`/`oddLine` (`status/format.js`) are no longer reached by production code and survive only because tests assert them" (`odd/tasks/construct-panel.md` L9). Remove the functions no production path reaches, and the tests that only assert them; keep anything production still calls (check every caller, including `hooks/register.js` and `hooks/panel/`). Behavior of the panel unchanged.
- **S2 — Honest CodeGraph notice.** Source: "the 'indexing started' notice is issued even if init later fails (e.g. refuses `$HOME`), and repeats on resume/clear/compact" (`odd/tasks/codegraph-integration.md` L7 advisory 4). With auto-index on, the hook launches `codegraph init` only when the SessionStart `source` is `startup`; on `resume`, `clear`, or `compact` with the index still missing it gives the manual notice, which then also says an earlier automatic init may have failed. The launch notice says the launch was requested, not that indexing started, and names `codegraph status` as the check. Assumption: a missing `source` counts as `startup`.
- **S3 — Installer edge cases.** Source: "a read-only `~/.claude` passes preflight and fails at the merge with a raw stack trace; an empty `settings.json` is treated as invalid" (`odd/tasks/curl-installer.md` L7). Preflight fails with one clear message when `~/.claude` (or the settings file) is not writable, before any change. An empty or whitespace-only `settings.json` is treated as `{}`.
- **S4 — Review hook ambiguity.** Source: "a prompt naming two lineages uses the first; two spawns of the same lens in one session share one pending record" (`odd/tasks/review-determinism.md` L8). `review-context.mjs` denies a `construct:review-*` spawn whose prompt names two or more distinct lineages, with a message to name one. The second half (deny a second spawn of the same lens while a pending record exists) is dropped (L5): a lens that stops without a reply, or a spawn declined after the hook allowed it, leaves the record behind, so the deny would block the relaunch `rdd-review` prescribes for up to six hours; the shared-record case only makes the later capture count as already captured.
- **S5 — Release.** Source: the refactor in PR #12 never reached installs because "`claude plugin update` only fetches on a version bump". After S1-S4, `plugin.json` version 0.7.1 in a `chore: release 0.7.1` commit.

User request for all specs: "Podemos seguir con los pendientes que tenemos?"

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1 | `hooks/status/format.js`, `hooks/status/tasks.js`, mod tests | odd-worker, parallel | none | done | `0767802` |
| T2 | S2 | `hooks/scripts/contract.mjs`, `tests/contract.test.mjs`, README | odd-worker, parallel | none | done | `80867e1` |
| T3 | S3 | `install.sh`, `tests/install/`, README | odd-worker, parallel | 5 | done | `b5340cf` |
| T4 | S4 | `hooks/scripts/review-context.mjs`, `tests/review-hooks/`, README | odd-worker, parallel | 2 | done | `ac46791` |
| T6 | S4 | Drop the duplicate-lens deny (L5 B1); regression test for relaunch after an empty stop | odd-worker | 2 | done | see L6 |
| T5 | S5 | `plugin.json` version | odd-worker, after T1-T4 | 5 | pending | — |

## Log

- **L1 (2026-10-20, user):** "Podemos seguir con los pendientes que tenemos?"
- **L2 (2026-10-20, parent):** Still present on `6a32414`: S1-S4 items. Dropped as obsolete: the hardcoded output-style band label (`force-output-style.md` L6), since the band was removed (`flightdeck-panel.md` S1). `processBoundaryRiskReasons` comment scope (readability SUGGESTION) left out as cosmetic.
- **L3 (2026-10-20):** T1-T4 done, one commit each. T1: `oddLine`, `buildBand`, `activeFeature` and the band-only helper chain removed; `format.js` keeps `text` and `STATE_COLOR` (used by `panel/layout.js:58`); no RED (deletion). T2: RED 3 fail, GREEN `tests/contract.test.mjs` 23 pass; wording "a background `codegraph init --yes` was requested and may still fail". T3: RED read-only `settings.json` and empty/whitespace cases failed; the read-only `~/.claude` case was not observed RED; GREEN `tests/install/` 15 pass. T4: RED 2 fail (distinct lineages, fresh pending), GREEN `tests/review-hooks/` 20 pass; age from the pending file's mtime against `OPEN_LINEAGE_MAX_IDLE_MS`. Suite: `node --test tests/` 627 pass; `claude plugin test plugins/construct` 139 pass; plugin validate passed; `bash -n install.sh` ok.
- **L4 (2026-10-20, parent, live observation):** First live blocks of both Stop gates. The Risk line gate blocked a progress message because background workers had changed files during the turn; the review gate re-blocked on each new `install.sh` state while T3 was still writing (each byte change is a new target). Both behave as specified; the cost is a Risk line on progress messages and repeated review reminders while writers run in the background. Kept as an observation, not changed.
- **L5 (2026-10-20, odd-verify):** S1 PASS, S2 PASS, S3 PASS, S4 FAIL. B1: `review-capture.mjs:72` returns on an empty reply before removing the pending record, and the new deny in `review-context.mjs:41-55` then refuses the relaunch for six hours (probe: spawn, SubagentStop with `last_assistant_message: ""`, spawn again → deny; baseline allows). Same cause, unverified live: a spawn declined at an ask/deny rule after the hook allowed it. Parent decision (user delegated flow decisions, L1 of `assess-js-extensions.md`): drop the duplicate-lens deny, keep the two-lineage deny; S4 rewritten, T6 opened. Advisories kept: S3 now refuses a deliberately read-only `settings.json` (spec-intended); a non-writable HOME without `~/.claude` still fails at the merge with a stack trace (baseline behavior).
- **L6 (2026-10-20):** T6 done. RED: the relaunch-after-empty-stop test failed (17 pass, 1 fail); GREEN `tests/review-hooks/` 18 pass; `node --test tests/` 625 pass; plugin validate passed. Next: RDD review of the range (user consented: "si adelanet con la revision"), then T5.
