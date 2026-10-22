# Release 5.2.0

Objective: release the three harness-comparison waves (#43, #44, #45) as 5.2.0. Branch: chore/release-5.2.0. Baseline: 089ab40. Delivery strategy: single-pr. Test runner: `node --test tests/`.

## Specs

- **S1 — Release 5.2.0.** "dale al release" (after the proposal "Release 5.2.0: sería un minor, porque las olas 1 y 3 agregan funcionalidad"). Following CONTRIBUTING.md Releases and the 5.1.0 release commit (9299c28): bump `version` in `plugins/construct/.claude-plugin/plugin.json`; bump `CONSTRUCT_REF` and the header URL tag in `install.sh`; update the README version badge, install URLs, pinned marketplace tag, "Current version" line, and a "Changes in 5.2.0" list (the 5.1.0 list becomes a one-line summary, as earlier releases are); update the version literals in `tests/install/install.test.mjs` the way 9299c28 did. The changes list names the main-thread write rule as a behavior change users will notice. Tagging `v5.2.0` happens after merge and is the user's decision.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1 | Release 5.2.0 bump and notes | odd-worker | 5 | done | dd0812f (RED install test; GREEN 41/41; suite 904/904; validate --strict both pass) |

## Log

- **L1 (2026-10-22, user):** "dale al release"
- **L2 (2026-10-22, parent):** Minor release: #43 adds command-guard, surface-guard, the marker block, and the memory injection filter; #44 is prompt text; #45 adds failure-streak, coverage warnings, lens memory hints, and `review stale`. No removal of a public option or command, so no major; the main-thread write denial is a new enforcement of an existing contract rule and is called out in the notes.
- **L3 (2026-10-22, parent):** T1 committed as dd0812f; no stale 5.1.0 reference outside the one-line history; marketplace.json has no version. Next: review-risk and review-resilience (Risk 5), then push and PR; tag v5.2.0 after merge.
