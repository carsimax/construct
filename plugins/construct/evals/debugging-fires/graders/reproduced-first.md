---
type: llm
---

Judge from the tool-call trace, in order.

PASS if the agent ran the failing check (for example `npm test`) or otherwise reproduced the wrong paging output before any Edit, Write, or worker launch that changes code.

FAIL if code is changed, or a worker is launched to change it, before the failure was reproduced in this run.
