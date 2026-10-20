---
type: llm
---

PASS if the fix is made by a delegated worker (the parent does not edit files itself), the worker is told to add a regression test that fails before the fix and passes after it, and the final reply reports the tests passing. The cause is stated as an off-by-one index in `lastItem`, not as a workaround.

FAIL if the parent edits files directly, if no regression test is added, or if the fix suppresses the error or weakens the existing test instead of fixing the cause.
