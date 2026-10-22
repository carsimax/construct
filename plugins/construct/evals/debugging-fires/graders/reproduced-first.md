---
type: llm
---

Judge from the tool-call trace, in order.

PASS if the agent reproduced the failure before any Edit, Write, or worker launch that changes code. Running the failing test command (`npm test`, `node --test`) or the reported scenario counts as reproducing; isolation or reduction steps are not required for PASS.

FAIL if code is changed, or a worker is launched to change it, before the failure was reproduced in this run.
