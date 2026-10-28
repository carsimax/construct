# Risk floor

Objective: ADD P5 — signals in the published diff set a minimum Risk the agent can raise but not lower, so a wrong `none`, or risky work without a feature document, still needs the lenses. Branch: feat/risk-floor. Baseline: 36559fd. Delivery strategy: single-pr. Test runner: node --test 'tests/**/*.test.mjs'.

## Specs

- **S1 — Floor from diff paths.** "Vamos con el ADD" (P5 in `METHODOLOGY.md`: "Signals in the diff (migrations, auth, lockfiles, CI, installers, and paths the project declares as contracts) set a minimum the agent may raise but not lower.")
  - Given a ref whose diff from the merge-base touches a path in the default table When `reviewState` runs Then those items join the declared ones (`items = declared ∪ floor`), even when no feature document changed, and the gate's deny message names the matched paths.
  - Default table (from `docs/research/notes/Principios ADD/p5_risk_floor.md`): `**/migrations/**`, `*.sql` → 1; `**/auth/**`, `**/*secret*`, `.env*` → 2; lockfiles (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`, `Cargo.lock`, `poetry.lock`, `uv.lock`, `go.sum`, `Gemfile.lock`), `.github/workflows/**`, `Dockerfile`, `install.sh` → 5.
  - Deleted paths count too (a deleted migration is item 1).
- **S2 — Project-declared floor.** Same quote.
  - Given `odd/risk-paths` at the merge-base, one `<glob> <items>` per line (`#` comments, blank lines ignored) When `reviewState` runs Then matching paths add those items. It is read at the merge-base, never at the ref, so a change cannot lower its own floor. An unreadable line denies (fail closed, like an unreadable Risk cell).
  - Assumption: added-line keywords (`DROP TABLE`, `rm -rf`) are out of scope; paths only.
- **S3 — Docs say what Construct enforces.** README publication gate paragraph, `skills/review/SKILL.md` where it describes required lenses, `METHODOLOGY.md` P5 "Construct today" line, CHANGELOG Unreleased.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1, S2, S3 | Tests first in `tests/publication/`, then the floor in `reviewState` (`publication-gate.mjs`), glob matcher without new dependencies, docs | worker | 2-3 | done | — |

## Log

- **L1 (2026-10-27):** "Vamos con el ADD" — after 12.0.2 and #78; plan order: baseline evals (running), then the risk floor.

- **L2 (2026-10-28):** T1 by worker, RED 8/9 new tests (the no-match test passes by design). Parent: skill-context wording now says "feature documents or diff paths". Suite 1103/1103; plugin validate passes. Open: globs in `odd/risk-paths` cannot hold spaces; deny lists 5 paths per item.

Next step: review-risk and review-reliability, then the user decides push and PR.
