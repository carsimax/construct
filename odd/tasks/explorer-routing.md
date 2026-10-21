# Explorer routing

Objective: give `odd-explorer` an explicit effort and let the parent map independent fronts with several Haiku explorers in parallel. Baseline `4320200` (main, 2.0.0). Working tree only; commits are the user's. Test runner: `node --test tests/`; `claude plugin test plugins/construct`; `claude plugin validate --strict ./plugins/construct`.

## Specs

Source: the user's "Podemos aplicarlo asi, ademas podemos hacer una mejora respecto a odd-explorer? al usar haiku podemos lanzar mas de un explorador desde distintos frentes" (L1), after the model/effort review in L2.

- **S1 — Explorer effort is explicit.** The `odd-explorer` default effort is `medium` (Haiku 5.5's own API default), not `default`, so routing no longer depends on what the harness sends a subagent. Every other role keeps its S6 model and effort. The S6 table (`tests/agents-config.test.mjs`), `effort_odd_explorer` default in `plugin.json`, the agent's frontmatter, and the README routing table agree.
- **S2 — Parallel explorers on independent fronts.** When mapping needs evidence from independent fronts (separate modules, layers, or questions whose answers do not depend on each other), the parent launches up to 3 `construct:odd-explorer` agents in one message, one front each. Each prompt names its front, its question, and the other fronts as out of scope. One front stays one explorer; a front that needs another's answer runs after it. Each returns at most about 2k tokens with `path:line` evidence (3 × 2k stays inside the parent's 10k batch budget). The parent spot checks one claim per report, then re-evaluates task size. Launch deduplication still applies (distinct fronts are distinct fingerprints). The session contract stays under 8,000 characters.
- **S3 — Release 2.1.0.** Source: "podemos mandar pr y release?" (L5). Minor: S1 and S2 add behavior without breaking a contract. Follow CONTRIBUTING "Releases" and mirror release commit `4320200` (2.0.0): `plugin.json` version, `install.sh` `CONSTRUCT_REF` and header URL, README badge, install URLs, marketplace pin, current-version paragraph, `tests/install/install.test.mjs`. Branch `feat/explorer-routing`, one pull request with the version in its title; tag `v2.1.0` only after the user merges.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1 | Explorer effort `medium` in config, frontmatter, S6 test, README | odd-worker | 3 | done | |
| T2 | S2 | Parallel-explorer rule in session contract and `odd-delegation` (skill and handoffs) | odd-worker | 6 | done | |
| T3 | S3 | Release 2.1.0 | odd-worker | 5 | done | |

## Log

- **L1 (2026-10-21, user):** "Podemos aplicarlo asi, ademas podemos hacer una mejora respecto a odd-explorer? al usar haiku podemos lanzar mas de un explorador desde distintos frentes"
- **L2 (2026-10-21, parent):** Against the claude-api skill (cached 2026-10-06): Opus 5.5 default effort `medium`, Sonnet 5.5 `high` (recommended start `medium` for agentic coding), Haiku 5.5 `medium`, positioned for sub-agent work. The four Sonnet reviewers at `medium` stay until an eval compares `medium` and `high`. `delegation-admission.mjs` admits explorers untouched, so S2 needs no hook change.
- **L3 (2026-10-21, user):** Chose "Todos menos este": every other `odd/tasks/*.md` deleted from the working tree (recoverable from git; the uncommitted L12 of `remove-secret-guard.md` is lost; `harness-extras` T3/T5 lose tracking). `delegation-admission.mjs:19` still cites `odd/tasks/gentle-parity.md`.
- **L4 (2026-10-21, progress):** T1: S6 row RED then GREEN (`tests/agents-config.test.mjs` 4/4). T2: `session.md` 7,411 characters; the contract test adds the notice text, so the real ceiling is about 7,410, not 8,000 (the Mapping bullet was compressed to fit). `node --test tests/`: 1136, 1133 pass, 3 fail, the locking cases in `tests/review/invariants.test.mjs` that already failed on baseline `8743462`. `claude plugin test`: 161 pass. Both validates pass. Commit: user.
- **L5 (2026-10-21, user):** "podemos mandar pr y release?". RDD mode is off (global), so no review is due. Branch `feat/explorer-routing`; S3 and T3 added. Commits `d215d7a` (T1), `ab972db` (T2), `80b192b` (deletions). The slice is ~1,970 changed lines, almost all whole-file deletions, so it stays one pull request.
- **L6 (2026-10-21, progress):** T3: 2.1.0 in `plugin.json`, `install.sh`, README (badge, install URLs, marketplace pin, Status paragraph, "Upgrading from 2.0.0"), install test; `tests/install/` RED then GREEN (30/30). Pre-PR checks: `node --test tests/` 1133/1136, the 3 failures also fail on `4320200` (`tests/review/invariants.test.mjs` 47/3 in a detached worktree); `claude plugin test` 161 pass; both validates pass. Merge and tag `v2.1.0`: user, then the GitHub Release.
- **L7 (2026-10-21, user):** "Fusionado". Merged as `d09ceba` (#31); annotated tag `v2.1.0` pushed; GitHub Release `v2.1.0` published as Latest; `raw.githubusercontent.com/carsimax/construct/v2.1.0/install.sh` returns 200. Feature closed.
