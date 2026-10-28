---
name: review
user-invocable: false
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/skill-context.mjs" *)
description: "Mandatory outside review of high-risk work units, by lens agents the hooks feed and record, plus the dual blind review on request. Trigger: a unit whose Risk names an item is committed and ready to publish, the publication gate denied a push, PR, or release, or the user asks for a review, a dual review, or an adversarial review."
license: MIT
metadata:
  author: Construct
  version: "2.0"
---

## Current state

!`node "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/skill-context.mjs" review`

## When

Run this when a unit whose Risk names an item is committed and ready, when `publication-gate` blocked a `git push`, `gh pr create`, or `gh release create`, and also whenever the user requests one. A unit with Risk `none` is not reviewed unless the user asks. For a dual or adversarial review of a concrete target, or a check of a plan or claim, see [dual review](references/dual-review.md); it replaces the lens review for that target, never both.

## Which lenses

The required lenses are the union of the rows for every Risk item in the feature documents the branch changed (`publication-gate` reads the Risk column of the Tasks tables).

| Risk item | Lenses |
|---|---|
| 1 | `review-risk`, `review-resilience` |
| 2 | `review-risk` |
| 3 | `review-reliability` |
| 4 | `review-reliability`, `review-resilience` |
| 5 | `review-risk`, `review-resilience` |
| 6 | `review-reliability` |

`review-readability` is opt-in: launch it only when the user asks, and it never gates publication. The agents are `construct:review-risk`, `construct:review-reliability`, `construct:review-resilience`, and `construct:review-readability`.

## Run it

1. Commit, and run the project's formatters first. A new commit is a new subject, so review after the last commit; the head under review is always `HEAD`.
2. Find the base: the merge-base of `HEAD` with the default branch. The gate's denial prints it.
3. Launch every required lens in parallel with the `Agent` tool. Each prompt holds exactly one line, `Review subject: <base>`, and nothing else is needed.
4. Wait for all of them, read each verdict, and fix what a lens rejected (see Verdicts).

## What the hooks do

- `review-context` (PreToolUse on `Agent`) replaces the lens prompt with the evidence: the binding, changed-path manifest, name-status, numstat, one patch per path (a deleted path, or one under `plugins/construct/hooks/vendor/`, gets a marker instead of its content), and for `review-risk` the [security checklist](references/security-checklist.md). It records the lens as pending. It denies a prompt with no subject line, a range containing `..`, a base starting with `-`, a ref that does not resolve, and two equal trees. It denies a context over 400 KB: split the delivery into smaller pull requests.
- `review-capture` (SubagentStop) checks the lens reply against the binding and writes the verdict. An invalid reply is blocked with the reason, and the lens resends only the corrected complete JSON, at most twice; then the pending record is cleared and no verdict exists, so launch the lens again. A reply naming no pending subject is ignored unless the session has exactly one pending record of that lens.
- `review-store-guard` denies Write, Edit, and Bash commands that touch the review store or run the review hooks. Lenses never write evidence or verdicts, and neither do you.
- `publication-gate` (PreToolUse on Bash) reads the verdicts at publication. It names the missing lenses, the subject line, and this skill in its denial.

## Verdicts

- Approved: the inspection completed and no finding is BLOCKER or CRITICAL. WARNING and SUGGESTION still approve.
- Rejected: any BLOCKER or CRITICAL. A rejection stands for that lens and that tree and is never replaced by an approval. Fix with a new commit through `construct:worker`, with the finding locations as the spec, then review again. Never resubmit the same subject.
- Incomplete: the lens could not inspect everything and says why in `evidence`. No verdict is recorded; launch the lens again.

Approval is necessary, never sufficient: commit, push, PR, and merge stay the user's decisions.

## Follow-ups and memory

Advisory findings (WARNING, SUGGESTION) become follow-up rows in the feature document. Save a deferred advisory as a `decision` and a rejection's root cause as a `bugfix` with `mem_save`.

## Report

Give the subject line, each lens with its verdict, the blocking findings, and the follow-ups.
