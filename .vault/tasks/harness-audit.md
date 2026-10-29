# Harness audit fixes

Objective: fix the real defects a read-only audit of hooks, mod, installer, and docs found (L1). Branch: fix/harness-audit. Baseline: b8a5d16 (1312/1312 tests). Test runner: node --test 'tests/**/*.test.mjs'; claude plugin test plugins/construct.

## Specs

Assumption (all S#): each spec restates one audit finding the user accepted with "Todo (recomendado)" (L1); the exact inputs are the audit's reproductions.

- **S1 — Persistent hooksPath bypass.** Assumption: an audit finding accepted in L1. `git config core.hooksPath /dev/null` (and `--global`/`--local`/`--add`/`--replace-all` forms, any case of the key) is denied by command-guard with the same reason text as `git -c core.hooksPath=...`. Reading it (`git config --get core.hooksPath`, `git config core.hooksPath` with no value) stays allowed.
- **S2 — Attached short option.** Assumption: an audit finding accepted in L1. publication-gate reads `gh pr create -Hbranch` (and any short option the gate reads, attached form `-Xvalue`) exactly like `-H branch`.
- **S3 — Nesting depth fails closed.** Assumption: an audit finding accepted in L1. A command nested past the parser depth cap (`sh -c`/`eval` layers) is denied by publication-gate, command-guard, and review-store-guard through their existing unparseable-command denial, not silently allowed.
- **S4 — Risk floor without a default branch.** Assumption: an audit finding accepted in L1. DROPPED (L3). pre-push applies the floor paths (installers, lockfiles, auth) even when no default branch resolves and no feature document exists, as the publication-gate header states ("whatever the feature documents declare").
- **S5 — Writers stay out of the plugin data dir.** Assumption: an audit finding accepted in L1. surface-guard denies a subagent (`agent_id` set) Write/Edit/MultiEdit/NotebookEdit whose real path is under `dataDir()`; the main thread is unchanged.
- **S6 — Long writers keep their record.** Assumption: an audit finding accepted in L1. delegation-admission's 1 h sweep removes only unstarted records; a started writer record survives until its SubagentStop (or the 7-day prune).
- **S7 — Table rows with the wrong cell count.** Assumption: an audit finding accepted in L1. In feature-state.mjs and hooks/status/tasks.js a Tasks row with fewer cells than the header counts as unfinished and does not drop the document from `activeDocuments`. A surplus `|` keeps its current reading (joined into Task), which only ever makes a row read unfinished (fail closed, L5).
- **S8 — Band clears after a denied ask.** Assumption: an audit finding accepted in L1. After a permission ask is denied (no `tool.call` for it), the next non-blocking `tool.call` clears "waiting on you" when it starts, not when it returns.
- **S9 — Review store prune without verdicts/.** Assumption: an audit finding accepted in L1. `pruneStore` still expires `pending/` records when `verdicts/` does not exist.
- **S10 — Lost relaunch message.** Assumption: an audit finding accepted in L1. DROPPED (L7). review-capture surfaces the `incomplete_inspection` refusal message (relaunch the lens) the way it surfaces `invalid_result`.
- **S11 — Installer messages.** Assumption: an audit finding accepted in L1. install.sh prints a `construct-install:` failure line when `claude --version` fails or prints nothing, instead of aborting silently or printing an empty version.
- **S12 — Stop hook budget.** Assumption: an audit finding accepted in L1. The Stop hook timeout covers the risk-line snapshot budget plus its git diffs (git diffs get a timeout or the hook timeout is raised).
- **S13 — Doc drift.** Assumption: an audit finding accepted in L1. CLAUDE.md names `oracle` as a writer and lists `oracle-record.mjs`, `unlock-approval.mjs`, `delivery-signals.mjs`; README Skills row lists all eight skills; subagent.md language rule matches session.md ("English unless the user asks otherwise"); publication-gate `shortcut:` header drops `xargs`; hook-io `STATE_DIRS` drops the unused `unlock-approval` entry; CHANGELOG Unreleased lists the fixes.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1, S2, S3 | Shell guards: hooksPath config, attached short options, depth cap fails closed | inline | 2 | done | 4d3d2ef |
| T2 | S5, S6 | Writer confinement: data dir deny, started records survive the sweep | inline | 2, 4 | done | e38dda6 |
| T3 | S7 | Tasks table parser fails closed on wrong cell counts | inline | 3 | done | eda54f5 |
| T4 | S8 | Band clears a stale block when a call starts | inline | none | done | 00414c1 |
| T5 | S9, S11, S12 | Review store prune, installer messages, Stop timeout | worker | 1, 5 | done | 7f30e94 |
| T6 | S13 | Docs, header comments, STATE_DIRS, CHANGELOG | worker | none | done | f19d011 |

## Log

- **L1 (2026-10-29):** "Hola puedes explorar y revisar todi mi sistema? quiero que busques mejoras reales y arreglar defectos que encuentres a mi harness". Scope chosen in the menu: "Todo (recomendado) — Los 6 medios, los menores y la documentación, en commits por unidad en fix/harness-audit".
- **L2 (2026-10-29):** Deferred, not in scope: Workflow with an unknown saved name is admitted (denying it could block bundled workflows; needs a product decision); `oracle unlock` via `$(command -v construct-gate)` (a declared shortcut); limits files pruned by last write; old notes in docs/research.
- **L3 (2026-10-29):** Pi admits writers only for `odd/tasks/<feature>.md` documents, so units run inline. S4 dropped as a false positive: without a default branch there is no merge-base, so no diff for the floor and no review subject to approve; pre-push.mjs documents the exception on purpose. T1: node --test tests/publication/*.test.mjs tests/guard/*.test.mjs: 611 pass, 0 fail (RED observed first for the 5 hooksPath forms, the attached -H forms, and the six-layer nesting).
- **L4 (2026-10-29):** T2 (e38dda6): RED on the stashed base (S5, S6 fail), GREEN node --test tests/admission/*.test.mjs tests/limits/*.test.mjs: 170 pass. A stale started record stays for surface-guard but stops counting for overlap, so a crashed writer cannot block launches.
- **L5 (2026-10-29):** T3 (eda54f5): RED then GREEN; node --test tests/feature-state tests/living-spec tests/limits/tracked-work: 52 pass; claude plugin test plugins/construct: 99 pass (98+1 RED on the stashed base). The surplus-pipe case already reads unfinished, so it stays.
- **L6 (2026-10-29):** T4 (00414c1): RED (status still waiting while the held call runs), GREEN claude plugin test plugins/construct: 100 pass.
- **L7 (2026-10-29):** S10 dropped: tests/review-hooks/review-hooks.test.mjs:329 pins that an incomplete inspection records nothing and does not block (by design; the gate then denies for a missing verdict). Context backstop reached: T5 and T6 go to workers.
- **L8 (2026-10-29):** T6 worker done: node --test contract, word-budget, skills, agents-config, roles, version: 90 pass. STATE_DIRS drops unlock-approval (nothing writes it). Commit pending with T5.
- **L9 (2026-10-29):** T5 worker done: RED then GREEN, focused 221 pass. Diffs bounded at 3 s each and the Stop timeout raised 30 -> 40 s (5 + 20 + 2x3 already exceeds 30).
- **L10 (2026-10-29):** Close: node --test 'tests/**/*.test.mjs': 1337 pass, 0 fail; claude plugin test plugins/construct: 100 pass; claude plugin validate --strict ./plugins/construct: passed. S4 and S10 dropped (L3, L7). Next: review lenses for Risk 1, 2, 3, 4, 5; push and PR are the user's decision.
- **L11 (2026-10-29):** Native review lineage review-13f9e3cfc70b03b6 (lenses risk, resilience, reliability) approved and acknowledged on f9352e4. Non-blocking follow-ups: publication-gate.mjs:73 attached short option can misread a value word starting with -H; register.js:234 a concurrent call clears a block early; risk-line.mjs:173 marker-scan diff timeout is silent; delegation-admission.mjs:279 a stale corrupt record is never removed; stop-budget test greps source; STATE_DIRS orphan dir from older versions. Construct's own construct:review-* lenses were not run (they need Claude Code's Agent tool); the publication gate will ask for them before push.
