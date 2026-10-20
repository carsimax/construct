# odd-assess: one JavaScript and TypeScript extension list

Objective: replace the JS/TS extension lists copied across `lib/assess/` with one shared constant, so adding an extension cannot drift again (the cause of `assess-node-modules` S1). Branch: `refactor/assess-js-extensions`, baseline `f8a3173` (main). Delivery strategy: ask-on-risk. Test runner: `node --test tests/`; `claude plugin validate --strict ./plugins/construct`.

## Specs

- **S1 — One list.** Source: the readability follow-up "the JS/TS extension list is copied into about 12 places (`sinks.mjs`, `signals.mjs`), a shared constant would stop the drift that caused S1" (`odd/tasks/assess-node-modules.md` L5), taken up by the user: "La mejor decicion que favorezca al flujo y aprovechando las capacidades de claude". One exported constant holds `.js .jsx .mjs .cjs .ts .tsx .mts .cts`; every sink extension string and extension list in `lib/assess/` that names JS/TS extensions derives from it. Behavior is unchanged: every existing test passes without edits to expected results.
- **S2 — Drift guard.** A test fails when a sink, or another extension list in `lib/assess/`, names some JS/TS extensions but not all of them. Assumption: a sink that legitimately targets only part of the family does not exist today; if one is found, the worker reports it instead of forcing it.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1, S2 | Shared constant in `lib/assess/signals.mjs`, used by `sinks.mjs` and `signals.mjs`; drift test in `tests/assess/` | odd-worker | 2 | done | see L3 |

Risk item 2: `odd-assess` decides whether a change gets reviewed; a wrong list silently lowers a tier.

## Log

- **L1 (2026-10-20, user):** "La mejor decicion que favorezca al flujo y aprovechando las capacidades de claude" — answer to: drop the todo sync and workflow parity rows, then dedupe the JS/TS extension list.
- **L2 (2026-10-20, parent):** Places found: `signals.mjs:7` (`SEMANTIC_SOURCE_EXTENSIONS`), `sinks.mjs:12,30,32,33,34,42,44,46,48,58` (sink extension strings), `sinks.mjs:84` (slash-comment list). Also carries the uncommitted parity-map update in `odd/tasks/odd-skills-plugin.md` (L42) and `risk-line-gate.md` L10.
- **L3 (2026-10-20):** T1 done. `JS_TS_EXTENSIONS` (frozen, signals.mjs) feeds `SEMANTIC_SOURCE_EXTENSIONS`, all 10 sink strings, and the slash-comment list. Characterization dump of every sink's extension set, the semantic list, and comment detection for 28 extensions: identical before and after. Drift test `tests/assess/js-extensions.test.mjs` shown failing with `.cts` dropped from one sink, then restored. `node --test tests/` 618 pass; plugin validate passed. No existing expectation edited.
