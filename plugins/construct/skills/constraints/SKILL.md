---
name: constraints
description: "Write the repository's quality bar as CONSTRAINTS.md: a Floor that is never weakened, numeric rules each with the command that checks it, and measure-and-hold ratchets. Adapted from agent-skills (MIT). Trigger: no written quality bar, the user asks for constraints, standards, or quality gates, or a change silences checks or skips tests to get to green."
license: MIT
metadata:
  author: Construct
  version: "1.0"
---

## Activation Contract

Load this skill when the repository has no `CONSTRAINTS.md` and the user wants a quality bar, when the user names constraints, standards, thresholds, or quality gates, or when work is silencing a check or skipping a test to reach green. If `CONSTRAINTS.md` exists and the user is not changing it, read it and follow it instead.

Skip one-off scripts, spikes, and throwaway prototypes. The Floor alone still applies to them.

## Hard Rules

- Detect before asking. Never ask what a manifest, config, or one test run can answer.
- Ask at most four questions, one per turn, then stop and wait. Each carries a guess and a default, so "I don't know" is a complete answer.
- Non-interactive contexts (CI, loops, unattended runs) apply the Floor only, say so, and flag the rest for a human.
- The parent orchestrates. Writing `CONSTRAINTS.md` or any pointer line into the repository is a write: after the user answers, it goes to one `construct:worker` with the file as its allowed edit surface.
- Every numeric rule names the command that checks it. A number without a command is an aspiration: leave it out.
- Do not hand-roll a checker when the stack has a de facto one; use the project's own tools first.
- State each threshold with its reason. Never invent a number the user did not choose or the measurement did not give.
- Never weaken `CONSTRAINTS.md`, a threshold, or a check to make a change pass. Loosening the bar is a user decision and is reported, not done silently.
- Install nothing without the user's consent; list what each chosen dimension needs and its cost.

## The Floor

Always enforced, no setup:

- No new suppression comments (`@ts-ignore`, `eslint-disable`, `# noqa`, `# type: ignore`, `//nolint`).
- No skipped or deleted tests without a reason in the commit message.
- No unimplemented stubs or empty `catch`.
- No credentials or keys in source.
- `CONSTRAINTS.md` is never weakened to make a change pass.

No tool checks the suppression and skipped-test items for you. Read the diff for added suppressions, skipped tests, stubs, empty catch blocks, credentials, and threshold edits.

## Decision Gates

| Situation | Action |
|---|---|
| `CONSTRAINTS.md` exists, no change requested | Read it and follow it |
| No live user | Apply the Floor, note it, flag the rest |
| User has no numbers | Measure today's value and hold it (ratchet) |
| Dimension needs a running URL (performance, accessibility) and the project has none | Drop the dimension and say so |
| A diff lowers a threshold, drops a severity, adds an exception, or silences a checker | Treat as a finding; ask the user, never accept silently |

## Execution Steps

1. **Detect** (one bounded read batch): language and stack, test runner, linters, current coverage (read existing output, or run the suite once), CI, agent instruction files. Report in two lines.
2. **Ask** the remaining questions one per turn, in this order, each with `GUESS` and `DEFAULT if unsure`:
   - Q1 Which dimensions beyond the Floor: coverage on new code, security scanning, performance budgets, accessibility, architecture boundaries. Say what each costs. Default: coverage and security.
   - Q2 Block or warn when a check fails mid-task. Default: block on the Floor, warn on the rest for two weeks.
   - Q3 Target numbers, or measure and hold. Default: measure and hold.
   - Q4 Slowest tolerable check before work is handed back. Default: about 90 seconds at task end, unlimited in CI.
3. **Draft** `CONSTRAINTS.md` from [references/constraints-template.md](references/constraints-template.md): Floor, numeric rules with `Checked by` and `Runs at`, measured-not-enforced ratchets, exceptions (owner and expiry).
4. **Write** it through one `construct:worker` at the repository root, plus one line in the repository's agent instruction file: `Read CONSTRAINTS.md before writing code. Do not weaken it to make a change pass.`
5. **Place checks by cost**: seconds-level checks after an edit, test and coverage on changed lines at task end, everything else in CI. Scope to the diff.
6. **Guard the bar** in review: compare `CONSTRAINTS.md` against the branch point; look for moved thresholds, easier tests, silenced checkers (including coverage, mutation, and security ignores), unfinished work, and unexplained exceptions.
7. Check that at least one constraint is external (a scanner, browser measurement, or vulnerability database), not judged only by the project's own tests.
8. Save each quality-bar decision with `construct-memory save` under `topic_key` `quality/<rule>`.

## Output Contract

Return the detected stack in two lines, then one question with its guess and default, or, once answered, the drafted `CONSTRAINTS.md` handed to a worker. After the write, report each rule with its command and the result of running it on the current codebase, plus any Floor finding in the diff. Close code changes with the Risk line.

## References

- [references/constraints-template.md](references/constraints-template.md): `CONSTRAINTS.md` template, default thresholds with reasons, ratchet rules.
- `construct:workflow`: the Risk line.
- `construct:workflow`: test-first and verification loop.
