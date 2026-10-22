# Panel default background and 5.5 tuning

Objective: a batch of small changes: drop the panel's fixed background, then Claude Code and 5.5-model optimizations chosen from research. Branch: feat/panel-default-bg-and-5-5-tuning. Delivery strategy: single-pr. Test runner: `node --test tests/` and `claude plugin test plugins/construct`.

## Specs

- **S1 — Panel uses the terminal's default background.** "Quitar la personalización del color de fondo del panel dejarla como esta por defecto". Remove `PANEL_BACKGROUND` (`plugins/construct/hooks/panel/layout.js:58`) and the `backgroundColor` it sets on the panel root Box (`layout.js:430`). Tests in `plugins/construct/tests/panel-layout.test.ts` (lines 127 and 131) assert the root Box has no `backgroundColor`. The **Colors** paragraph in `README.md:250` stops describing a fixed black background. Text colors stay theme keys, unchanged.
- **S2 — Research on Claude Code and 5.5-model optimizations.** "Optimizaciones especificas para claude code y los nuevos modelos 5.5 sobre nuestro sistema". Read-only: compare current Claude Code capabilities and Claude 5.5 model guidance against Construct (contract, hooks, agents, routing, userConfig, skills, output style) and produce a list of concrete proposed changes, each with its reason, edit surfaces, and Risk. No code until the user picks which proposals enter this batch.
- **S3+ — reserved** for the proposals the user selects from S2.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1 | Remove the panel's fixed background; update tests and README | odd-worker (parallel with T2) | none | done (RED 4 fail → GREEN 3 known fail; node --test 724/0) | pending-commit |
| T2 | S2 | Research and proposal list | odd-general + odd-explorer (parallel with T1) | none (read-only) | in progress | — |

## Log

- **L1 (2026-10-21, user):** "vamos a juntar varias cambios pequeños en esta ola de cambios" / "- [ ] Quitar la personalización del color de fondo del panel dejarla como esta por defecto\n- [ ] Optimizaciones especificas para claude code y los nuevos modelos 5.5 sobre nuestro sistema"
- **L2 (2026-10-21, user):** "si investiga primero" (S2 is research first; implementation waits for the user's pick).
- **L3 (2026-10-21):** Baseline `7210afd` on `main`. Known: 3 mod tests in `claude plugin test plugins/construct` fail on clean HEAD (AskUserQuestion permission), per memory.
