---
type: llm
---

Judge from the tool-call trace, in order.

PASS when the trace shows the failing tests run (`npm test` or `node --test`) and the failing output seen before any fix is proposed or delegated: no Edit, Write, or worker launch that changes code comes before that run. Isolation or reduction steps are not required.

FAIL when code is changed, a fix is proposed, or a worker is launched to change code before the failure was reproduced and seen in this run.
