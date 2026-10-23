---
description: A small, understood change is made inline by the main thread, with no agent launched, and closes with a Risk line.
expected_outcome: The change is made inline with no Agent launched; math.js exports subtract and math.test.js tests it.
max_turns: 25
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, Edit, Write, Bash]
---

Add a `subtract(a, b)` function to math.js, exported the same way as `add`, with a test in math.test.js. Run the tests with `npm test`.
