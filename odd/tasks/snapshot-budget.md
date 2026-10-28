# Snapshot budget

Objective: stop the Risk-line snapshot from trusting the real index's stat cache (a same-size rewrite with its mtime restored goes unseen) without slowing heavy repositories or letting the hook time out. Branch: fix/snapshot-budget. Baseline: 9b4aed4. Delivery strategy: single-pr. Test runner: node --test 'tests/**/*.test.mjs'.

## Specs

- **S1 — Correct and bounded snapshot.** "vamos con las recomendaciones" (T3 (a): hash from HEAD) then "c" (not released: the entry-count budget slowed byte-heavy repositories).
  - Given a same-size rewrite with a restored mtime in a non-racy index When `freezeWorkingTree` runs Then the change is seen (test from `odd/tasks/security-review.md` T3).
  - Given any repository When `risk-line` mark and check run Then each stays well under the 30 s hook timeout, and a degraded (index-seeded) snapshot is announced to the user, never silent.
  - ~~Open: the budget.~~ Decided (T1): "Presupuesto de tiempo (Recommended)" — the full HEAD-seeded hash runs under a time budget; on timeout it falls back to the index-seeded snapshot, announces it once, and is remembered so later calls in the repository skip the full hash. Assumptions: budget 5 s per call (a constant), remembered in the session's risk-line record (pruned with it), stale `construct-index-*` directories pruned by `pruneState`.

### Measured on 01111dc..47fa4d2 (lens probes, local SSD, warm cache)

- HEAD-seeded full hash: 251 files 53 ms; 19,999 small files 479–492 ms; 50,000 files / 800 MB 4.7–7.8 s; 20 × 100 MB 2.8–4.7 s; throughput about 0.4–0.7 GB/s, so roughly 12–20 GB passes 30 s.
- Index-seeded (12.0.0 behavior): 20,001 small files 48–56 ms; 50,000 files 83–88 ms; 2 GB 22 ms.
- Split index with 60,001 files: header count 1, full hash 1.5–3.2 s. Cone sparse index: header count correct.
- A killed `mark` writes no record, so `check` compares against the previous turn's tree; a killed freeze leaves a `construct-index-*` directory and an orphan `git add -A`.
- The index-seeded path needs `-c core.fsmonitor=false -c core.untrackedCache=false`.

### Candidate designs

- A time budget on the full hash (spawnSync timeout) with fallback to the index-seeded snapshot, remembered per repository so heavy repositories do not pay the timeout every call.
- A byte budget from the index entries' size fields (needs parsing the index, not just its header).
- Prune stale `construct-index-*` directories in `pruneState`.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1 | Choose the budget design | user | none | done: time budget | — |
| T2 | S1 | Tests (mtime-restore, heavy repo timing, split index, notice once, killed mark), then the change, then clean-context review-risk and review-resilience | worker | 2 | done | — |

## Log

- **L1 (2026-10-27):** opened from `odd/tasks/security-review.md` L11; measurements from the review-resilience and review-risk lens reports.

- **L2 (2026-10-27):** "Bien primero vamos con los pencientes abiertos de odd" — T1 answered "Presupuesto de tiempo (Recommended)".

- **L3 (2026-10-27):** T2 by worker; RED confirmed afterwards (5 new tests fail on the baseline source). Two test flakes fixed by the parent: ctime crossing a second boundary (`core.trustctime=false` in the test repos) and a shared-TMPDIR race (private TMPDIR). Full suite 1088/1088 six runs in a row. Not bounded: the fallback's `add -A` when assume-unchanged or skip-worktree entries force a HEAD seed (existing behavior). New env knob `CONSTRUCT_SNAPSHOT_BUDGET_MS`, for tests.

- **L4 (2026-10-27):** Lenses on 864b2fb: no blockers. review-risk WARNING (pruneState recursive delete of planted `construct-index-*` on a shared /tmp) fixed in one correction batch: only directories owned by the user with no group or other permissions are pruned (RED then GREEN). review-resilience WARNINGs left for the user: the fallback's unbounded `add -A` when assume-unchanged or skip-worktree entries force a HEAD seed, and `slow` never retried within a session.

Next step: review-risk on the correction commit, then the user decides push and PR.
