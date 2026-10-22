---
name: rdd-review
description: "Mandatory review of high-risk work units: an outside view by lens agents chosen from the task's Risk numbers, recorded by hooks. Trigger: a work unit whose Risk names an item is ready, the publication gate denied a push, PR, or release, or the user asks for a review."
license: MIT
metadata:
  author: Construct
  version: "2.0"
---

## Activation Contract

Load this skill when a work unit whose Risk names a high-risk item is committed and ready, when the publication gate denied `git push`, `gh pr create`, or `gh release create`, or when the user asks for a review. Review is a mandatory ODD phase for high-risk work. Work whose Risk is `none` is not reviewed unless the user asks. There is no switch and no consent step.

## Hard Rules

- Never write, edit, or paste a lens verdict or its evidence. Hooks build the evidence and record the verdict. The review store under the git common dir (`construct-review/`) is guarded: a Write, Edit, or Bash command naming it is denied.
- Take the lenses from the table below. Never pick fewer. `review-readability` is optional.
- Run every source-mutating step (formatters, fixers) and commit before launching a lens. A new commit changes the subject, so it needs a new review.
- A rejection stands for that lens and tree. Fix with a new commit and review again; never retry the same subject hoping for a different answer.
- Commit, push, PR, and merge stay human decisions. An approval never authorizes delivery.

## Lenses by Risk number

The required lenses are the union over the Risk numbers in the feature document's `## Tasks` table:

| Risk item | Lenses |
|---|---|
| 1 | `review-risk`, `review-resilience` |
| 2 | `review-risk` |
| 3 | `review-reliability` |
| 4 | `review-reliability`, `review-resilience` |
| 5 | `review-risk`, `review-resilience` |
| 6 | `review-reliability` |

## Decision Gates

| Situation | Action |
|---|---|
| Risk is `none` and the user did not ask | No review |
| A work unit with a Risk item is committed | Review it before publication |
| The publication gate denied a command | It names the missing lenses; review the subject it names, then retry the command |
| The branch is too large for one context | The hook denies it; split the delivery into smaller pull requests (see `construct:chained-pr`) |
| A lens rejected | Fix with a new commit, then review again; the rejection stands for that lens and tree |
| A lens reply was invalid or ignored | An invalid report is sent back at most twice; a reply naming no pending subject is ignored, so launch the lens again |
| The user asks for readability | Add `review-readability`; it never gates publication |

## Execution Steps

1. Read the Risk numbers of the feature document's tasks and list the required lenses from the table.
2. Choose the subject. The base is normally the merge-base with the default branch: `git merge-base HEAD <default-branch>`. The head is always `HEAD`, so check out the ref you will publish first.
3. Launch each lens in one message, in parallel, as `construct:review-<lens>` with this line in its prompt:
   - `Review subject: <base>`, the only form.
   Add nothing else the lens must rely on. The review-context hook replaces the prompt with the binding, the name-status, the diff, and (for `review-risk`) the [security-checklist](references/security-checklist.md). A prompt with no readable subject is denied with the expected form.
4. When the lens agents stop, the review-capture hook validates each reply and records the verdict. Approved means a completed inspection and no BLOCKER or CRITICAL finding.
5. All required lenses approved: report it and continue. A rejection: fix with a new commit, save the finding's root cause and fix with `construct-memory save` as type `bugfix`, and go to step 2. A lens still missing: launch it again.
6. Record advisory findings as follow-ups in the feature document; save a deferred advisory as type `decision`.

## Output Contract

Report the subject (base), each lens and its verdict, the findings that blocked, and follow-ups. Delivery remains the user's decision.

## References

- [security-checklist](references/security-checklist.md): the `review-risk` checklist; the review-context hook embeds it in that lens's context.
