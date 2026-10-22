# Release 6.0.0

Objective: release the Construct-native rewrite (#47-#52) as 6.0.0. Branch: chore/release-6.0.0. Baseline: f9504d2. Delivery strategy: single-pr. Test runner: `node --test tests/`.

## Specs

- **S1 — Release 6.0.0.** "dale al release y borrar las ramas locales". Major release: agent and skill names change and `jd-fix-agent` and eleven skills are removed (BREAKING), with config compatibility through 6.x. Following CONTRIBUTING.md Releases and the 5.2.0 release commit (8f712e8): bump `version` in `plugins/construct/.claude-plugin/plugin.json`; bump `CONSTRUCT_REF` and the header URL tag in `install.sh`; update the README version badge, install URLs, pinned marketplace tag, the "Current version" line (major release, with the breaking renames named), and a "Changes in 6.0.0" list (the 5.2.0 list becomes a one-line summary, as earlier releases are); the "Upgrading to 6.0" section loses its draft status; update the version literals in `tests/install/install.test.mjs` the way 8f712e8 did. Tagging `v6.0.0` happens after merge and is the user's decision ("dale al release" covers it once the PR is merged).
  Given the merged release When `install.sh` runs Then it pins `carsimax/construct#v6.0.0`.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1 | Release 6.0.0 bump and notes | odd-worker | 5 | done | 9fa2ea0 (RED 3 install tests; GREEN 41/41; suite 971/971; validate --strict both pass) |

## Log

- **L1 (2026-10-22, user):** "dale al release y borrar las ramas locales"
- **L2 (2026-10-22, parent):** Major, not minor: public agent types (`construct:odd-*`, `construct:jd-*`) and skill names change and some are removed; prompts or scripts naming them break. The deprecated `odd_*`/`jd_*` options still apply through 6.x via `inherit`. The seven local `feat/construct-native*` branches were deleted after matching each tree to a commit on `main` (the unsliced branch lacked only one Log line that `main` has).
- **L3 (2026-10-22, parent):** T1 committed as 9fa2ea0; the only 5.2.0 references left are the one-line history, the evals comparison, and the install test's deliberately older ref. Next: review-risk and review-resilience (Risk 5), then push and PR; tag v6.0.0 after merge.
