# Vault

Objective: the per-repository working directory becomes `.vault/` with container folders `tasks/`, `specs/`, and `risk-paths/`, with no backward compatibility, and the methodology text reads ADD instead of ODD. Branch: feat/vault (sub-branches feat/vault-t<n>). Baseline: eed9bde. Test runner: node --test 'tests/**/*.test.mjs'.

## Specs

- **S1 — `.vault/` replaces `odd/`.** "podemos considerar cambiar la carpeta odd por .vault esto va en linea con lo que ahora vamos a guardar y lo que haga falta a futuro, sin retrocompatibilidad asumo que en los proyectos las carpetas odd quedaran obsolteas y sin referencia". Every hook, CLI, skill, agent, contract, eval, and test reads and names `.vault/`; nothing reads `odd/` any more; an existing `odd/` folder is left on disk untouched.
- **S2 — Container folders.** "task, risk-path y spec mas biene esten los archivos dentro de carpetas es decir task,risk-path y specs deberia ser carpetas contendoras". Layout: `.vault/tasks/<feature>.md` (feature documents, as before); `.vault/specs/README.md` (purpose and `Started: <YYYY-MM-DD>`) plus `.vault/specs/<feature>.md` (the living spec of each finished feature); `.vault/risk-paths/*` (rule files, each line `<glob> <items>`, all files combined).
- **S3 — Living spec per file.** "Si vamos asi" (L3). The living-spec warning checks that `.vault/specs/<feature>.md` exists for a finished feature document, with the `Started:` cutoff read from `.vault/specs/README.md`; no warning while `.vault/specs/README.md` is absent. Assumption: this replaces the `## <feature>` heading check of living-spec S4; the locked oracle tests of living-spec (released: that feature is finished on main) are updated to the new layout as a recorded spec change.
- **S4 — Risk paths per folder.** "Si vamos asi" (L3). The publication gate reads every file under `.vault/risk-paths/` at the merge base and at the default-branch tip (never the ref); a malformed line in any file denies, naming the file.
- **S5 — Hidden folder works.** "Si vamos asi" (L3). Assumption: tests prove each hook, the risk floor globs, the review context, and the CLI find `.vault/` content despite the leading dot.
- **S6 — ADD text.** "Si vamos asi" (L3, level A). "Organic Driven Development" and "ODD" in prose become "Agent Driven Development" and "ADD"; internal `ODD_REVIEW_*` markers stay. Assumption: historical entries (CHANGELOG releases, `docs/research/`, `reference/`) are not rewritten.
- **S7 — This repository and the release.** "Si vamos asi" (L3). This repository's active files move to `.vault/` with `git mv`; its finished feature documents stay in `odd/tasks/` (L5) (`odd/spec.md` becomes `.vault/specs/README.md`; `odd/risk-paths` becomes `.vault/risk-paths/hooks.txt`). Release 13.0.0 with a one-line migration note (`git mv odd .vault`, then move `spec.md` and `risk-paths` into their folders).

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1, S2, S3, S4, S5 | Hooks, CLI, evals, and tests: `.vault/` paths, specs and risk-paths folders, no `odd/` reads | worker | 3 | done | 7b7090c |
| T2 | S1, S6 | Skills, agents, contracts, README, CLAUDE.md, CONTRIBUTING, METHODOLOGY, CHANGELOG: `.vault/` and ADD text | worker | 3 | done | 706e20d |
| T3 | S7 | Move this repository's `odd/` to `.vault/` | inline | 3 | done | (this commit) |

## Log

- **L1 (2026-10-28):** "para lo ultimo podemos considerar cambiar la carpeta odd por .vault esto va en linea con lo que ahora vamos a guardar y lo que haga falta a futuro, sin retrocompatibilidad asumo que en los proyectos las carpetas odd quedaran obsolteas y sin referencia"
- **L2 (2026-10-28):** "y considera que task, risk-path y spec mas biene esten los archivos dentro de carpetas es decir task,risk-path y specs deberia ser carpetas contendoras"
- **L3 (2026-10-28):** "Si vamos asi" (plan: level A text rename, `.vault/` with container folders, no backward compatibility, 13.0.0).
- **L4 (2026-10-28):** T1 did not write its new tests RED first (the rename went in before them). T3 moved this repository with `git mv`; `odd/risk-paths` became `.vault/risk-paths/hooks.txt`.
- **L5 (2026-10-28):** Moving the 21 old feature documents passed the 400 KB review-context budget (~500 KB of diff). Answer: "Dejar los viejos en odd/": this repository's finished documents stay in `odd/tasks/` as an unused archive, like other projects; only `vault.md`, `spec.md` (now `.vault/specs/README.md`) and `risk-paths` (now `.vault/risk-paths/hooks.txt`) move.
- Next step: review and the final PR, then release 13.0.0.
