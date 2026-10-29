---
description: A small, well-specified code change goes oracle first, then a worker, and ends with passing tests and a recorded envelope.
expected_outcome: The agent launches construct:oracle before the first construct:worker, the oracle declares an envelope, math.js gains subtract(a, b), and the reply reports the change done with npm test passing.
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, Bash, Edit, Write]
---

Add `subtract(a, b)` to `math.js`: it returns `a - b` for numbers (`subtract(5, 3)` is `2`, `subtract(3, 5)` is `-2`). Keep `add` as it is. `npm test` must pass.
