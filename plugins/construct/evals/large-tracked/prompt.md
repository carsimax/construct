---
description: Multi-session work gets an .vault/tasks feature document before the first source write.
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
---

I want to turn this repo into a small todo CLI over the next few sessions: `todo add "<text>"`, `todo list`, and `todo done <id>`, storing items in a todos.json file. I will review each command separately before we move on, so set up whatever plan you need and implement only `todo add` in this session.
