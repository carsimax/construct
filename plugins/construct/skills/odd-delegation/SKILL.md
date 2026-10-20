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

- The parent orchestrates and never writes code. Every write to repository code, tests, or docs goes to `construct:odd-worker`, whatever the size. The parent writes only the feature document and its engram mirror, and owns git.
- Reads, explanations, planning, and read-only requests stay with the parent unless the mapping trigger holds.
- A trigger holds only when its condition truly holds. When one holds, delegating is mandatory; writing code inline or continuing inline past a trigger is a routing defect.
- Never pass these rules to child agents as permission to orchestrate. Children do not delegate.
- Each role's model and effort come from the plugin configuration. The routing mod applies them, so prompts never choose a model.
- Never delegate a writer without `## Allowed edit surfaces`. Never ask the human to author paths in free text.

## Decision Gates

| Trigger | Condition | Agent |
|---|---|---|
| Evidence budget | Decide or verify within one parallel batch (at most 3 calls, about 10k tokens) | none: the parent reads |
| Mapping | Needs more evidence than one batch, or more than about 5 sequential lookups | `construct:odd-explorer` (one), then re-evaluate task size |
| Writer | Any authorized write to repository code, tests, or docs | `construct:odd-worker`, one per unit; disjoint units launched together, dependent units one after another |
| Verification | The change's Risk line names a high-risk item, after its own checks | `construct:odd-verify` (one) |
| Per action | Long suites, builds, installs, broad research | `construct:odd-general` |

A unit is one independent piece of behavior with its code, tests, and docs together. Never split one behavior into separate test, docs, and code writers. A delivery that depends on another is not independent.

## Execution Steps

1. Name the trigger and its evidence. For large work, record the route per task in the feature document.
2. Derive the allowed edit surface from the task (references/handoffs.md). If it cannot be derived, present the candidate path list as an approve/decline choice under `construct:lossless-prompts`.
3. Write the handoff by reference: the feature document, the task, and its `S#`; or, without a document, the user's request verbatim. Include the verification commands as the unit's verifier with its strength (strong: tests, build, typecheck; weak: none or ambiguous, so the worker stops after one step and reports), the test-first policy, the helpers to reuse, and the invariants to keep.
4. Launch parallel units in one message.
5. Check each writer's diff against its surface before accepting it. Run one seam check (the full suite, once) after parallel units.
6. Spot check one reported command yourself.
7. Remove scratch paths that workers report.

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
