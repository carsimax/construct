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
- Never edit an agent's JSON before capture, never invent a `subject_hash`, and never retry from prose. When any `odd-review` change command answers `rdd_disabled`, the switch is off: stop, do not retry, and leave the switch to the user. Follow the `next` field of each `odd-review` reply.
- Never pick lenses yourself: `odd-review start` without `--lenses` takes the ones `odd-assess` assigns. When you escalated `odd-assess`, pass the same `--escalate-item N --escalate-reason "<one line>"` to `odd-review start` instead of explicit `--lenses` (the two cannot be combined). Pass `--lenses` only when the user names lenses; for a `medium` candidate the user asked to review, pass `--focus <lens>` (one lens).
- Run every source-mutating step (formatters, fixers, commit hooks that rewrite files) before `odd-review start`. Any byte, path, or mode change after start is a new candidate and needs a new review.
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
| Both candidates are high | Review the committed range first, then the uncommitted changes, or ask the user to commit first. Never leave high uncommitted work unreviewed: the gate reminds once per target per session, and uncommitted work changes the target |
| The publication gate denied a `git push`, `gh pr create`, or `gh release create` (`review_required`) | Review the range it names: `odd-review start --base-ref <base> --committed-only` with the consent step, then acknowledge, then retry the command. A receipt for the published tree is what clears it. If the user declines the review, the user decides whether to run `odd-review mode disable`; never do it for them |
| The Stop gate is silent about work you can see | It stays silent for a candidate that existed at session start (the session baseline); the publication gate still applies |
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
4. Take the lenses from the assessment's `lenses` field (all four for `high`). Do not choose them. For a `medium` candidate the user asked to review, pick the one focus lens by consequence and pass it with `--focus` (`odd-review start --focus <lens>`): `risk` for data, credentials, permissions, guards, or consumed contracts; `resilience` for failure behavior, retries, timeouts, partial writes, or concurrency; `readability` for public APIs, messages, docs, or structure; `reliability` for logic tests should pin.
5. Ask consent with the template in [consent](references/consent.md). Stop until the user answers.
6. On "Review this change", start with the form that matches the candidate and keep the `lineage`:
   - committed range: `odd-review start --base-ref <commit> --committed-only`;
   - uncommitted changes: `odd-review start`.
   - Add `--request-context <file>` with the feature document's relevant specs (write the `S#` block to a scratch file, at most 32 KiB) so every lens sees what the change was meant to do. Skip it when there is no written request.
7. Per selected lens, in one message and in parallel, launch `construct:review-<lens>` with only the lineage id as its prompt, for example `Review lineage review-0123456789abcdef`. Two plugin hooks do the rest by code: before the agent starts, the prompt is replaced with the full `odd-review context` for that lens; when it stops, its reply is piped to `odd-review capture`, and a malformed or invalid reply is sent back to the agent with the validator's message, at most twice. Do not paste context or copy replies. The hook replaces the whole prompt, so text added after the lineage id never reaches the agent: the `risk` lens context already includes the [security-checklist](references/security-checklist.md), added by `odd-review context` inside the context block. When the agents finish, run `odd-review status --lineage <L>`. A lens still pending there was not captured: launch it again the same way.
8. Read the `state` field of the status and act on it:
   - `refutation_required`: launch `construct:review-refuter` with the lineage id; the hooks capture it with `capture-refuter`. A refuter `inconclusive` goes to correction.
   - `correction_required`: make one bounded correction for the corroborated findings only and commit it, run `odd-review correct --lineage <L>`, then launch `construct:review-validator` with the lineage id; the hooks capture it with `capture-validation`; an `inconclusive` validation is captured again by relaunching the validator, up to 3 attempts, and the 3rd escalates. Lens findings use the causal values `introduced`, `behavior-activated`, `worsened`, `pre-existing`, `base-only`, `unknown`. The budget is min(200, ceil(n/2)) of the reviewed lines, never below 2, so a one-line candidate fits one line replacement. A refused `correct` (`correction_budget_exceeded`) does not consume the single correction: make a smaller fix, or report one **Needs your decision** result. A second `correct` escalates the review (one-shot counters, see the lifecycle reference).
   - `approved`: `odd-review acknowledge --lineage <L>`. Report the receipt.
   - `escalated`: one **Needs your decision** result.
   - A lens agent that cannot run (no launch, repeated failures): `odd-review capture-unachievable --lineage <L> --lens <lens> --reason "<one line>"`; the review escalates. To drop a review the user no longer wants, `odd-review abandon --lineage <L>`; `odd-review invalidate --lineage <L> --reason "<one line>"` closes one no lens has touched.
9. Record advisory findings as follow-ups in the feature document. Record the tier and outcome per candidate: granted, declined, passive, medium, already reviewed, or unavailable.

## Output Contract

Report the tier, whether review was due, the consent outcome, and the terminal state (`approved` and acknowledged, `escalated`, declined, or skipped). List follow-ups. Delivery remains the user's decision.

## References

- [lifecycle](references/lifecycle.md): commands, states, flags, and the switch.
- [consent](references/consent.md): the per-candidate consent prompt.
- [security-checklist](references/security-checklist.md): the `risk` lens checklist; `odd-review context` embeds it in the context of that lens.
