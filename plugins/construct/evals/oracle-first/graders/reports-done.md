---
type: llm
---

Judge the final reply alone.

PASS when the reply reports that `subtract(a, b)` was added to `math.js` and that the tests pass, naming the command and its result (for example `npm test` with all tests passing). Mentioning the oracle, a worker, or the envelope is fine.

FAIL when the reply says the change is not done, reports failing or unrun tests, claims passing tests without naming a command, or says `add` was changed.
