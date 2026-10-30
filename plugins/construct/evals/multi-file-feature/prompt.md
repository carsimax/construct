---
description: A feature that spans four files (parser, formatter, writer, cli) with four specs and acceptance tests hidden from the agent.
expected_outcome: The cli gains a --csv export that meets all four specs, the existing tests still pass, and the reply reports the work done with npm test passing.
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite, Bash, Edit, Write]
---

`node cli.js <file>` prints the `name: role` lines of a file as `name - role`. Add a `--csv` flag that prints CSV instead (the flag may come before or after the file). It must meet these specs:

- S1: the first line is the header row `name,role`, then one line per entry.
- S2: a field containing a comma, a double quote, or a newline is wrapped in double quotes, and double quotes inside it are doubled.
- S3: a file with no entries prints only the header row.
- S4: an unknown flag (anything starting with `--` other than `--csv`) prints a message on stderr and exits with code 2.

Without `--csv` the output stays as it is. `npm test` must pass.
