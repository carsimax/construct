---
name: delivery
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/skill-context.mjs" *)
description: Plan commits, branches, and pull requests as reviewable units. Use when deciding commit contents, opening or preparing a PR, splitting large work into sub-branches of a feature branch, or preparing a release.
---

# Delivery

Work reaches the remote as small, reviewable units. The publication gate enforces the edge; this skill covers the judgment before it.

## Current state

!`node "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/skill-context.mjs" delivery`

## Authority

- Commit, push, PR, and merge each run only on an explicit user instruction for that exact action, except work-unit commits on the feature branch of authorized large work. The publication gate denies `git push`, `gh pr create`, and `gh release create` until the review lenses required by the task's Risk approve the published ref (`construct:review`).
- A remote read or write needs authorization naming the repository, the operation, and the credential. Never probe ambient credentials.
- The target repository's own rules win: PR template, CONTRIBUTING, branch protection. The defaults below apply only where the repository defines none.
- Read the base branch from repository metadata (remote HEAD, branch protection, the PR's target). Never assume it.
- No AI attribution in commits or PR text unless the user asks.

## Branches

Large work (a feature document exists) always lives on `feat/<feature>`. Split it by work unit, never by line count.

- Each task, or a cohesive group of tasks, gets a sub-branch `feat/<feature>-t<n>` cut from the feature branch. Never `feat/<feature>/t<n>`: git refuses a branch and a directory of one name.
- Work-unit commits go on the sub-branch. When its Risk names an item, run the lenses on it (`construct:review`) before merging.
- Merge locally into the feature branch with `git merge --no-ff`. Sub-branches are never pushed and never get their own PR.
- The only PR is `feat/<feature>` to the default branch, reviewed cumulatively by the publication gate. Details in [sub-branches](references/chains.md).
- Limit: that review covers the whole feature diff. Past the 400 KB review-context budget it cannot publish in one PR, so keep features scoped.

## Commits

- One commit per work unit: one purpose, its tests and docs in the same commit, never split by file type.
- Subject in Conventional Commit form when the repository defines no other.
- A unit whose Risk names an item gets its own commit, so its review subject is exactly that commit.
- Record each task's commit in the feature document's Tasks table. The review subject is that commit.
- Before committing a unit confirm: a clean rollback boundary (reverting the commit leaves a working tree), a focused test with its exact result, and a runtime check or `N/A` with the reason.

## Pull request

Default body: Summary, Changes, Test plan, Linked issue.

- The PR is one deliverable unit with its tests and docs. State what it includes, what it depends on, the follow-up, and what is out of scope.
- Test plan boxes are checked only for checks you ran and that passed. Report local checks as `<command>: <observed result>`; a required check that is unknown means the PR is not merge-ready.
- Linked issue: ask whether the PR closes or only references it, and keep the user's choice.

## Release

A release is its own unit: version bump and changelog in one `chore: release` commit, then the user's explicit instruction for the tag and `gh release create`, which the publication gate checks like a push.
