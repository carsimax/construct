---
name: delivery
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/skill-context.mjs" *)
description: Plan commits, branches, and pull requests as reviewable units. Use when deciding commit contents, opening or preparing a PR, judging PR size, splitting work into chained or stacked PRs, choosing a delivery strategy, or preparing a release.
---

# Delivery

Work reaches the remote as small, reviewable units. The publication gate and the delivery-signals hook enforce the edges; this skill covers the judgment between them.

## Current state

!`node "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/skill-context.mjs" delivery`

## Authority

- Commit, push, PR, and merge each run only on an explicit user instruction for that exact action. The publication gate denies `git push`, `gh pr create`, and `gh release create` until the review lenses required by the task's Risk approve the published ref (`construct:review`).
- A remote read or write needs authorization naming the repository, the operation, and the credential. Never probe ambient credentials.
- The target repository's own rules win: PR template, CONTRIBUTING, branch protection. The defaults below apply only where the repository defines none.
- Read the base branch from repository metadata (remote HEAD, branch protection, the PR's target). Never assume it.
- No AI attribution in commits or PR text unless the user asks.

## Budget

A slice is about 1500 authored changed lines (additions plus deletions, generated files excluded; the `slice_lines` option sets it). It is a target, never a cap. The delivery-signals hook reports the count after each commit on a feature branch and, past the slice, tells you to apply the feature's strategy and record the boundary in the feature document.

- Slice once, honestly. Keep the best cohesive split. If it still exceeds the budget, report the overage and recommend the `size:exception` label.
- The budget shapes slicing, never code: no deleted comments or tests, no minified code, no artificial splits.

## Commits

- One commit per work unit: one purpose, its tests and docs in the same commit, never split by file type.
- Subject in Conventional Commit form when the repository defines no other.
- A unit whose Risk names an item gets its own commit, so its review subject is exactly that commit. The last slice closes the feature.
- Record each task's commit in the feature document's Tasks table. The review subject is that commit.
- Before committing a unit confirm: a clean rollback boundary (reverting the commit leaves a working tree), a focused test with its exact result, and a runtime check or `N/A` with the reason.

## Strategy

One strategy per feature, chosen when the feature document is created from the forecast of authored lines, and cached in its header line.

Past the budget (forecast or running count):

- `ask-on-risk` (default): ask once for the chain shape before the next commit.
- `auto-chain`: ask only for a missing chain shape, then slice automatically.
- `single-pr`: keep one PR.
- `exception-ok`: keep one PR with a recorded `size:exception` rationale.

Record the chain shape and the slice boundaries (which commits each PR holds) in the feature document.

Chain shapes (`stacked-to-main`, `feature-branch-chain`) and their PR fields are in [chains](references/chains.md). Never mix shapes within a feature.

## Pull request

Default body: Summary, Changes, Test plan, Linked issue.

- Each PR is reviewable in about 60 minutes and is one deliverable unit with its tests and docs. State where it starts, where it ends, what it depends on, the follow-up, and what is out of scope.
- Test plan boxes are checked only for checks you ran and that passed. Report local checks as `<command>: <observed result>`; a required check that is unknown means the PR is not merge-ready.
- Linked issue: ask whether the PR closes or only references it, and keep the user's choice.

## Release

A release is its own unit: version bump and changelog in one `chore: release` commit, then the user's explicit instruction for the tag and `gh release create`, which the publication gate checks like a push.
