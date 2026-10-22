---
description: A read-only explanation request loads no debugging procedure and writes nothing.
expected_outcome: A plain explanation of why roundCents(1.005) is 1 (binary floating point), with no file written and no debugging procedure applied.
max_turns: 10
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill, Agent]
---

I was reading `money.js` and noticed the test expects `roundCents(1.005)` to be `1`, not `1.01`. Why does it come out that way? Explain it to me. Don't change anything and don't fix anything; I only want to understand it.
