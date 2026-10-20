# Review determinism

Objective: move the RDD steps the orchestrator did by hand into code: lens selection, lens context hand-off, result capture, and the Stop gate's view of in-flight reviews; add the normalization rule. Branch: `feat/review-determinism`. Delivery strategy: ask-on-risk. Test runner: `node --test tests/`; `claude plugin validate --strict plugins/construct`.

## Specs

- **S1 — Lenses chosen by code.** "Elegir las lentes por código" (roadmap item accepted with "DAle con todos los cambios"). `odd-review start` without `--lenses` takes the lenses `odd-assess` assigns to the frozen candidate (all four for `high`) and, without `--lenses-reason`, records a reason built from the assessment. A candidate whose tier assigns no lenses (`medium`, `passive`) refuses with a code that says to pass `--lenses`. Passing `--lenses` keeps working as today.
- **S2 — Gate respects in-flight reviews.** "arreglar que el gate respete lineages abiertos". The Stop gate does not block on a target that has an open lineage (any state except `escalated` and `acknowledged`), matching the transaction's `target` or its correction's `target`.
- **S3 — Context injected by code.** "inyectar el contexto en tool.call". A `PreToolUse` hook on `Agent` for `construct:review-*` agents: when the prompt names a lineage (`review-<16 hex>`) and carries no `ODD_REVIEW_CONTEXT`, it runs `odd-review context --lineage L --lens <agent>` and replaces the prompt with that output (assumption: classic hook with `updatedInput` instead of a mod `tool.call`; same effect, testable with `node --test`). A context failure denies the spawn with the `odd-review` error. Other agents pass through untouched.
- **S4 — Results captured by code.** "capturar el resultado de cada lente en SubagentStop". A `SubagentStop` hook for `construct:review-*` agents spawned through S3 pipes `last_assistant_message` (a surrounding code fence removed, nothing else changed) to `capture`, `capture-refuter`, or `capture-validation`. A `malformed_result` or `invalid_result` refusal blocks the stop once per attempt, up to 2 retries, with the validator's message as the next instruction. Already-captured and wrong-state answers count as done.
- **S5 — Skill and docs.** `rdd-review` and its lifecycle reference stop telling the model to pick lenses, paste context, or pipe results; they say to launch each lens with the lineage only and read `odd-review status`. Add the normalization rule: run every source-mutating formatter or hook before `odd-review start`, since any later byte change makes a new candidate. README documents the new hooks and the `start` default.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1 | `start` lens and reason defaults in `lib/review/cli.mjs` and `commands.mjs`, tests in `tests/review/` | inline | none | done | see L3 |
| T2 | S2 | Open-lineage scan in `lib/review/store.mjs`, used by `review-gate.mjs`; tests in `tests/gate/` | inline | 6 | done | see L4 |
| T3 | S3, S4 | `hooks/scripts/review-context.mjs` (PreToolUse Agent) and `review-capture.mjs` (SubagentStop), wired in `hooks.json`; tests in `tests/review-hooks/` | inline | 2 | pending | — |
| T4 | S5 | `rdd-review` skill, lifecycle reference, README | inline | none | pending | — |

## Log

- **L1 (2026-10-20, user):** "DAle con todos los cambios" — after the proposal: hooks 1–3 (SubagentStop capture, context injection on the Agent call, gate respects open lineages), lenses chosen by code, normalization rule in `rdd-review`.
- **L2 (2026-10-20):** Evidence. Docs (code.claude.com/docs/en/hooks): the spawning tool is `Agent` (`prompt`, `description`, `subagent_type`, `model`); `updatedInput` replaces the whole input and combines with `allow` or `ask`; SubagentStop gets `stop_hook_active`, `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`, and `decision: "block"` delivers `reason` to the subagent as its next instruction. Explorer map: lineages live at `<git-common-dir>/odd-review/transactions/<lineage>.json`, no list helper exists; `start` requires `--lenses` via `need()` (`cli.mjs:98`); `capture` is not idempotent (`lens_already_captured`, then `wrong_state`); the gate's `targetOf` equals the transaction `target` (`identity.mjs:17`); SubagentStop is not wired.
- **L3 (2026-10-20):** T1 done. RED: the two new `start` tests failed with `odd-review: --lenses is required` (exit 2). GREEN: `node --test tests/review/` 104 pass. The old "start requires lenses and a reason" test now pins that explicit `--lenses` still needs a reason and a lone reason still needs lenses. Help text updated.
- **L4 (2026-10-20):** T2 done. RED: two new gate tests (open lineage for uncommitted changes and for a committed range) blocked instead of staying silent. GREEN after `openLineageTargets` in `store.mjs` (skips `escalated` and `acknowledged`, includes `correction.target`) and the gate check. A lineage for an older target still lets a changed target block. `node --test tests/gate/ tests/review/`: 131 pass.
