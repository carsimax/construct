# Guarantees (15.0.1)

Objective: phase 0 of the L1 plan: the guarantees of 15.0 no longer turn off silently, and the README installs the current release. Branch: fix/guarantees. Baseline: 85cf5e7 (1287/1287, mod 100/100). Test runner: node --test 'tests/**/*.test.mjs'; claude plugin test plugins/construct.

## Specs

- **S1 — README installs the current release.** "README a v15 + test que compare su versión con plugin.json" (L1). Assumption: the README version badge, the two `install.sh` URLs, and the "Current version" line name the `plugin.json` version; a repository test fails when any of them differs. The "Changes in X" line describes 15.0.0.
- **S2 — A worker is never left unconfined by its start.** "marcar iniciado antes de la foto, timeout 30 s, y sin baseTree con envolvente el stop bloquea" (L1).
  - Given a construct:worker SubagentStart When the hook runs Then the admission record is written `started: true` with the `agent_id` before any snapshot is taken, so surface-guard confines the worker even if the snapshot then fails or the host kills the hook.
  - The SubagentStart hook entry that runs delegation-admission `start` has a timeout of 30 s.
  - Given a worker whose task has an envelope and no recorded baseline (neither its own nor the task's) When it stops Then oracle-stop blocks the stop naming the missing start snapshot and spends one attempt (so a spent budget still ends it), instead of skipping the diff check.
- **S3 — Unreadable state denies.** "estado, lock o envolvente ilegibles → denegar nombrando el archivo" (L1).
  - A missing file keeps today's meaning (no envelope, no state, no lock). A file that exists but cannot be read or parsed, or has the wrong shape, is unreadable.
  - Unreadable envelope or task state: delegation-admission denies the worker launch, surface-guard denies the worker's writes, and oracle-stop blocks the stop, each naming the file.
  - Unreadable oracle lock record: surface-guard denies every subagent write and the publication gate denies publishing, naming the file.
  - Unreadable writer record in the session's admission directory: surface-guard denies the writes of a subagent that has no readable record, naming the file.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1 | README version, install URLs, and a version-consistency test | worker | 5 | open | |
| T2 | S2, S3 | Started-first, 30 s start timeout, missing baseline blocks; unreadable state denies | worker | 2 | open | |

## Log

- **L1 (2026-10-29):** "ahora quiero que explores todo el proyecto y des opinion sincera y propongas cambios reales, la idea es que funcione bien y lo mas autonomo posible". The user chose all four phases in the menu: "0. Bugs (15.0.1) — README a v15, worker sin control tras timeout, estado ilegible = denegar", "1. Autonomía", "2. Simplificar", "3. Medir". Phase 0 proposal quoted in S1-S3: "README a v15 + un test que compare su versión con plugin.json", "Marcar iniciado antes de la foto, timeout 30 s, y si falta baseTree con envolvente el stop bloquea", "Estado, lock o envolvente ilegibles → denegar nombrando el archivo".
- **L2 (2026-10-29):** Confirmed before writing: README.md:4,39,57,368 name 12.0.0 while plugin.json is 15.0.0; hooks.json SubagentStart timeout is 10 s while delegation-admission.mjs:696 snapshots (up to ~25 s) before writing `started: true`; oracle-stop.mjs:91 skips the diff when no baseline exists.
