---
type: llm
---

Judge the final reply alone.

PASS when the reply only explains why `roundCents(1.005)` returns `1`: 1.005 is stored slightly below 1.005 in binary floating point, so the scaled value stays under 100.5 and rounds down. The reply may mention the one-line change that would address it, as long as it does not make that change.

FAIL when the reply walks through a debugging procedure (reproduce, localize, reduce, write a regression test), reports launching an agent, or says it changed or fixed a file.
