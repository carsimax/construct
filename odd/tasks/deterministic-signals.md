# Deterministic signals

Objective: move state the model now reconstructs into code (workflow scripts, injected command output, narrower hooks), as gentle-shell's native controller does. Branch: feat/deterministic-signals. Baseline: 992b450. Delivery strategy: single-pr. Test runner: `node --test tests/` and `claude plugin test plugins/construct`.

## Specs

- **S1 — Probe whether a plugin workflow can drive the review lenses.** "ok vamos con ese plan la idea es ser un poco mas determinista como lo hacer tu con gentle-shell" (plan step: "Empezaría por una prueba barata de la duda del punto 1: un workflow de un solo `agent()` que lance `construct:review-risk`, para ver qué hooks se disparan."). Record in the Log which hook events fire (PreToolUse:Agent, SubagentStart, SubagentStop) for a workflow `agent()` call and whether `construct:review-risk` gets its review-context. The result decides S6.
- **S2 — Skills inject real state.** Plan point 2: "Inyectar estado real en los skills con `` !`comando` ``": `workflow` injects `git status --short` and the open tasks of `odd/tasks/`; `review` the lenses the current Risk requires and which already approved; `delivery` the authored lines against the base branch. Commands are read-only, bounded, and fail soft (an error prints a one-line note, never blocks the skill).
- **S3 — Split delivery-signals.** Plan point 3: "La señal de commit puede ir en un handler con `matcher: "Bash"` y `if: "Bash(git commit *)"`. La señal de contexto (backstop) puede ir en **`PostToolBatch`**, que se dispara una sola vez por lote." Notice texts and thresholds unchanged.
- **S4 — Agent caps.** Plan point 4: "`maxTurns` para `explorer` y `verifier` [...] `background: true` en `general`".
- **S5 — Model-only skills.** Plan point 5: "`user-invocable: false` en `delegation`, `review` y `workflow`".
- **S6 — Review workflow (conditional on S1).** Plan point 1: "Un `workflows/review.js` mueve ese plan a código [...] `agent(..., { schema })` valida el JSON". Only if S1 shows the lens gets its evidence and its verdict is recorded; else S6 is dropped with the reason in the Log.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1 | Workflow hook probe (scratch, nothing committed) | parent | none | done (L2) | |
| T2 | S3 | delivery-signals split, hooks.json, tests | parent | 3 | done (RED 9 fail; tests/signals 24/0; suite 1099/0; live L4) | pending-commit |
| T3 | S4, S5 | Agent and skill frontmatter, tests | parent | none | pending | |
| T4 | S2 | Dynamic context in workflow, review, delivery skills, tests | parent | 6 | pending | |
| T5 | S6 | Review workflow, if S1 allows | parent | 2, 3 | dropped (L2) | |

## Log

- **L1 (2026-10-23, user):** "ok vamos con ese plan la idea es ser un poco mas determinista como lo hacer tu con gentle-shell"
- **L2 (2026-10-23, parent, T1):** Claude Code 2.1.309, scratch clone of 992b450, plugin copy with a logging hook, `claude -p` running `workflows/probe.js` = `agent('Review subject: HEAD~1', { agentType: 'construct:review-risk' })` (`agentType` is an `agent()` option, found in the binary's workflow-authoring reference). Events logged: `PreToolUse` and `PostToolUse` for tool `Workflow` only, then `SubagentStart` and `SubagentStop` with `agent_type: construct:review-risk`. No `PreToolUse:Agent`, so `review-context.mjs` never built evidence; the lens answered `inspection.status: incomplete` ("No injected evidence block was provided"). `SubagentStart` input carries no prompt (docs: only `agent_id`, `agent_type`), so the subject cannot move there. S6 dropped. Side finding, out of scope: a `Workflow` call also skips `delegation-admission.mjs` (PreToolUse:Agent), so a workflow can launch `construct:worker` without an allowed-edit-surfaces check; follow-up for the user.
- **L3 (2026-10-23, parent, T2):** `if: "Bash(git commit *)"` would not match `git -C dir commit`, which the commit signal supports (commit-slice test "git -C and a preceding cd pick the repository"); the handler uses `if: "Bash(git *)"` instead.
- **L4 (2026-10-23, parent, T2 live):** Scratch `claude -p` with the T2 plugin plus a logging handler beside each delivery-signals handler, three Bash calls (`ls`, `git -C . status --short`, `echo done`): three `PostToolBatch` events and one `PostToolUse` (the git call). Claude Code 2.1.309; older versions down to MIN_CLAUDE 2.1.304 not checked.
