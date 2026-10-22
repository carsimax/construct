---
type: llm
---

Judge from the tool-call trace and the final reply.

PASS when all of these hold:
- The fix is made by a delegated worker (a `construct:worker` launch), not by the parent editing code itself.
- The test that reproduces the report is kept: the shipped failing test in `paginate.test.js`, or a new one. Adding a new test is allowed but not required.
- That test is observed failing before the fix and passing after it, and is not weakened, skipped, or deleted.
- The suite passes at the end.

FAIL when any of these holds:
- The parent edits code itself.
- The reproducing test is weakened, skipped, or deleted.
- The reproducing test is never seen failing before the fix.
- The fix works around the bug instead of correcting it.
