# Oracle limits

Objective: the oracle becomes the only source of autonomy limits. Every code task goes through a locked oracle that declares its envelope; the fixed limits (inline 150, cap 3, failure-streak note, 150k backstop) are removed; safety guards stay. Branch: feat/oracle-limits. Baseline: a53c889 (1337/1337, mod 100/100). Test runner: node --test 'tests/**/*.test.mjs'; claude plugin test plugins/construct. Breaking: major release.

## Specs

- **S1 — The oracle is mandatory for code.** "la idea es aprobechar mejor el tema del oraculo para determinar los limites duros" (L1), "La idea es que siempre sea por el oraculo" (L2), "Oráculo obligatorio (recomendado) — Toda tarea de código pasa por el oráculo, así siempre hay límites y siempre los fija él; sin oráculo solo se permiten docs y .vault" (L3).
  - Given the main thread When it writes a path that is not under `.vault/` and not a doc Then surface-guard denies it, naming `construct:oracle` then `construct:worker`, whatever its size.
  - Given a `construct:worker` launch whose surfaces include a non-doc path When its `Spec:` task has no active oracle envelope (S2) Then delegation-admission denies it, naming the oracle.
  - Given a worker launch whose surfaces are only docs and `.vault/` Then no oracle is required.
  - Assumption: a doc is a `*.md` file outside `plugins/construct/hooks/contract/`, `plugins/construct/skills/`, and `plugins/construct/agents/` (those Markdown files are behavior).
  - A code task with no deterministic test (installer, `hooks.json`, UI layout): "Excepción aprobada por ti (recomendado) — El oráculo devuelve needs_interaction, tú apruebas en un menú y la tarea corre con la envolvente por defecto sin comando" (L4). The approval is recorded the way unlock approvals are (an AskUserQuestion answer naming the task), and the exempt envelope has the default budget and no test command.
- **S2 — The oracle declares the envelope.** Assumption: part of the oracle-envelope proposal the user accepted (L2-L4). "el oráculo fija los límites de cada tarea" (proposal accepted in L2).
  - Given an oracle that stops When its reply has an `## Envelope` section (test command, worker surfaces, attempts, minutes, changed lines) Then oracle-record stores it with the content-hash lock, keyed by feature and task; a worker cannot change it.
  - Each value is clamped to a fixed ceiling in code; a missing value takes the default: "10 intentos, 60 min, 1500 líneas (recomendado) — Defectos: 5 intentos, 30 min, 400 líneas" (L4).
  - Given a worker launched for that task When its `## Allowed edit surfaces` are not inside the envelope surfaces Then delegation-admission denies it.
- **S3 — The fixed autonomy limits are removed.** "eliminar los limites" (L2), "Sí, se mantienen (recomendado) — Solo se quitan los límites de autonomía; publicación, --no-verify, hooksPath, review store, bloqueo del oráculo y data dir siguen igual" (L3).
  - Removed: the inline edit limit (150/500) in surface-guard, the per-command iteration cap (3/10) in iteration-cap, the 5-failure note in failure-streak, the 150k-token context backstop note in delivery-signals, and `construct-limits` with limits-record.
  - Every safety guard keeps its current behavior and tests (S7).
- **S4 — The oracle decides when a worker stops.** Assumption: part of the oracle-envelope proposal the user accepted (L2-L4). Proposal accepted in L2.
  - Given a worker with an envelope When it stops Then a SubagentStop hook runs the envelope's test command (bounded by its own timeout): all pass → the stop is allowed; some fail and budget remains → the stop is blocked with the failing output; budget exhausted → the stop is allowed and the reply must report the failure.
  - A red oracle with budget left blocks the stop: "Sí, sigue trabajando (recomendado) — Es lo que lo hace autónomo: no para hasta verde o presupuesto agotado" (L4).
- **S5 — Attempts count progress, not command text.** Assumption: part of the oracle-envelope proposal the user accepted (L2-L4). Proposal accepted in L2.
  - An attempt is one oracle run at stop (S4) or one failed run of the envelope command; a run that raises the count of passing oracle tests does not spend an attempt; the budget is per task, shared by every worker of that task.
  - Wall-clock minutes count from the first worker start of the task.
  - Assumption: a spent budget (attempts or minutes) is a hard stop: surface-guard denies every write of a worker of that task, and its stop is allowed with the reason naming the spent budget, so the orchestrator reports to the user.
- **S6 — The envelope covers Bash writes.** Assumption: part of the oracle-envelope proposal the user accepted (L2-L4). Proposal accepted in L2.
  - Given a worker that stops When its diff since its start touches a path outside the envelope surfaces, or exceeds the changed-line budget Then the stop is blocked naming the paths and counts, whatever tool wrote them.
- **S7 — Safety guards unchanged.** Assumption: part of the oracle-envelope proposal the user accepted (L2-L4). Regression: publication-gate, command-guard (bypasses, hooksPath, depth), review-store-guard, oracle content-hash locks, the plugin data dir deny, and the risk floor keep every existing test green.
- **S8 — Docs.** Assumption: README, CLAUDE.md, CONTRIBUTING consistency table, session and subagent contracts, workflow, delegation, testing reference, oracle and worker agents, METHODOLOGY autonomy section, and CHANGELOG (breaking) describe the oracle envelope and no longer name the removed limits.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S2 | Envelope in the oracle reply, recorded with the lock, clamped to ceilings; admission checks worker surfaces against it | worker | 2, 3 | done | 665482a |
| T2 | S1 | Oracle mandatory: main thread writes only docs and .vault; worker admission needs an envelope for code | worker | 2, 3 | done | 4822d56 |
| T3 | S3, S7 | Remove inline limit, iteration cap, failure-streak, backstop, construct-limits; safety tests stay green | worker | 3 | done | 4822d56 |
| T4 | S4, S5 | SubagentStop runs the oracle; progress-based attempts and minutes per task | worker | 3, 4 | done | e049373 |
| T5 | S6 | Diff check against the envelope at stop | worker | 2 | done | e049373 |
| T6 | S8 | Docs, contracts, skills, agents, CHANGELOG | worker | 3 | done | ecc0b01 |

## Log

- **L1 (2026-10-29):** "quiero que sea mas autonomo deja un poco de lado la investacion que mejoras podemos hacer, la idea es aprobechar mejor el tema del oraculo para determinar los limites duros eso se podria"
- **L2 (2026-10-29):** "La idea es que siempre sea por el oraculo eso es eliminar los limites, por defecto sin oraculo es sin limites"
- **L3 (2026-10-29):** Menu answers: "Oráculo obligatorio (recomendado) — Toda tarea de código pasa por el oráculo, así siempre hay límites y siempre los fija él; sin oráculo solo se permiten docs y .vault"; "Sí, se mantienen (recomendado) — Solo se quitan los límites de autonomía; publicación, --no-verify, hooksPath, review store, bloqueo del oráculo y data dir siguen igual".
- **L4 (2026-10-29):** Menu answers: "10 intentos, 60 min, 1500 líneas (recomendado) — Defectos: 5 intentos, 30 min, 400 líneas"; "Sí, sigue trabajando (recomendado) — Es lo que lo hace autónomo: no para hasta verde o presupuesto agotado"; "Excepción aprobada por ti (recomendado) — El oráculo devuelve needs_interaction, tú apruebas en un menú y la tarea corre con la envolvente por defecto sin comando".
- **L5 (2026-10-29):** T1 (665482a): RED (missing envelope.mjs, writeEnvelope, readEnvelope), GREEN node --test 'tests/**/*.test.mjs': 1351 pass; claude plugin test: 100 pass. Envelope kept while an active lock of the task exists.
- **L6 (2026-10-29):** T2+T3 (4822d56): one commit (both rewrite surface-guard). Exemption built as `construct-gate oracle exempt <doc> <T#> -- <surfaces>` after an `Exempt` menu answer. RED confirmed afterwards: the new tests run against 665482a give 14 failures; GREEN node --test: 1259 pass (removed-limit tests deleted), claude plugin test: 100 pass. Prose for T6 listed by the worker; evals iteration-cap, small-inline, small-inline-pressure need a decision in T6.
- **L7 (2026-10-29):** Delivery: one PR for the feature (CONTRIBUTING: large work goes out as one pull request, no line budget); the slice counter is mostly deletions (1869 of 2426 lines).
- **L8 (2026-10-29):** T4+T5 (e049373): new oracle-stop.mjs (SubagentStop stop, PostToolUseFailure bash), task state next to the envelope, baseTree at the first worker start, surface-guard hard stop. RED 22/24 failing, GREEN 24/24. Parent fix: a replaced envelope drops the old task state (RED then GREEN). node --test: 1284 pass; claude plugin test: 100 pass; validate --strict passed. Shortcuts: whole-tree diff counts concurrent writers; unlocked state updates.
- **L9 (2026-10-29):** T6 (ecc0b01): contracts, skills, agents, README, CLAUDE, CONTRIBUTING, METHODOLOGY, CHANGELOG (Breaking); evals iteration-cap, small-inline, small-inline-pressure removed by the parent (the worker's git rm was refused by the safety layer). node --test: 1278 pass; claude plugin test: 100 pass; validate --strict passed. Converge: S1-S8 each map to a done task; gap kept as follow-up: no eval covers the oracle-first path or the stop block. Version bump is the release PR.
