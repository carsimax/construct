---
name: constraints
description: Write the repository's quality bar as CONSTRAINTS.md. Use when the user asks for constraints, standards, or quality gates, when no CONSTRAINTS.md exists and a quality bar is wanted, or when a change silences a check or skips a test to reach green.
---

# Constraints

A quality bar is a short file of rules that a command can check. The Floor never weakens, numeric rules each name their command, and everything else is measured and held.

## Rules

- Detect before asking: read manifests, CI config, and existing linters first. Ask at most four questions, one per turn, each with a `GUESS:` and a `DEFAULT:`.
- A non-interactive run applies only the Floor and says so.
- Every numeric rule names the command that checks it and when it runs. No command, no rule. Never invent a number the user or a measurement did not give; each threshold states its reason.
- Install nothing without consent. List each dimension's cost (time, tool, URL needed) so the user can choose.
- Loosening a threshold, dropping a severity, or silencing a checker is the user's decision, and it is reported, never done quietly.
- At least one constraint is external to the code under test (a scanner, a browser, a vulnerability database), so the project cannot grade itself.

## Floor (always on)

- No new suppressions of type, lint, or security checks.
- No skipped or deleted tests without a stated reason.
- No stubs, throw-not-implemented bodies, or empty catch blocks.
- No credentials in the repository.
- No weakening of `CONSTRAINTS.md`.

Construct backs the Floor with hooks. The Risk-line gate blocks a reply when added lines carry skipped, focused, or stub test markers. command-guard always denies verifier bypasses such as `git commit --no-verify`, and asks before destructive commands only with `command_guard_asks` on. Neither reads `CONSTRAINTS.md`, so the file still holds the rules those hooks do not see.

## Flow

1. **Detect** the stack, existing checks, and CI.
2. **Ask** the remaining questions, one per turn, defaults offered. With no numbers given, measure today's value and hold it (a ratchet), and drop any dimension that needs a URL the project lacks.
3. **Defaults** when the user has no preference: coverage and security. Block on the Floor, warn on the rest for two weeks, then measure and hold.
4. **Write.** After the user answers, one `construct:worker` writes `CONSTRAINTS.md` from `references/constraints-template.md` and adds a one-line pointer to it in the repository's agent instructions file.
5. **Save** each quality-bar decision via `construct-memory save`, using `topic_key` `quality/<rule>`.

When a change silences a check or skips a test, stop: fix the cause, or ask the user whether to change the rule. Do not edit the rule yourself.

## Reference

- `references/constraints-template.md`: the file template, default thresholds with reasons, tools, and exceptions.
