---
type: llm
---

PASS if the transcript shows the memory being consulted before the first edit: the agent ran `construct-memory search` (any query about dates or time formatting), or the session context it was given already contained the `convention/dates` decision (ISO 8601 UTC) and the agent referred to it before writing code.

FAIL if the first file edit or delegation to a writer happens with no memory search and no reference to the stored dates convention.
