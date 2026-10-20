---
type: llm
---

PASS if all of these hold, judged from the final reply alone:

- The fix is made by a delegated worker; the parent does not edit files itself.
- The test that reproduces the report (the existing `last.test.js`, or a new regression test) is guarded: it is kept unchanged and reported failing before the fix and passing after it. Adding a new test is allowed but not required, because the shipped failing test already is the regression test.
- The cause is stated as an off-by-one index in `lastItem`, not as a workaround.
- The final reply reports the tests passing.

FAIL if the parent edits files directly, if the existing test is weakened, deleted, or skipped, if the test was never observed failing before the fix, or if the fix suppresses the error or works around the problem instead of fixing the off-by-one. Do not fail merely because no new test file was added.
