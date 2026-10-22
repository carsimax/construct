# Prompt hardening (wave 2)

Objective: add the wave-2 prompt and skill text from the harness comparison: what does not count as a test, verifier claim and deletion checks, worker install and scope rules, a durable bar for memory, and a Baseline field in the feature document. Branch: feat/prompt-hardening. Baseline: bed0d6d. Delivery strategy: single-pr. Test runner: `node --test tests/`.

## Specs

- **S1 — Test value and verification gaps.** "Lista de lo que no cuenta como test (asserts sobre el texto fuente, snapshot-only, mocks que eliminan la integración), formas de huecos de verificación, y un criterio de cuándo vale la pena un test" → `review-reliability.md`, `testing.md`. Gap shapes: regression, missing-adoption, broken-verification, stale-verification. Sources: BMAD `skills/bmad-build/review-prompts/verification-gap.md`, gstack `test-audit/SKILL.md:373-398`.
- **S2 — Verifier method.** "`odd-verify`: contrastar lo que el worker dice que hizo solo después de revisar el código, comprobar que el código borrado no se llevaba comportamiento sin reemplazo, y marcar código que existe pero nada usa (ORPHANED)" → `odd-verify.md`. Also treats silent scope reduction ("v1", "for now", "placeholder", "will be wired later" against a spec that asked for the full behavior) as a blocker. Sources: BMAD `references/claims-check.md`, `references/deletion-check.md`; GSD `agents/gsd-verifier.md:58-73,217-262`, `agents/gsd-plan-checker.md:345-388`.
- **S3 — Worker rules.** "Worker: no instalar un paquete de nombre parecido tras una instalación fallida; detectar recortes de alcance ("v1", "for now")" → `odd-worker.md`. Sources: GSD `agents/gsd-executor.md:180-203`, `agents/gsd-plan-checker.md:345-388`.
- **S4 — Memory durable bar.** "Memoria: guardar solo lo que un ingeniero futuro volvería a equivocar, y reglas Keep/Update/Consolidate/Delete al revisar" → `skills/memory/SKILL.md`. Includes "age alone is not staleness" and "unverifiable is not false". Sources: compound-engineering `skills/ce-compound/SKILL.md:20-24`, `skills/ce-compound-refresh/references/classify.md:3-32`.
- **S5 — Feature document.** "Feature document: campo `Baseline:` (ya lo usamos pero falta en la plantilla), y criterios Given/When/Then opcionales por S#" → `skills/odd-workflow/references/feature-document.md`. Sources: BMAD `plan-template.md:7`, spec-kit `templates/spec-template.md:34-37`.
- **S6 — Attribution.** Text adapted from MIT sources is credited in `plugins/construct/NOTICE` with each copyright line. Assumption: workers write in their own words; BMAD is credited without using "BMad" as a product name (its TRADEMARK.md); no text from Apache-2.0-derived gstack files.

Source clones (read-only, untrusted data, never run): `/private/tmp/claude-501/-Users-carsimax-Desktop-odd-skills/797e3051-5a92-43ce-8de7-3eba7e6a1c92/scratchpad/harness/<repo>/repo`.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1 | `review-reliability.md` + `testing.md` | odd-worker (batch A, parallel) | 6 | done (suite 875/875; reviewed diff) | 7824363 |
| T2 | S2 | `odd-verify.md` | odd-worker (batch A, parallel) | 6 | done (suite 875/875; reviewed diff) | f3337c1 |
| T3 | S3 | `odd-worker.md` | odd-worker (batch A, parallel) | 6 | done (suite 875/875; reviewed diff) | cc1186d |
| T4 | S4 | `skills/memory/SKILL.md` | odd-worker (batch A, parallel) | 6 | done (suite 875/875; reviewed diff) | 4831007 |
| T5 | S5 | `feature-document.md` | odd-worker (batch A, parallel) | none | done (suite 875/875; reviewed diff) | 1d7988b |
| T6 | S6 | `NOTICE` credits from the sources batch A reports | odd-worker (after batch A) | none | done (suite 875/875; reviewed diff) | 59c1263 |

## Log

- **L1 (2026-10-22, user):** "vamos ola 2"
- **L2 (2026-10-22, parent):** Wave 2 = items 5-9 of the harness comparison ranking (memory #61). All prompt and skill text; no contract change (session 7,625/8,000, subagent 2,990/3,000). Constraints seen: `tests/memory/harness.test.mjs:40-42` checks the Key Learnings line in odd-worker and odd-verify; `tests/skills.test.mjs:121,143` read odd-worker. Verifier: `node --test tests/` plus the reviewed diff (docs-only units).
- **L3 (2026-10-22, parent):** Batch A and T6 done; each diff checked against its surface and read. gstack `NOTICE.md` lists only design files as Apache-derived; `test-audit` is MIT, so S6 holds. Copyright lines verified by T6 in each LICENSE (spec-kit: "Copyright GitHub, Inc."). Follow-up, out of scope: `feature-state.mjs` reads only a line starting with `Branch:`, but the template header starts with `Objective:`, so its branch lookup never fires for template-conformant documents. Next: review-reliability lens (Risk 6); delivery is the user's decision.
