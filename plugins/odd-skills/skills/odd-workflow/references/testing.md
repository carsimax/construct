# Test-first policy

Apply this to every ODD behavior change that has a relevant runnable deterministic test and a clear expected outcome:

1. Write one RED test per requested rule and observe it failing.
2. Implement until GREEN.
3. Refactor while the tests stay green.

## What a test covers

- Each test asserts every observable effect of the rule (output, exit code, persisted data) and goes through the public interface.
- Cover the cases the rule itself names.
- For every existing command or option the change touches, add one test proving its previous behavior still holds. An existing behavior counts as touched when it shares the code you changed (options, parsers, helpers, validation). Add no other cases.
- Committed tests never read git history or a fixed commit.

## Differential check

Before finishing, run each existing command that shares the changed code, with the new or changed input:

1. Against the previous code: a copy of the base commit in a `mktemp -d` scratch directory, never committed.
2. Against your change.

Compare stdout, stderr, and exit code. Any difference nobody asked for is a regression: fix it and pin it with a test.

## Exceptions

Tests or frameworks being present does not by itself make the policy apply. For passive documentation, unavailable runners, or no meaningful runnable RED, state the exception and run proportionate functional or structural checks. Never invent RED or GREEN evidence or a runner.

## Scratch state

Keep temporary directories, `HOME`, `TMPDIR`, and tool caches outside the worktree in a `mktemp -d` directory. When scratch must live inside the worktree, use a path git ignores and remove it before finishing. Subagents report scratch paths; the parent removes them after use.

## Checks per task

Run the focused test while iterating and the applicable full checks when a task closes, once each. A quick check runs once. Long work gets one cost forecast before launch.
