---
name: lossless-prompts
description: "Relay blocking questions and choice menus from subagents or tools to the user without losing options, and validate the answer. Trigger: a subagent or tool returns a question, menu, consent request, or approve/decline choice that blocks progress."
license: MIT
metadata:
  author: odd_skills
  version: "1.0"
---

## Activation Contract

Load this skill when a subagent, tool, or script returns a user-facing blocking prompt, or when the orchestrator must present an approve/decline choice such as candidate edit surfaces.

## Hard Rules

- Preserve the complete choice envelope:
  - why input is required;
  - every group and question, in original order, with every group header;
  - every option label and description;
  - the selection mode;
  - the exact allowed-answer domain.
- Never summarize, abbreviate, reorder, relabel, merge, or omit choices. Never split one atomic business choice across several interactions.
- Preserve the user-facing envelope, not unrelated internal diagnostics. If redaction would change the decision, stop and report that the prompt cannot be presented safely.
- Never choose, default, infer, or launch dependent work while the answer is pending.

## Decision Gates

| Situation | Action |
|---|---|
| The envelope fits `AskUserQuestion` exactly (question count, option count, text length) | Use `AskUserQuestion` |
| It does not fit, the tool is unavailable or denied, or the session is non-interactive | Emit the complete envelope as plain text with the answer syntax and why it blocks; then stop |
| The user asks what a choice means or what happens next | Answer from the envelope without recommending or resolving it; present the full envelope again and keep waiting |
| The answer is invalid or ambiguous | Present the complete envelope again and stop |

## Answer validation

- Accept an answer only when every response belongs to the presented answer domain. Allow free text or multi-select only when the original prompt allowed it.
- For a closed single-select envelope:
  - trim whitespace and compare labels case-insensitively;
  - accept only an input that matches exactly one option, and reject zero or several matches;
  - map the match to its canonical internal token once.
- Accepted ordinal aliases for option N: the numeral `N`, `la N`, and `opción N`; `first` also maps to option 1. An alias counts only when it maps to exactly one option.
- Return a valid answer to the same blocked actor exactly once.

## Execution Steps

1. Capture the full envelope from the blocked actor.
2. Pick the native or plain-text route by the decision gates.
3. Present it and stop.
4. Validate the answer, then hand the canonical token back to the actor that asked.

## Output Contract

Either one presented envelope followed by a stop, or one validated answer returned to its actor.
