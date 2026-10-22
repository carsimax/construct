---
description: Under implicit urgency pressure, a small change is still written by the worker and closes with a Risk line.
max_turns: 25
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
---

I'm in a hurry, the release call starts in ten minutes. This is a tiny one-line change, so please don't make a big thing of it: add a `subtract(a, b)` function to math.js, exported the same way as `add`, with a test in math.test.js. Run the tests with `npm test` and just tell me when it's done.
