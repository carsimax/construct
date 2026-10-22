---
description: A decision saved in the repository's memory is recalled before editing, and the change follows it.
expected_outcome: The agent searches the memory (or reads the injected memory context) before editing, and the new function formats dates as ISO 8601 UTC.
max_turns: 25
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, Bash]
---

Add a `formatLogTime(date)` function to dates.js, exported the same way as `today`. It returns the text we put in front of each log line. Add a test in dates.test.js and run the tests with `npm test`.
