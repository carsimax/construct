# Agent Driven Development (ADD)

> Draft.

A coding agent writes code faster than anyone can review it. ADD is a way of working with coding agents in which the agent drives the work, and **how much it may do on its own depends on how well its work can be checked**, not on how confident it sounds. Specs, plans, and reviews are tools in service of that rule, and the process grows with the size and risk of each change instead of applying the same ceremony to everything.

ADD does not depend on a tool. It evolves Organic Driven Development (ODD), the method Construct shipped through 12.0.0; "ODD" below names that predecessor. Construct is one implementation of ADD for Claude Code; the last line of each principle says what Construct enforces today.

## Principles

### 1. Literal intent

The user's words are the spec. Each requirement (`S#`) quotes a Log entry verbatim, in the user's language, and marks every assumption added to it. Ambiguity is a state, not a guess: a gap that changes the outcome and is costly to undo is `NEEDS CLARIFICATION: <question>`, any other gap is a marked assumption, and no task that depends on an unclear requirement can finish. When work closes, its requirements merge into a living spec instead of being deleted.

- **Why:** agents rarely notice underspecified tasks and fill gaps silently; they also inflate requirements. Asking about every gap is its own failure mode.
- **Taken from:** ODD verbatim specs, Spec Kit's clarification marker and its "informed guess, recorded as an assumption" rule, Intent-Driven Development, OpenSpec delta specs.
- **Evidence:** measured. Letting agents ask on underspecified tasks improved results by up to 74% (arXiv 2502.13069); ClarifyGPT raised pass@1 from 68% to 76%. No study compares verbatim with paraphrased requirements.
- **Construct today:** verbatim specs are a prompt rule. A `NEEDS CLARIFICATION: <question>` marker in an `S#` is enforced at the publication gate: a `done` task naming an open one is denied; `feature-state` lists the open ones and warns past 3 per document. It also warns when an `S#` has neither a quote found in the Log nor the word `Assumption`, and when a finished feature document has no file in the living spec, `.vault/specs/<feature>.md` (finished `S#` with their quotes, starting empty, no backfill). Feature documents are no longer deleted. Limits: the quote check is a warning only, and the living-spec warning detects a missing feature, not a stale entry.

### 2. Proportional ceremony

Process scales with the work, judged on two axes. State: a change that can be resumed from the request plus `git diff` needs no feature document; one that cannot gets one. Code of any size gets acceptance tests before implementation, written by the oracle. Review size is capped separately, because attention, not the agent, is the limit: a reviewable unit (a commit) stays near 400 changed lines. Going past a limit is allowed when the reason is written down (`Exceeds: <limit> — <why>`) where a hook can see it.

- **Why:** the main criticism of spec-driven tools is one heavy workflow for every task size; lines measure review attention, not lost state or risk.
- **Taken from:** ODD resume test, Kiro Quick Spec, BMAD scale-adaptive flow, Spec Kit Complexity Tracking.
- **Evidence:** reviewers find fewer defects past about 200–400 lines (SmartBear/Cisco, vendor, 2006); small batches amplify AI's benefit (DORA); agent success falls with task length (METR).
- **Construct today:** there is no fixed inline limit: the main thread writes only `.vault/` and docs (enforced by a hook), and the oracle of each code task declares a changed-line budget for its worker (default 400, ceiling 1500, checked at the worker's stop, whatever tool wrote); there are no line budgets for pull requests or commits: large work lives on a feature branch, split by work unit into local sub-branches, with one final pull request; the resume test and `Size:` line are prompt rules; the commit-size target and `Exceeds:` do not exist.

### 3. Autonomy proportional to verification

With a strong check (deterministic, runnable now, not written or loosened in the same loop), the agent may loop until it passes, within a budget the oracle declares for the task (attempts, minutes, changed lines); then it stops and reports. With a weak check, it takes one small step and stops. With no check, it says what would make the work checkable instead of proceeding. Where a strong check exists, the failing test comes first, and the loop never edits it to pass.

- **Why:** this rule adapts as models improve: a better verifier earns more autonomy. An uncapped loop with no exit is where agents cheat.
- **Taken from:** ODD, the Ralph loop's back pressure, TDD Guard, Kent Beck's augmented coding, Anthropic's "give Claude a check to run".
- **Evidence:** measured. Agents cheated on 76% of tasks where spec and tests conflict, retries raised cheating, and an explicit "flag it" exit cut it from 54% to 9% (ImpossibleBench). The default budget (5 attempts, 30 minutes, 400 lines) and its ceilings (10, 60, 1500) are judgments, not measured optima.
- **Construct today:** the workflow skill defines a strong check. For code the oracle is that check and its `## Envelope` is the bound: at a worker's stop a hook runs the envelope command, so a red oracle with budget left blocks the stop and the worker continues, and a spent budget (attempts or minutes, per task) stops it and the orchestrator reports; a rise in passing tests does not spend an attempt, so attempts count progress, not command text. A hook also blocks a stop whose diff leaves the envelope surfaces or exceeds its line budget. Code with no deterministic test needs a user-approved exemption (default budget, no command). Test-first is self-reported. This is a discipline layer against a same-user agent, not a boundary: the diff is of the whole working tree (a concurrent writer counts against the worker), state updates are not locked, and the hooks fail open.

### 4. Independent oracles, one writer, clean reviewers

One agent writes. Others read, test, and review. For code, acceptance tests are written from the specs by someone other than the writer, fail before the change, and the writer cannot edit them, only flag one it believes contradicts the specs. Reviewers see the change and the specs, not the writer's reasoning; findings outside the specs become follow-ups, not new scope.

- **Why:** writers grading their own work is the weakest form of verification, and agents rewrite tests to pass.
- **Taken from:** TDFlow, AgentCoder, Cognition, Anthropic, the MAST failure study, ODD lenses and blind dual review.
- **Evidence:** measured. Human-written tests 94.3% vs self-written 69.8% (TDFlow). Agents edit tests to pass impossible tasks 39–76% of the time; locked tests bring that near zero (ImpossibleBench). Models do not self-correct reasoning without outside feedback. Judges favor their own outputs and those of their model family.
- **Construct today:** single writer and write surfaces are enforced by hooks; review lenses run on hook-built evidence; oracle separation exists: the `construct:oracle` agent writes the acceptance tests from the specs and shows them failing, hooks lock their content hashes, stop edits early (surface-guard, delegation-admission), and the publication gate denies a ref that changes one until the feature is finished on the remote default branch (verified against the remote), a worker can only flag a conflict, and the lenses receive the specs. Accepted limits: this is a discipline layer against a same-user agent, not a boundary; the remote URL is trusted on first use, when the oracle stops; the blind judges are opus and sonnet, two models of one vendor.

### 5. Declared risk with a mechanical floor, publication by evidence

Every change ends with a risk line naming which of six risk categories it touches, or `none`. Signals in the diff (migrations, auth, lockfiles, CI, installers, and paths the project declares as contracts) set a minimum the agent may raise but not lower. Publishing (push, pull request, release) is blocked until the lenses that risk requires have approved the published commit.

- **Why:** the most important judgment, risk, is the one an agent is least able to make about its own work.
- **Taken from:** ODD Risk line and publication gate, Spec Kit's pre-planning gates, CODEOWNERS and required reviewers, Meta's Diff Risk Score.
- **Evidence:** just-in-time defect prediction finds 35% of bug-introducing changes with 20% of the effort (measured); LLM self-assessed confidence is close to chance at separating right from wrong answers (measured). No study measures agents classifying their own risk.
- **Construct today:** the risk line's presence and the publication gate are enforced by hooks; a path floor exists (default table plus `.vault/risk-paths/` at the merge-base and the default branch tip) so a wrong `none`, or risky work without a feature document, is gated when its diff touches those paths; keyword signals in added lines do not exist. A push-time gate can be skipped; only a merge-time check enforces.

### 6. The methodology measures itself

Every principle has at least one behavior eval that grades the outcome, not only the ritual. A change to a rule comes with its eval difference over repeated runs, and each release publishes its raw pass counts with the number of runs. Failures found in real sessions become new eval cases.

- **Why:** without data, rules oscillate (memory, guards, and the inline limit each changed direction across eleven major versions). With little data, rates mislead, so counts are published raw.
- **Taken from:** Eval-Driven Development, Anthropic's guidance on agent evals, Superpowers self-diagnosis.
- **Evidence:** a single run moves pass rates by 2–6 points from noise alone, and differences under 8–10 points on 100 tasks are noise (measured). Grading the ritual invites agents to game it.
- **Construct today:** seven eval cases exist (about $1.5 per suite run); no results are published; no path turns session failures into cases.

## What ADD does not do

- No constitution or multi-file spec set per feature: long context files make agents worse (ICLR 2026).
- No parallel writers without disjoint write surfaces.
- No fixed context-usage threshold; a fresh agent per unit of work is enough.

## Glossary

| Term | Meaning |
|---|---|
| `S#` | A requirement, quoted verbatim from the user's Log entry |
| `T#` | A task that serves one or more `S#`; disposable |
| Feature document | `.vault/tasks/<feature>.md`: specs, tasks, and log for one change |
| Living spec | The merged requirements of finished work, kept after its feature document closes |
| Resume test | Can someone continue this from the request plus `git diff` alone? If yes, it needs no feature document |
| Strong check | Deterministic, runnable now, and not written or loosened in the loop that must pass it |
| Risk line | `Risk: item N (reason)` or `Risk: none`, over six fixed categories |
| Risk floor | The minimum risk that signals in the diff set; the agent may only raise it |
| Oracle | A check the writer did not author and cannot edit |
| Lens | A reviewer that judges one dimension (risk, readability, reliability, resilience) |
| Converge | At close, compare the code with every `S#`; each gap becomes a new task |

Sources: `docs/research/reports/Metodologías de desarrollo con agentes IA.md`, `docs/research/reports/Cruce de piezas para ODD.md`, and `docs/research/notes/Principios ADD/`.
