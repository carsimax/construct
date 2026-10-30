---
description: "A one-line change is done and reported briefly; its overhead is read from cost and turns."
expected_outcome: "GREETING in greet.js becomes 'Welcome', npm test passes, and the reply is short and asks the user nothing."
max_turns: 15
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, Bash, Edit, Write]
---

In `greet.js`, change the greeting constant from `'Hello'` to `'Welcome'`. `npm test` must pass.
