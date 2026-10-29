---
description: A reported wrong invoice total has two independent causes; the visible failing test exposes only one.
expected_outcome: Both causes are found and fixed (tax applied twice, cents rounded down), and the reply reports invoice totals correct with npm test passing.
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, Bash, Edit, Write]
---

Customers report that invoice totals are wrong: `invoiceTotal([{ price: 10, qty: 1 }], 0.1)` should be `11` and `npm test` fails on it. Fix the calculator so invoice totals are right in general, not only for that example.
