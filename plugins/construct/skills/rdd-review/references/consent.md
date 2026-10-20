# Consent prompt

Build one blocking prompt and present it under `construct:lossless-prompts`. Preserve the labels, effects, and order below; fill the placeholders from the assessment and the lens selection. Ask in the user's language and stop until they answer.

## Content

- Headline: a review of this candidate is recommended (`risk: <tier>`, `review_due_reason: <reason>`).
- Reason: why it is due, in one sentence.
- Risk evidence: each item of `reasons` as `code` plus `path` (and `detail` when present).
- Candidate size: `changed_paths` files and `changed_lines` lines, range `<boundary>..HEAD`.
- Selected lenses and the `--lenses-reason`.

## Choices (single select, closed domain)

1. **Review this change** (token `granted`)
   - Effect: runs the selected lenses over this candidate only. Later medium or high changes ask again. Delivery (commit, push, PR, merge) still needs your separate approval.
2. **Skip this time** (token `declined`)
   - Effect: skips this candidate only. No record is created and future reviews stay on.

## Off switch

Mention that RDD can be turned off for good with `odd-review mode disable`. A decline is per candidate and is not that switch.

## After the answer

- `granted`: continue with `odd-review start`.
- `declined`: record "declined" in the feature document and continue.
