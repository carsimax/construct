---
name: migration
description: Plan and verify risky migrations and removals. Use when changing a schema or stored data, removing or renaming a public API, flag, config format, or export, replacing a system, or when the task's Risk names item 1 or 3.
---

# Migration

A migration changes something other code or stored data depends on. Old and new consumers stay valid at every phase, so any phase can stop or roll back.

## Rules

- Never alter a column, field, format, or public name in place. Add the new shape beside the old one.
- Start with additive steps. The destructive step goes last, by itself, in its own unit, once nothing references the old shape.
- Each phase carries a verifier and a rollback that was really executed. A down path that was only written means the phase is not ready.
- Backfills are reversible or backed up, run in bounded batches, and are safe to run twice.
- Deprecate only with a working replacement. Remove only when usage is proven zero (search results, logs, or metrics; say which).
- Internal consumers migrate in the same plan. External or unknown consumers get an advisory deprecation. If the down path cannot be proven, removal stops.

## Flow

1. **Classify.** Stored data or schema, public name, or a whole system. This work is Risk item 1 or 3, so it is tracked in `odd/tasks/` and its units are reviewed (below).
2. **Ask at most one blocking question**, only when the answer changes the plan. Without an answer, default to an advisory deprecation with no hard date.
3. **Plan the phases** from `references/phases.md`: pattern, per-phase verifier and rollback, removal condition. The parent writes the plan; it does not edit code itself.
4. **Save the plan** with `mem_save` (type `decision`) under `topic_key` `migration/<name>`. A notice updates that entry.
5. **One phase per unit.** Delegate each phase to `construct:worker`, test-first, with the phase's rollback as an acceptance check. A contract step never shares a unit with an earlier phase.
6. **Review.** Each unit is Risk item 1 or 3, so it gets `construct:review` before it counts as done, and the publication gate denies `git push`, `gh pr create`, and `gh release create` until the lenses approve. command-guard denies `--no-verify`, and the Risk-line gate blocks added skipped or stub tests, so neither is a way around a failing phase.

## Report

Close with, per phase: what changed, its verifier result, its rollback and whether it ran, the removal condition, and the zero-usage evidence for any removal. End the reply with the Risk line naming item 1 or 3.

## Reference

- `references/phases.md`: expand-migrate-contract, code patterns, deprecation notice, removal, rejected shortcuts.
