# Oracle separation

Objective: for risky work, acceptance tests are written from the specs by an oracle agent that is not the writer, hook-locked by content hash, and protected from edits until the feature is finished (ADD P4). Branch: feat/oracle-separation. Baseline: 12a4964. Delivery strategy: ask-on-risk; chains: stacked-to-main. Test runner: node --test 'tests/**/*.test.mjs'.

## Specs

- **S1 — Oracle agent.** "Vamos con ello" (design approved in conversation): a new `construct:oracle` agent writes acceptance tests from the feature document's `S#`, shows them failing against the baseline, never implements; model and effort configurable through `model_oracle` and `effort_oracle`. "Dejarlo configurable pero analizar del modelo por defecto entre sonnet haiku o opus 5.5 con nivel de pensamiento medio": the frontmatter default is `opus` with `effort: medium` (assumption: decided from the analysis in L2).
- **S2 — Lock record.** When an oracle agent stops, a hook records the content hash of every path in its allowed edit surfaces (exact paths only) in the review store, keyed by feature document and task. Agents cannot write the record.
- **S3 — Protect only.** "Solo proteger": the publication gate denies publishing when a locked oracle's content at the published ref differs from its recorded hash or the path is gone; it never requires that an oracle exist. A lock applies only while its feature document has unfinished tasks.
- **S4 — Early stops.** surface-guard denies Write/Edit of a locked oracle from any agent or the main thread; delegation-admission denies a writer whose surfaces include a locked oracle, and an oracle launch over an already locked path.
- **S5 — Human unlock.** `construct-gate oracle list | unlock <path>` lists and releases locks; command-guard denies `unlock` when an agent runs it.
- **S6 — Flag exit.** A worker that believes a locked oracle contradicts the specs returns `oracle_conflict` (path, test, spec) instead of editing it; the parent relays it to the user whole.
- **S7 — Spec-aware reviewers.** Review lenses receive the branch's `S#` sections and the list of locked oracles; findings outside the specs become follow-ups.
- **S8 — Measured.** An eval case where spec and test conflict passes when the agent flags the conflict instead of editing the test.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1, S2, S3 | Oracle agent and role, oracle-record hook, store area, gate lock check (PR 1) | worker | 2, 3 | pending | — |
| T2 | S4, S5 | surface-guard and delegation-admission stops, `construct-gate oracle` CLI, command-guard deny (PR 2) | worker | 2, 3 | pending | — |
| T3 | S7 | review-context passes specs and locked oracles; skill-context lists locks (PR 3) | worker | 3 | pending | — |
| T4 | S6, S8 | worker `oracle_conflict`, workflow/delegation/review skills, contracts, eval case, README/METHODOLOGY/CHANGELOG (PR 4) | worker | 3 | pending | — |

## Log

- **L1 (2026-10-28):** "Vamos con ello analiza bien la mejor estrategia y dime bien qué se agrega ejemplo (skills, agentes,hooks,etc)"
- **L2 (2026-10-28):** "1. Solo proteger 2. Dejarlo configurable pero analizar del modelo por defecto entre sonnet haiku o opus 5.5 con nivel de pensamiento medio". Default chosen: opus, medium. Worker defaults to sonnet, so an opus oracle is a different model from the writer (judges favor their own model's output); a wrong locked test costs a user interruption per conflict, so test quality outweighs cost; the oracle runs once per risky task with a small output; haiku is too weak at turning specs into deterministic tests. Same choice as the other checking roles (verifier, review-risk).
- Next step: T1 through construct:worker.
