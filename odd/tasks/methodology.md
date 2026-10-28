# Methodology

Objective: write ODD as a standalone methodology, independent of the Construct plugin, from the research cross of agent development methodologies. Branch: docs/methodology. Baseline: 0da762d. Delivery strategy: single-pr. Test runner: node --test 'tests/**/*.test.mjs'.

## Specs

- **S1 — Own methodology.** "la base de este research es para que tu me ayudes a convertir odd en nuestra porpia metologia"
  - Given `METHODOLOGY.md` (assumption: repository root; the user did not choose a location) When a reader who has never used Construct reads it Then they can state each principle, why it exists, and what it requires, without reading plugin code.
- **S2 — Best pieces crossed.** "de cada metologia saquemos las mejores piezas de cada uno y crucemos"
  - Each principle names the methodologies it takes pieces from and the evidence level behind it (source: `docs/research/reports/Cruce de piezas para ODD.md`).
- **S3 — Name.** "Agent Driven Development te parece bien ese nombre?"
  - Decided: "nuestra metodologua se va llamar Agent Driven Development (ADD)". Applied to `METHODOLOGY.md`; ODD is named there as the predecessor. Renaming the plugin (contract, skills, `odd/` paths, tests) is out of scope here.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1, S2 | Draft `METHODOLOGY.md`: principles, why, requirements, conformance today, glossary | inline | none | done | — |
| T2 | S1 | User approves or edits each principle | inline | none | done | — |
| T3 | S3 | Decide the name and apply it to `METHODOLOGY.md` | inline | none | done | — |

## Log

- **L1 (2026-10-27):** "Pyedes lanzar un research sobre las siguientes metodologias: SDD, ODD, EDD, IDD, CDD, RDD, VSD. dejalos bien documentados ya que la base de este research es para que tu me ayudes a convertir odd en nuestra porpia metologia" — narrowed: "Solo enfocate en los mas populares y similares a ODD Y SDD busca primero todas las metodologias y marcos de desarrollo con agentes".
- **L2 (2026-10-27):** "de cada metologia saquemos las mejores piezas de cada uno y crucemos" → `docs/research/reports/Cruce de piezas para ODD.md`.
- **L3 (2026-10-27):** "como podemos empezar a partir que aqui" → plan: close fix/audit-round, write the text, conformance table, baseline evals, pieces by priority, align docs.
- Out of scope here: implementing any piece (risk floor, oracle separation, living spec); each gets its own feature document. Baseline evals wait for the user's OK (they spend real usage).

- **L4 (2026-10-27):** "Te comento que nuestra metodologua se va llamar Agent Driven Development (ADD)"

- **L5 (2026-10-27):** "Necesito que para cada principio tu me ayudes a decidir, con un research rapido para ello" → `docs/research/notes/Principios ADD/`; all six came back CHANGE.
- **L6 (2026-10-27):** "ok con esto que sigue" — read as: apply every proposed text, with the writer's flag on bad oracles (P4), option (a) for P2 (keep the 1,500-line PR budget, ~400-line commits), and the living spec moved from P6 to P1.

- **L7 (2026-10-27):** "a" — research moved to `docs/research/` (reports and notes).

Next step: user commits this branch and opens the pull request; then baseline evals (needs OK).
