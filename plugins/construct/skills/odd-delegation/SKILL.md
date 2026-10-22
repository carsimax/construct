---
name: odd-delegation
description: "When and how an ODD orchestrator delegates to construct agents: mapping, writer, verification, and per-action triggers, allowed edit surfaces, parallel writers, and handoff prompts. Trigger: deciding whether to delegate, launching an explorer, worker, or verifier, or writing a delegation prompt."
license: MIT
metadata:
  author: Construct
  version: "1.0"
---

## Activation Contract

Load this skill before launching any subagent for ODD work, or when deciding whether a delegation trigger holds.

## Hard Rules

- The parent orchestrates and never writes code. Every write to repository code, tests, or docs goes to `construct:odd-worker`, whatever the size. The parent writes only the feature document, and owns git.
- Reads, explanations, planning, and read-only requests stay with the parent unless the mapping trigger holds.
- A trigger holds only when its condition truly holds. When one holds, delegating is mandatory; writing code inline or continuing inline past a trigger is a routing defect.
- Never pass these rules to child agents as permission to orchestrate. Children do not delegate.
- Each role's model and effort come from the plugin configuration. The routing mod applies them, so prompts never choose a model.
- Never delegate a writer without `## Allowed edit surfaces`: one bare repository-relative path or glob per line, notes under a later heading. Never ask the human to author paths in free text.
- A writer prompt also carries `Spec: odd/tasks/<feature>.md, T<n>` while a feature document is unfinished; a `construct:odd-verify` prompt carries `Risk: item N (reason)`. The admission hook denies a launch without them.

## Decision Gates

| Trigger | Condition | Agent |
|---|---|---|
| Evidence budget | Decide or verify within one parallel batch (at most 3 calls, about 10k tokens) | none: the parent reads |
| Mapping | Needs more evidence than one batch, or more than about 5 sequential lookups | `construct:odd-explorer` (one per independent front, up to 3, launched together), then re-evaluate task size |
| Writer | Any authorized write to repository code, tests, or docs | `construct:odd-worker`, one per unit; disjoint units launched together, dependent units one after another |
| Verification | A Risk line that names a high-risk item, after the unit's own checks; for a tracked feature with several such units, one verifier at the feature's end over the whole branch instead of one per unit, and a unit alone only when it must ship or be relied on before then | `construct:odd-verify` (one) |
| Per action | Long suites, builds, installs, broad research | `construct:odd-general` |

A unit is one independent piece of behavior with its code, tests, and docs together. Never split one behavior into separate test, docs, and code writers. A delivery that depends on another is not independent.

## Execution Steps

1. Name the trigger and its evidence. For large work, record the route per task in the feature document.
2. Derive the allowed edit surface from the task (references/handoffs.md). If it cannot be derived, present the candidate path list as an approve/decline choice under `construct:lossless-prompts`.
3. Write the handoff by reference: the feature document, the task, and its `S#`; or, without a document, the user's request verbatim. Include the verification commands as the unit's verifier with its strength (strong: tests, build, typecheck; weak: ambiguous requirements or external side effects, so the worker stops after one step and reports; no verifier: say what would make it verifiable, and for docs-only units the reviewed diff is the verifier, so the worker proceeds), the test-first policy, the helpers to reuse, and the invariants to keep.
4. Launch parallel units in one message.
5. Check each writer's diff against its surface before accepting it. Run one seam check (the full suite, once) after parallel units.
6. Spot check one reported command yourself.
7. Remove scratch paths that workers report.

## Launch deduplication

Keep a list of `(role, task fingerprint)` pairs launched this turn, where the fingerprint is a normalized summary of the task text. Never launch a second agent for a pair already launched while it runs or after it returned; emit one launch per distinct task.

## Parallel explorers

- An independent front is a separate module, layer, or question whose answer does not depend on another front's answer.
- Launch one `construct:odd-explorer` per independent front, up to 3, in one message. One front stays one explorer.
- Each prompt names its front and question, and lists the other fronts as out of scope.
- A front that needs another front's answer runs after it.
- Distinct fronts are distinct fingerprints, so deduplication does not block them.
- The limit is 3 because 3 reports of about 2k tokens stay inside the parent's 10k batch budget.
- The parent spot checks one claim per report, then re-evaluates task size.

## Checking contract

- Run formatters, generators, and normalizers before verification. After verification only check-only commands run; any byte change after it re-runs the affected checks.
- Proof that is unavailable, partial, declined, or exhausted is never a pass. Report it as one **Needs your decision** result naming the missing proof.
- A docs-only change gets a structural readback by the parent, not a verifier. Executable, operational, mode-changing, or unknown content gets the Verification trigger above.

## Subagent memory

- The parent runs `construct-memory search` for relevant project context and passes it in the prompt. Subagents with Bash (worker, explorer, general, verify) may search themselves.
- Include in each prompt: end the report with a `## Key Learnings:` section (the SubagentStop hook captures it) and save decisions with `construct-memory save`.

## Parallel writers

- Work in another repository goes in a fresh worktree based on that repository's main, never in a checkout someone else may be using.
- Parallel units in the same repository share the tree only with disjoint edit surfaces:
  - The parent owns git.
  - Writers run no repository-wide formatters, generators, or installs.
  - A shared file has one owner, or the parent edits it at the end.
- Units that need the same file use isolated worktrees (`isolation: worktree` for the worker).

## Output Contract

Report the trigger used, each delegated unit's status (`done`, `partial`, `needs_interaction`), the checks as `<command>: <observed result>`, the parent spot check, and any open blockers as one **Needs your decision** result.

## References

- [references/handoffs.md](references/handoffs.md): prompt templates for explorer, worker, and verifier, plus edit-surface rules.
