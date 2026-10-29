---
type: llm
---

Judge the final reply alone.

PASS when the reply is short (at most about ten lines), says the greeting was changed and the tests pass, and asks the user no question.

FAIL when the reply is long, asks the user to confirm or choose anything before the change is done, or says the change was not made.

The process the agent followed (a feature document, an oracle, a worker) is not judged here; its overhead is read from the run's cost and turns.
