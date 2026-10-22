# Panel default background and 5.5 tuning

Objective: a batch of small changes: drop the panel's fixed background, then Claude Code and 5.5-model optimizations chosen from research. Branch: feat/panel-default-bg-and-5-5-tuning. Delivery strategy: single-pr. Test runner: `node --test tests/` and `claude plugin test plugins/construct`.

## Specs

- **S1 — Panel uses the terminal's default background.** "Quitar la personalización del color de fondo del panel dejarla como esta por defecto". Remove `PANEL_BACKGROUND` (`plugins/construct/hooks/panel/layout.js:58`) and the `backgroundColor` it sets on the panel root Box (`layout.js:430`). Tests in `plugins/construct/tests/panel-layout.test.ts` (lines 127 and 131) assert the root Box has no `backgroundColor`. The **Colors** paragraph in `README.md:250` stops describing a fixed black background. Text colors stay theme keys, unchanged.
- **S2 — Research on Claude Code and 5.5-model optimizations.** "Optimizaciones especificas para claude code y los nuevos modelos 5.5 sobre nuestro sistema". Read-only: compare current Claude Code capabilities and Claude 5.5 model guidance against Construct (contract, hooks, agents, routing, userConfig, skills, output style) and produce a list of concrete proposed changes, each with its reason, edit surfaces, and Risk. No code until the user picks which proposals enter this batch.
- **S3 — Panel text weight (P1).** Replace the deprecated `Text` `bold` prop with `weight` (mods reference; deprecated since Claude Code v2.1.299; install minimum 2.1.304). Every `bold` site in `plugins/construct/hooks/panel/` and `hooks/status/`; rendered output unchanged in meaning.
- **S4 — Subagent contract 5.5 lines (P2).** `hooks/contract/subagent.md` states, in the contract's voice and rewriting overlapping lines in place: work continues until everything the prompt asked for is done, stopping only when blocked or before a risky step; no features, tests, files, docs, or refactors the prompt did not ask for; a change is done only after a real check ran, and a syntax-only check does not count. Source: platform.claude.com prompting guides for Sonnet 5.5 and Haiku 5.5.
- **S5 — Session contract names the early stop (P3).** `hooks/contract/session.md` names the early stops to avoid inside an authorized outcome: ending the turn with a text-only progress report, a "Next, I'll…" line, or "Shall I apply this?" while steps remain. Waiting for background agents' notifications stays allowed. Injected text stays at or under 8,000 characters. Source: Opus 5.5 and Fable 5.1 prompting guides.
- **S6 — prettyModel covers new ids (P6).** Tests assert `claude-fable-5-1` → `Fable 5.1` and `claude-haiku-5-5` → `Haiku 5.5`.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1 | Remove the panel's fixed background; update tests and README | odd-worker (parallel with T2) | none | done (RED 4 fail → GREEN 3 known fail; node --test 724/0) | f277689 |
| T2 | S2 | Research and proposal list | odd-general + odd-explorer (parallel with T1) | none (read-only) | done (proposals in L4) | — |
| T3 | S3, S6 | Panel `weight` and prettyModel tests | odd-worker (parallel with T4) | none | done (RED 3 new fail → GREEN 3 known fail; node --test 726/0) | 3e22991 |
| T4 | S4, S5 | Contract 5.5 lines | odd-worker (parallel with T3) | item 6 (prompt behavior no test catches) | done (RED 2 fail → GREEN; node --test 726/0; session 7622/8000, subagent 2905/3000); S4 fix after verify | c71c899, 33853ed |

## Log

- **L1 (2026-10-21, user):** "vamos a juntar varias cambios pequeños en esta ola de cambios" / "- [ ] Quitar la personalización del color de fondo del panel dejarla como esta por defecto\n- [ ] Optimizaciones especificas para claude code y los nuevos modelos 5.5 sobre nuestro sistema"
- **L2 (2026-10-21, user):** "si investiga primero" (S2 is research first; implementation waits for the user's pick).
- **L3 (2026-10-21):** Baseline `7210afd` on `main`. Known: 3 mod tests in `claude plugin test plugins/construct` fail on clean HEAD (AskUserQuestion permission), per memory.
- **L4 (2026-10-21):** T2 research (official sources: platform.claude.com prompting guides for Opus/Sonnet/Haiku 5.5 and Fable 5.1, code.claude.com docs, claude-code CHANGELOG to v2.1.308) plus repo inventory. Proposals for the user's pick:
  - P1: panel `bold: true` → `weight` (`Text.bold` deprecated since v2.1.299; install minimum is 2.1.304). `hooks/panel/draw.js:123` and the other `bold` sites. Risk none.
  - P2: `hooks/contract/subagent.md` adds the Sonnet/Haiku 5.5 lines: a change is done only after a real check ("a syntax-only check does not count"), keep working until the task is done, no unrequested features/tests/docs. Risk item 6.
  - P3: `hooks/contract/session.md` names the Opus 5.5 early stop (a text-only progress report while tasks remain is not a stop). Budget: 7,427/8,000 chars. Risk item 6.
  - P4: replace CRITICAL/MUST emphasis in review/judge agents and skills (guidance written for Opus 4.5+, not 5.5-specific). Risk item 6.
  - P5: per-role effort (all `medium`): measure with `scripts/eval.sh` before changing; Sonnet 5.5 at `medium` may skip verification. Risk item 3 if defaults change.
  - P6: tests for `prettyModel` with `claude-fable-5-1` and `claude-haiku-5-5`. Risk none.
- **L5 (2026-10-21, user):** "si vamos con la primera tanda" (P1, P2, P3, P6 → S3–S6, T3–T4; P4 and P5 out of this batch).
- **L6 (2026-10-21):** Review at 20219d4 (base 7210afd): `review-reliability` approved, no findings. `odd-verify`: S1, S3, S5, S6 pass; S4 fail: `subagent.md:15` "A change is done only after a real check ran" contradicts `agents/odd-worker.md:31,51` (docs-only exception); source scopes it to code that can be run, built, or type-checked, with an exit. T4 reopened for that fix. Follow-ups (advisory, not in this batch): "the prompt did not ask for" relies on the parent passing the Test-first section; the source's "mention it at the end instead of doing it" route is missing for features/docs/refactors; "stops only when blocked" vs the worker's two-attempt `partial` rule. Subagent text margin is ~95 chars.
- **L7 (2026-10-21):** `review-reliability` re-run at 564471e (base 7210afd): approved, no findings (one earlier run hit maxTurns with a 63-char hash; relaunched). S4 fix 33853ed. Batch done; next step is the user's delivery decision.
