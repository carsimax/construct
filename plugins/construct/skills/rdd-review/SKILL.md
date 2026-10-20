---
name: rdd-review
description: "Receipt-driven review of high-risk work units: an outside view by up to four lens agents, with consent per candidate. Trigger: after a work-unit commit when RDD is on, when odd-assess reports review_due, when the Stop gate blocks, or when the user asks for a review."
license: MIT
metadata:
  author: Construct
  version: "1.0"
---

## Activation Contract

Load this skill after each work-unit commit while the RDD switch is on, when `odd-assess` reports `review_due: true`, when the Stop gate blocks with `decision: block`, or when the user explicitly asks for a review. Review is an outside view for high-risk work, not a ritual for every commit. Command tables are in [lifecycle](references/lifecycle.md); the consent prompt template is in [consent](references/consent.md).

## Hard Rules

- Check the switch first with `odd-review mode status`. When the mode is off, do not start a review, do not prompt, and do not retry.
- Review is due only when the assessed tier is `high`, or when the user explicitly asks. Medium and passive: record the tier and continue.
- You may raise the tier with `--escalate-item N --escalate-reason "<one line>"`, citing the high-risk list. Never lower it, and never infer low risk from a failed assessment.
- Consent is asked per candidate through `construct:lossless-prompts`. A decline skips only this candidate and is not the kill switch.
- Never edit an agent's JSON before capture, never invent a `subject_hash`, and never retry from prose. Follow the `next` field of each `odd-review` reply.
- One bounded correction per lineage, committed by you. Nothing else mutates the candidate.
- Commit, push, PR, and merge stay human decisions. An approval never authorizes delivery.
- When the user asks to stop RDD, run `odd-review mode disable` without arguing. Never run `odd-review mode enable` on the user's behalf.

## Decision Gates

| Situation | Action |
|---|---|
| Mode is off | Stop; record nothing and ask nothing |
| Tier is `passive` or `medium`, no user request | Record the tier and continue |
| Tier is `high`, or the user asked | Ask consent, then run the lifecycle |
| User chose "Skip this time" | Create no record; continue; future candidates ask again |
| `odd-assess` fails | Treat as `high` (it fails closed); ask consent |
| Stop gate blocked, naming a committed range | Review the committed range |
| Stop gate blocked, naming "uncommitted changes" | Review the working-tree candidate |
| Both candidates are high | Review the committed range first, then the uncommitted changes, or ask the user to commit first. Never leave high uncommitted work unreviewed: the gate does not remind again in the same session |
| `boundary.source` is `root` | Do not review the whole history. Review only uncommitted changes, or ask the user which commit to use as the base |
| `boundary.commit` equals HEAD | No committed range to review; only the working tree can be due |
| `state` is `refutation_required`, `correction_required`, `validation_required`, or `approved` | Run the commands in `next` per the lifecycle steps below |
| `state` is `escalated` | One **Needs your decision** result listing the findings; stop |
| A refusal `context_budget_exceeded` | Review smaller slices (commit ranges), each as its own candidate |
| A refusal `correction_budget_exceeded` | See step 8: a smaller fix, or one **Needs your decision** result |

## Execution Steps

1. Check the switch: `odd-review mode status`. Off means stop.
2. Pick the candidate. There are two:
   - **Committed range:** run `odd-review boundary` (JSON `{commit, source}`). Use it only when `source` is `receipt` or `merge-base` and `commit` differs from HEAD. Assess with `odd-assess --base-ref <commit> --committed-only --json`.
   - **Uncommitted changes:** assess with `odd-assess --json`.
   Follow the gate's wording when it blocked; otherwise check the committed range after a work-unit commit and the working tree when changes are pending.
3. Read `risk`, `reasons`, `changed_paths`, `changed_lines`, `review_due`, and `review_due_reason`. Apply the decision gates.
4. Pick lenses by consequence, with one `--lenses-reason` naming what you touched and how:
   - `risk`: data, credentials, permissions, guards, or contracts others consume;
   - `resilience`: failure behavior, retries, timeouts, partial writes, or concurrency;
   - `readability`: public APIs, output and messages, docs, or structure;
   - `reliability`: logic or behavior that tests should pin.
   Pick every lens that applies and only those. Requirement compliance is verification's job, not a lens.
5. Ask consent with the template in [consent](references/consent.md). Stop until the user answers.
6. On "Review this change", start with the form that matches the candidate and keep the `lineage`:
   - committed range: `odd-review start --base-ref <commit> --committed-only --lenses <list> --lenses-reason "<reason>"`;
   - uncommitted changes: `odd-review start --lenses <list> --lenses-reason "<reason>"`.
7. Per lens, in one message and in parallel: capture `odd-review context --lineage <L> --lens review-<lens>` and launch `construct:review-<lens>` with that output as the whole prompt. Pipe each agent's raw JSON reply, unedited, to `odd-review capture --lineage <L> --lens review-<lens> --input -`.
8. Read the `state` field of the last reply and run the commands in its `next` list:
   - `refutation_required`: capture `odd-review context --lineage <L> --lens review-refuter`, launch `construct:review-refuter` with it, pipe the reply to `odd-review capture-refuter --lineage <L> --input -`.
   - `correction_required`: make one bounded correction for the corroborated findings only and commit it, run `odd-review correct --lineage <L>`, then capture the `review-validator` context, launch `construct:review-validator`, and pipe the reply to `odd-review capture-validation --lineage <L> --input -`. The budget is min(200, ceil(n/2)) of the reviewed lines. A refused `correct` (`correction_budget_exceeded`) does not consume the single correction: make a smaller fix, or report one **Needs your decision** result. A very small candidate, such as a one-line change, cannot fit any correction.
   - `approved`: `odd-review acknowledge --lineage <L>`. Report the receipt.
   - `escalated`: one **Needs your decision** result.
9. Record advisory findings as follow-ups in the feature document. Record the tier and outcome per candidate: granted, declined, passive, medium, already reviewed, or unavailable.

## Output Contract

Report the tier, whether review was due, the consent outcome, and the terminal state (`approved` and acknowledged, `escalated`, declined, or skipped). List follow-ups. Delivery remains the user's decision.

## References

- [lifecycle](references/lifecycle.md): commands, states, flags, and the switch.
- [consent](references/consent.md): the per-candidate consent prompt.
