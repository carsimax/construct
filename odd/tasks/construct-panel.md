# Construct panel

Objective: replace the status band with a docked mod panel modeled on claude-flightdeck, adapted to the ODD flow. Branch: `feat/construct-panel`, baseline `3a46451` (main). Delivery strategy: ask-on-risk. Test runner: `claude plugin test plugins/construct` (mod), `node --test tests/` (repository).

Reference: github.com/scasella/claude-flightdeck v0.4.0 (MIT), studied read-only; no code is copied. Mods API checked in `plugins/construct/.claude-plugin/types/claude-code/index.d.ts` (Claude Code 2.1.304): `Pane`, `$.ui.open`/`close`/`panes`, `tool.check`, `tool.call`, `session.compact`, `atom`, `$.command.register`, `$.clock.every` exist.

## Specs

- **S1 — A docked panel replaces the band.** "quiero que con mods implementemos algo como https://github.com/scasella/claude-flightdeck esto en remplazo y mejora a lo que tenemos de la banda inferior", then "Quiero el panel". A `Pane` with id `construct` docks beside the transcript. The `/construct` command opens it and `/construct close` closes it. Assumption: the `AbovePrompt` band shrinks to one summary line: ctx %, running agents, the active ODD task, the RDD state, and an inline-write alert when there is one. The replica rule stays as it is: budget and where are drawn only when the user has no `statusLine`, and in the panel they go in the main section.
- **S2 — Agents by role.** Assumption, from the accepted proposal: one card per subagent, built from `agent.spawn`, `turn.step` and `turn.complete`. A card shows the role (construct role, or the subagent type for other agents), the routed model and effort, ctx (the latest request's whole input: uncached, cache read and cache write), steps, elapsed time, and running or done. Up to 3 cards; any others go in one summary row.
- **S3 — Inline-write detector.** Assumption, from the accepted proposal: a main-thread `tool.call` (`agentId` undefined) of `Edit`, `Write`, `MultiEdit` or `NotebookEdit` on a path outside `odd/tasks/` counts as an inline write. The panel shows the count and the last path in the error color. It only observes and never blocks.
- **S4 — Permission gate.** Assumption, from the accepted proposal: one cell per `tool.check` verdict in the session, colored for allowed, asked, denied, or made inside a subagent. It also shows the deny count and the last denied tool, with credential-like values masked.
- **S5 — Turn receipt.** Assumption, from the accepted proposal: for the running or last main-thread turn it shows duration, agents spawned, edits, errors, and the cost added.
- **S6 — ODD and RDD sections.** The active feature with its first unfinished task, id and title, plus the open count. The RDD mode and state come from the data the band already gathers.
- **S7 — Layout by width.** Wide (two columns from 110 columns), compact, and mini. A section with nothing to show takes no room. Tests render at 40, 80 and 120 columns.
- **S8 — Observe-only state, config and docs.** Every new hook passes its event to `next` unchanged; the existing routing hooks stay as they are. Panel state lives in `atom`s with a schema version, and its logic is pure functions outside `register.js`. Assumption: a `panel_open_on_start` boolean in `userConfig`, default `false`. README documents `/construct` and the panel.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S2, S3, S4, S5, S8 | Pure panel state: event reducers in `hooks/panel/state.js` with mod tests | odd-worker | none | done | `21ddf18` |
| T2 | S6, S7 | Pure panel layout: element trees per section and width in `hooks/panel/layout.js`, task title in `hooks/status/tasks.js`, with mod tests | odd-worker (after T1) | none | done (uncommitted) | — |
| T3 | S1, S8 | Wire `register.js`: hooks, atoms, `/construct`, `Pane` render, one-line band, `userConfig`, README | odd-worker (after T2) | 6 | pending | — |

Route evidence: T2 renders T1's state shape, and T3 wires both, so the three run in sequence. Risk item 6 for T3: hook wiring has no end-to-end check against a real session.

## Log

- **L1 (2026-10-20, user):** "Podemos hacer un cambio quiero que con mods implementemos algo como https://github.com/scasella/claude-flightdeck esto en remplazo y mejora a lo que tenemos de la banda inferior que tenemos puedes analiar https://github.com/scasella/claude-flightdeck y que podemos implemetar y adecuar para que acople mejor a nuestro flujo?"
- **L2 (2026-10-20):** Analysis. Flightdeck is a mods-only plugin that builds its pane from engine events (`agent.spawn`, `turn.step`, `tool.check`, `tool.call`, `session.compact`) kept in `atom`s. It reads no git and no transcript. Our band reads outside state (git, `odd/tasks`, `odd-review`, `odd-assess`) and caches it on `session.start` and `turn.complete`. Proposed: agents by role, an inline-write detector, the gate, a turn receipt, a richer ODD line, our meters and git kept, and flightdeck's pure-core, atom and width-aware layout patterns.
- **L3 (2026-10-20, user):** "Quiero el panel". The answer to "a docked panel with the band as a compact summary, or everything inside the band?"
- **L4 (2026-10-20, T1, S2 S3 S4 S5 S8):** `hooks/panel/state.js` and `tests/panel-state.test.ts`. RED: `claude plugin test plugins/construct` failed with `panel-state.test.ts: cannot import "../hooks/panel/state.js"` (36 pass, 1 fail). GREEN: 63 pass, 0 fail in the mod tests; `node --test tests/`: 558 pass, 0 fail.
- **L5 (2026-10-20, T2, S6 S7, rendering of S2-S5):** `hooks/panel/layout.js` (`buildPanel`, `buildSummary`, `layoutFor`), exports in `hooks/status/format.js`, `activeWork` in `hooks/status/tasks.js`, `tests/panel-layout.test.ts`. `activeFeature` keeps its `{feature, open}` shape because an existing test asserts it with `toEqual`; the task title comes from the new `activeWork`. RED: `claude plugin test plugins/construct` failed with `panel-layout.test.ts: cannot import "../hooks/panel/layout.js"` (63 pass, 1 fail). GREEN: 80 pass, 0 fail in the mod tests; `node --test tests/`: 558 pass, 0 fail.
