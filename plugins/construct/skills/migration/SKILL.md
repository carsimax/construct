---
name: migration
description: "Plan and verify risky migrations and removals: expand, migrate, contract for schemas and persisted data, deprecation notices with a removal condition, compatibility windows, reversible backfills, per-phase verification, and rollback. Trigger: schema or stored-data migration, removing or renaming a public API, flag, config format, or export, replacing a system, or Risk item 1 or 3."
license: MIT
metadata:
  author: Construct
  version: "1.0"
---

## Activation Contract

Load this skill when a change migrates or deletes stored data, changes a persisted format, or removes, renames, or replaces something other code or users consume (`construct:task-size-risk` items 1 and 3). Adapted from addyosmani/agent-skills (MIT); see NOTICE.

## Hard Rules

- Never change a column, field, format, or public name in place. Old and new consumers must both be valid at every phase.
- Additive first; destructive last and alone. A drop, rename, or removal is its own work unit, after nothing references the old shape.
- Every phase has a verifier (test, query, or usage check) and a rollback. A migration with no tested down path is not ready.
- A backfill is reversible or backed up first, runs in bounded batches, and can be re-run safely.
- Do not deprecate without a working replacement. Do not remove while usage is unproven.
- The parent plans and reads only; every write goes to `construct:odd-worker`, one phase per unit, test-first.
- Ask at most one blocking question (default: advisory deprecation with no hard date).

## Decision Gates

| Situation | Action |
|---|---|
| Stored data or schema changes | Expand, migrate, contract; see `references/phases.md` |
| Public API, flag, config, or export removed | Deprecate with a notice and removal condition, then remove after zero usage |
| Replacement does not exist | Build it first; stop the removal |
| Consumers are internal and all in the repo | Migrate them in the same plan; no compatibility window |
| Consumers are external or unknown | Advisory by default; compulsory only for security or unsustainable cost, with tooling |
| Down path or backup cannot be proven | Stop and report; do not proceed to the destructive phase |

## Execution Steps

1. Inventory every touchpoint of the old shape (code, data, config, docs, external consumers) with read-only searches.
2. Pick the pattern (expand/contract, adapter, flag, strangler) and write the phases with their verifier and rollback (`references/phases.md`).
3. Write the deprecation notice: status, replacement, removal condition (an observable fact, such as zero usage, or a date), migration steps.
4. Hand each phase to a worker as its own unit; give risky phases their own commit and an independent `construct:odd-verify`.
5. Before the contract phase, prove zero remaining use (grep, logs, metrics), then remove code, tests, docs, config, and the notice together.

## Output Contract

Return the phase plan: for each phase its change, verifier, rollback, and removal condition, plus the evidence of zero usage before contraction. Close code changes with the Risk line (`Risk: item 1` or `item 3`).

## References

- `references/phases.md`: phase templates, backfill rules, deprecation notice, and rationalizations.
- `construct:task-size-risk`: the high-risk items this skill serves.
