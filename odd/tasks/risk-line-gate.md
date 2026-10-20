# Risk line gate and start escalation

Objective: move two closure steps the model does by memory into code: a `Stop` gate that asks for the Risk line when the turn changed the repository, and `--escalate-item` on `odd-review start`. Branch: `feat/risk-line-gate`, baseline `38eab15` (main). Delivery strategy: ask-on-risk. Test runner: `node --test tests/`; `claude plugin validate --strict ./plugins/construct`.

## Specs

- **S1 — Escalation on `start`.** Source: the review-determinism follow-up "`odd-review start` has no `--escalate-item`, so an escalated candidate needs explicit `--lenses`" (`odd/tasks/review-determinism.md` L9), taken up by the user: "Si vamos con ese plan!". `odd-review start` accepts `--escalate-item N --escalate-reason TEXT` with the same validation as `odd-assess` (`parseEscalation`, `lib/assess/escalation.mjs`) and raises the frozen candidate's tier with `escalateRisk` before choosing default lenses, so a `medium` or `passive` candidate escalated to `high` gets all four lenses and a lenses reason that includes the `agent_escalation` detail. Assumption: `--escalate-item` together with `--lenses` is a usage error (exit 2), because explicit lenses already bypass the assessment. Usage text, README, and `rdd-review` (when `odd-assess` was escalated, pass the same flags to `start`) change together.
- **S2 — Risk line gate.** Source: the component map row "Risk line and closure discipline | `Stop` hook ... checking for a `Risk:` line" (`odd/tasks/odd-skills-plugin.md`), taken up by the user: "Si vamos con ese plan!". A `UserPromptSubmit` hook records the working-state tree (`freezeWorkingTree`) per session. A `Stop` hook compares the current working-state tree with that record; when paths outside `odd/tasks/` changed during the turn and `last_assistant_message` has no line that starts (after optional Markdown emphasis or list marker) with `Risk: none` or `Risk: item N` (N 1-6), it blocks the stop once per turn with a reason that names up to three changed paths and the expected form. Assumptions: a command hook, not the planned `prompt` hook, so the check is deterministic; the feature document under `odd/tasks/` alone does not need a Risk line; the hook fails open (no record, no repository, no commits, `stop_hook_active`, missing `last_assistant_message`, any error → no output, exit 0); the "undeclared pending checks" half of the map row stays out of scope (not deterministic to check). Registered in exec form; README documents both hooks.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1 | `--escalate-item`/`--escalate-reason` on `start` in `lib/review/cli.mjs` and `commands.mjs`; tests in `tests/review/`; usage, README, `rdd-review` | odd-worker | none | pending | — |
| T2 | S2 | `hooks/scripts/risk-line.mjs` (`mark` on UserPromptSubmit, `check` on Stop), `hooks.json`; tests in `tests/risk-line/`; README | odd-worker, after T1 (shared README) | 2 | pending | — |

## Log

- **L1 (2026-10-20, user):** "Quiero que revisemos los pendientes para que nuestro fujo de odd siga siendo mas pareceido y determinista que el de https://github.com/Gentleman-Programming"
- **L2 (2026-10-20, parent):** Upstream gentle-ai is still v4.2.0 (2 later commits: README videos, a codegraph worktree note); nothing new to port. The proposed classifier fix (Node hook scripts) already shipped in `assess-node-modules` (0.2.1); the user was told. Remaining package: S1 and S2.
- **L3 (2026-10-20, user):** "Si vamos con ese plan!"
