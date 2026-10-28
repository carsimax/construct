# Band one row

Objective: the status band above the prompt becomes one row (status, ADD feature with its checkpoints, running agents) with no task title, no permission gate, and no inline count (design option D, canvas https://claude.ai/artifact/MoMwRC8rQwzg1xZzhMuHD9). Branch: feat/band-one-row. Baseline: 4830ec6. Test runners: `claude plugin test plugins/construct` (mod) and `node --test 'tests/**/*.test.mjs'`.

## Specs

- **S1 — One row.** "Podemos hacer una propuesta de diseño de algo que solo quepa en una fila". `buildBand` returns at most one row: `<status> · ADD <feature> <checkpoints> · <agents>`, each part present only when it has content; the second agents row and the `maxRows` input are gone. When the row does not fit it is clipped with `…` as today.
- **S2 — No task id or title.** "El id de la tarea actual en negrita y su título, se va". The feature part keeps `ADD <feature>` and the checkpoint glyphs; the current task's id and title are not drawn.
- **S3 — No gate.** "tambien los gates se van para lo ajustes en tu propuesta". No `gate N pending`, `gate ✓ N`, or `✗ N` segment. A permission prompt still shows as `◆ waiting on you`: `tool.check` with an ask on a real call sets `blocked`, and a settled call or a new turn clears it, as today. The verdict tally (`gate` in the band state, `onToolCheck` counting, `onToolSettle`, `bucketOf`, `MAX_PENDING`) is removed.
- **S4 — No inline count.** Assumption (the user did not object to the plan that listed it): `⚠ N inline` goes with the gate; the `inline` state, `onToolCall`, and `isOutsideTasks` are removed, and `filePathOf` too when nothing else uses it.
- **S5 — Agents segment.** "si m gusta la D". With one running agent: its kind glyph, short name, and elapsed time (`⚒ worker 1:42`). With two or more: `N agents` and the oldest one's elapsed time (`3 agents 1:42`). Agent models are not drawn; `prettyModel` and the per-kind verbs are removed when unused.
- **S6 — Stored state repairs.** A stored band value that still holds `gate` or `inline` (same `SCHEMA_VERSION`) merges to the new shape without error; `SCHEMA_VERSION` stays 1. `types/construct.d.ts` drops `gate` and `inline`.
- **S7 — Docs.** README ("Status band" bullet and the "Construct band (mod)" section, including width rules) and the CHANGELOG `Unreleased` section describe the one-row band.

- **S8 — Plugin version.** "podemos poner un pequeño indicador de la vx.x.x del plugin"; placement "ok vamos con eso" (L2). The band row draws `v<X.Y.Z>` dim at its right edge, only when the band is already shown (an idle band stays hidden); it is the first part dropped when the row does not fit. `/construct doctor` also reports the plugin version. The version is a constant in the mod; a test fails when it differs from `plugins/construct/.claude-plugin/plugin.json`, and CONTRIBUTING's release steps name the constant.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1, S2, S3, S4, S5, S6, S7 | One-row band: layout, state, register wiring, types, mod tests, README, CHANGELOG | worker | 3 | done | a6ee5bf |
| T2 | S8 | Plugin version at the band's right edge and in `/construct doctor`; VERSION constant pinned to plugin.json by a test; release step | worker | 3 | done | (this commit) |

## Log

- **L1 (2026-10-28):** Design options A–D prototyped on the canvas; the user chose D and asked to drop the gate too ("tambien los gates se van para lo ajustes en tu propuesta"), then "si m gusta la D pero priemro asegura el plan". Risk 3: the band state and the `tool.call`/`tool.check` hooks are shared with the `blocked` flow that draws `◆ waiting on you`.
- **L2 (2026-10-28):** T1 committed (a6ee5bf). Version indicator: right edge, dim, only with the band visible, also in `/construct doctor`; source a constant plus a test against plugin.json (no new `$` call). "ok vamos con eso, comit de t1 y sigue".
- **L3 (2026-10-28):** T2: the worker could not pin VERSION from a mod test (mod tests import only .js/.ts and claude-code); the pin is the root test tests/version.test.mjs, written inline and seen RED with a mismatched VERSION. Doctor header shortened to `Construct doctor v<version>`. The worker wrote the band and doctor tests after the code (no RED for those).
