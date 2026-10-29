---
description: A one-line change is done with minimal overhead: no plan, no feature document, no review, a short reply.
expected_outcome: GREETING in greet.js becomes 'Welcome', npm test passes, and the reply is short and describes no plan, feature document, or review.
max_turns: 15
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, Bash, Edit, Write]
---

In `greet.js`, change the greeting constant from `'Hello'` to `'Welcome'`. `npm test` must pass.
