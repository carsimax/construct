# Chains

Use when a feature exceeds the budget and the strategy allows splitting. Choose by how slices merge.

## Shapes

- `stacked-to-main`: each PR targets the base branch and merges alone, in order. Landing partway may ship partial behavior, so each slice must be safe by itself. Use when slices merge independently.
- `feature-branch-chain`: a draft, no-merge tracker PR holds the feature branch. Child 1 targets the tracker, each later child targets its parent. Nothing lands until the tracker merges. Use when the work must integrate first.

A diff that shows a parent's changes is a base bug: retarget it, do not edit around it. Never mix the two shapes in one feature.

## Context fields

Every chained PR body begins with:

- chain, tracker, position (`n of N`), base, depends on, follow-up
- review budget: `<changed lines> / 1500`
- starts at, ends with

Child PRs also carry a dependency diagram marking the current PR.

## Body

- Overview: one paragraph on the unit.
- Scope: what it includes, what it excludes.
- Autonomy checklist: CI expected, one scope only, clean rollback, tests or docs cover the unit.

## Over budget

A PR above the budget without `size:exception` gets a split request, not a quiet merge. Pick the tracker when the work must integrate first, stacked when slices merge on their own. After one honest slicing pass, report the overage and recommend `size:exception`.
