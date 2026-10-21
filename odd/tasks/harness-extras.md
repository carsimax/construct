# Harness extras

Objective: port the useful extras of gentle-shell (Gentleman-Programming/gentle-shell, MIT, studied read-only) to Construct's mod, and simplify the panel. Branch: `feat/harness-extras`, baseline `059cf37` (main); `36973a6` carries the cost removal (flightdeck-panel T7). Delivery strategy: ask-on-risk. Test runner: `claude plugin test plugins/construct` (mod), `node --test tests/` (repository).

Mods API checked in `plugins/construct/.claude-plugin/types/claude-code/index.d.ts` (2.1.305): `$.ui.toast` (2468), `$.ui.notify` (2486), `$.command.register`, `$.process.run`.

## Specs

- **S1 — Agents card.** "dejale un nombre mas sencillos por ejemplo sin el odd_ y pon el modelo que esta usando". The agents section is one card like the others: title `agents`, status `N running · M total`. One row per agent: running or done mark, a short name, the routed model (as `prettyModel` writes it) with its effort meter, and the elapsed time. The short name is the role without the `odd_`/`odd-` prefix and without `construct:`, with underscores turned into dashes (`odd_worker` → `worker`, `review_risk` → `review-risk`); an agent with no construct role shows its subagent type. Up to 6 rows, then `+N earlier`. Assumption: the lane bars go, to make room for the model.
- **S2 — No last turn card.** "la seccion de last turn no le veo sentido". The last turn card and the receipt it reads are removed from the layout and the state. `turn.start` and `turn.complete` still mark subagents running and done. Assumption: `SCHEMA_VERSION` stays 3; `merge` drops a stored `receipt`.
- **S3 — No animations.** "las animaciones tampoco son tan relevantes". The animated rails and the ticking clocks (the `Client` modules `rail.tsx` and `elapsed.tsx`, and `realize` in `register.js`) are removed. Clocks are static text computed at each redraw. Assumption: the rails between cards go too; card borders separate the sections.
- **S4 — Consistent cards.** "dale un diseño de card mas consistente". Every section is drawn with `card()`: round border, bold title left, status right, the same width.
- **S5 — ODD phase.** The main card's busy status names the phase, derived from the running agents' roles: `verify` → verifying, `review-*` or `jd-*` → reviewing, `worker` or `jd-fix-agent` → implementing, `explorer` → exploring, any other → working. With no running agent it stays `● busy`. A pure selector in `state.js`.
- **S6 — Notifications.** A `userConfig` boolean `notifications`, default `true`. When a subagent completes: a toast `<short name> done in <elapsed>`. When a main turn completes after 60 s or more: a toast and a native `$.ui.notify` `Turn done in <duration>`. Failures are swallowed. Assumption: no notice for permission prompts (Claude Code raises its own) and no sound.
- **S7 — Resume notice.** On `session.start`, when an unfinished feature document exists, one toast: `Resume <feature>: <task id> <title> (<n> open)`.
- **S8 — `/construct doctor`.** Prints one line per check, `✓` or `✗` with a fix hint: Claude Code ≥ 2.1.304, Node ≥ 20, `engram@engram` enabled, a CodeGraph index (`.codegraph/`) at the project root, `odd-review` and `odd-assess` runnable, and the RDD mode. Checks run in parallel, each with a timeout, and a failed check never throws. The check logic is pure (`hooks/status/doctor.js`); `register.js` only runs the commands.
- **S9 — Docs.** README covers the agents card, the phase, notifications, the resume notice, and `/construct doctor`; `plugin.json` declares `notifications`.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1, S2, S3, S4, S9 | Panel redesign: agents card, drop last turn and receipt, drop Client modules and rails, README | odd-worker | none | done | see L3 |
| T2 | S5, S9 | ODD phase selector and main card status, README | odd-worker (after T1) | none | done | see L4 |
| T3 | S6, S7, S9 | Notifications and resume notice: pure helpers, `register.js` wiring, `userConfig`, README | odd-worker (after T2) | 6 | todo | |
| T4 | S8, S9 | `/construct doctor`: pure checks and command wiring, README | odd-worker (after T3) | none | todo | |

Route evidence: T1, T2 and T3 all edit `layout.js`, `state.js`, `register.js` or README, and T4 edits `register.js` and README, so they run in sequence. Risk item 6 for T3: toasts and native notifications have no check against a live session.

## Log

- **L1 (2026-10-20, user):** "ahora propon cosas que pueden aportar a nuestro harness, y queria verque podemos portar con mods lo que hace https://github.com/Gentleman-Programming/gentle-shell con pi agent". Analysis: gentle-shell's core (contract, guards, delegation admission, routing, review, memory) is already in Construct; candidates were notifications, model profiles, ODD phase, doctor, per-role usage, resume notice, a compact band, and a changes viewer.
- **L2 (2026-10-20, user):** "Vamos con ello tambien agrega un arreglo a la tabla de agentes, dejale un nombre mas sencillos por ejemplo sin el odd_ y pon el modelo que esta usando y dale un diseño de card mas consistente, la seccion de last turn no le veo seintido, las animaciones tampovo son tan relevantes". Accepted: notifications, ODD phase, doctor, resume notice (the recommended first package), plus S1-S4. Model profiles and per-role usage stay for a later feature.
- **L3 (2026-10-20, T1, S1-S4 S9):** Agents `card()` with short names (`shortName` in `layout.js`), routed model and effort meter, static elapsed; lane bars, `lanes`/`laneBar`, the last turn card and the receipt removed; `mainBusy` now reads a stored `turn: { turnId } | null` flag set by main `turn.start` and cleared by `turn.complete`; `merge` drops a stored `receipt`. `rail.tsx`, `elapsed.tsx`, `realize` and every `Client` element deleted; the changes card lost its `marginTop` (`CHANGES_FRAME_ROWS` 4 → 3) so all cards stack alike; `tests/panel-license.test.mjs` lists only `draw.js`, `layout.js`, `state.js`. RED: `claude plugin test plugins/construct` 151 pass, 4 fail (the four new agents, last turn and no-Client tests). GREEN: 143 pass, 0 fail; `node --test tests/` 1214 pass, 0 fail; `claude plugin validate --strict ./plugins/construct` passed.
- **L4 (2026-10-20, T2, S5 S9):** Slice boundary: T1 alone was 854 changed lines, mostly deletions; risk none, so delivery continues on this branch (`odd-assess --base-ref main`: `review_due` false). T2: `phaseOf` and `shortName` in `state.js` (`layout.js` imports them); `jd-fix-agent` counts as implementing. RED: `claude plugin test plugins/construct` 98 pass, 3 fail (`panel-state.test.ts` did not load, the phase layout test, the busy main card test). GREEN: 147 pass, 0 fail; `node --test tests/` 1214 pass, 0 fail.
