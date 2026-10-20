# ODD debt cleanup

Objective: close the follow-ups left in earlier feature documents that still apply on `main`. Branch: `fix/odd-debt`, baseline `6a32414` (main). Delivery strategy: ask-on-risk. Test runner: `node --test tests/`; `claude plugin test plugins/construct`; `claude plugin validate --strict ./plugins/construct`.

## Specs

- **S1 — Dead panel code.** Source: "`activeFeature` (`status/tasks.js`) and `buildBand`/`oddLine` (`status/format.js`) are no longer reached by production code and survive only because tests assert them" (`odd/tasks/construct-panel.md` L9). Remove the functions no production path reaches, and the tests that only assert them; keep anything production still calls (check every caller, including `hooks/register.js` and `hooks/panel/`). Behavior of the panel unchanged.
- **S2 — Honest CodeGraph notice.** Source: "the 'indexing started' notice is issued even if init later fails (e.g. refuses `$HOME`), and repeats on resume/clear/compact" (`odd/tasks/codegraph-integration.md` L7 advisory 4). With auto-index on, the hook launches `codegraph init` only when the SessionStart `source` is `startup`; on `resume`, `clear`, or `compact` with the index still missing it gives the manual notice, which then also says an earlier automatic init may have failed. The launch notice says the launch was requested, not that indexing started, and names `codegraph status` as the check. Assumption: a missing `source` counts as `startup`.
- **S3 — Installer edge cases.** Source: "a read-only `~/.claude` passes preflight and fails at the merge with a raw stack trace; an empty `settings.json` is treated as invalid" (`odd/tasks/curl-installer.md` L7). Preflight fails with one clear message when `~/.claude` (or the settings file) is not writable, before any change. An empty or whitespace-only `settings.json` is treated as `{}`.
- **S4 — Review hook ambiguity.** Source: "a prompt naming two lineages uses the first; two spawns of the same lens in one session share one pending record" (`odd/tasks/review-determinism.md` L8). `review-context.mjs` denies a `construct:review-*` spawn whose prompt names two or more distinct lineages, with a message to name one. It denies a second spawn of the same lens while that lens has a pending record in the session, with a message to wait for the first. Assumption: a pending record older than the review-gate's six-hour window counts as abandoned and does not deny.
- **S5 — Release.** Source: the refactor in PR #12 never reached installs because "`claude plugin update` only fetches on a version bump". After S1-S4, `plugin.json` version 0.7.1 in a `chore: release 0.7.1` commit.

User request for all specs: "Podemos seguir con los pendientes que tenemos?"

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1 | `hooks/status/format.js`, `hooks/status/tasks.js`, mod tests | odd-worker, parallel | none | in progress | — |
| T2 | S2 | `hooks/scripts/contract.mjs`, `tests/contract.test.mjs`, README | odd-worker, parallel | none | in progress | — |
| T3 | S3 | `install.sh`, `tests/install/`, README | odd-worker, parallel | 5 | in progress | — |
| T4 | S4 | `hooks/scripts/review-context.mjs`, `tests/review-hooks/`, README | odd-worker, parallel | 2 | in progress | — |
| T5 | S5 | `plugin.json` version | odd-worker, after T1-T4 | 5 | pending | — |

## Log

- **L1 (2026-10-20, user):** "Podemos seguir con los pendientes que tenemos?"
- **L2 (2026-10-20, parent):** Still present on `6a32414`: S1-S4 items. Dropped as obsolete: the hardcoded output-style band label (`force-output-style.md` L6), since the band was removed (`flightdeck-panel.md` S1). `processBoundaryRiskReasons` comment scope (readability SUGGESTION) left out as cosmetic.
