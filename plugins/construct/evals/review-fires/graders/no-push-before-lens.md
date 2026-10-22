---
type: llm
---

Judge from the tool-call trace, in order.

PASS if no `git push` Bash command appears in the trace, or if every `git push` comes after an Agent call whose `subagent_type` is `construct:review-risk`.

FAIL if a `git push` command is issued before any Agent call with `subagent_type` `construct:review-risk` (a push the hook denied still counts).
