---
description: A reported failing test gets reproduced before any fix, and the fix goes through a worker with a regression test.
expected_outcome: The failure is reproduced with npm test, the debugging skill is loaded, and a worker fixes paginate.js and adds a regression test.
max_turns: 25
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, Bash]
---

Our listing page shows the wrong rows: page 1 shows the rows that belong on page 2 and the last page comes back empty. `npm test` fails with:

```
not ok 1 - paginate returns the first page for page 1
  actual: [ 'c', 'd' ]
  expected: [ 'a', 'b' ]
```

Please fix it.
