# Configurable slice

Objective: let users work with bigger slices: a configurable PR slice budget and a higher inline edit limit, both defaulting to the user's ranges. Branch: feat/configurable-slice. Baseline: 9865c50. Delivery strategy: single-pr. Test runner: node --test 'tests/**/*.test.mjs'.

## Specs

- **S1 — Configurable PR slice.** "por pr: 1000-1500" / "configurable con los valores que solicite por default"
  - Given a new userConfig number option `slice_lines` (default 1500; assumption: the top of the 1000-1500 range, so the notice fires only outside the range) When a commit on a feature branch passes it Then delivery-signals reports the slice notice against the option value (read from `CLAUDE_PLUGIN_OPTION_SLICE_LINES`; unset or invalid falls back to the default, as `inline_edit_max_lines` does).
  - Skills (`delivery`, its `chains.md` reference), README, and the CONTRIBUTING consistency row name the option and the new default; tests follow.
- **S2 — Higher inline edit limit.** "lineas por archivo 100-150" / "configurable con los valores que solicite por default"
  - Given `inline_edit_max_lines` default 150 (assumption: the per-file range maps to the existing per-call inline limit, top of the range) When the main thread changes up to 150 lines in one call Then surface-guard allows it; 151 is denied. The option stays configurable.
  - plugin.json default, surface-guard default, session contract, `workflow`/`delegation` skills, README, and tests follow.
- **S3 — Release.** Minor release 8.7.0 per CONTRIBUTING Releases (assumption: new option plus changed defaults is a minor bump).

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1 | `slice_lines` option (default 1500) in delivery-signals, plugin.json, skills, README, CONTRIBUTING row, tests | worker | 3 | done | 13695a0 |
| T2 | S2 | `inline_edit_max_lines` default 150 in plugin.json, surface-guard, contract, skills, README, tests | worker | 2-3 | done | c6797f8 |
| T3 | S3 | Release 8.7.0: version, install.sh ref, CHANGELOG, README upgrading note, install test fixtures | worker | 5 | done | COMMIT3 |

## Log

- **L1 (2026-10-24):** "Quiero adaptar esto a que se pueda trabajar con slices mas grandes mi rango de cambios en mis proyectos mi rango es mas alto: lineas por archivo 100-150 por pr: 1000-1500" — then on the option question: "configurable con los valores que solicite por default".
- CONTRIBUTING.md:85 (this repo's own ~400-line PR guideline) is left unchanged: out of scope.

Next step: T1 and T2 through one worker (shared surfaces: plugin.json, README), then T3.
