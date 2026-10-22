# Test-first policy

Apply this to every ODD behavior change that has a relevant runnable deterministic test and a clear expected outcome:

1. Write one RED test per requested rule and observe it failing.
2. Implement until GREEN.
3. Refactor while the tests stay green.

## Test value bar

A test earns its place only when it would fail on a real regression of the behavior it names, checks behavior through the public interface instead of implementation, and is not already covered by an existing test (extend that one instead). These do not count as tests: assertions on source text, success or no-throw checks, snapshot-only checks, checks that a mock was called, and tests that mock away the integration they claim to cover. A test that breaks under a behavior-preserving refactor asserts implementation; move it to the owning boundary.

## Discover the stack first

The cycle is universal; the commands are not. Before the first test, find how this repository tests and use its commands for every RED, GREEN, and verification step:

- Build system and language: `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle`, `Gemfile`, `Makefile`.
- Checked-in wrappers: prefer `./gradlew`, `./mvnw`, `make test`, or a repo script over a globally installed tool.
- Framework and configuration: how it runs one focused test and how it runs the full suite.
- Conventions: where tests live, how files are named, what neighboring tests do.
- Documented commands: README, CONTRIBUTING, and CI workflows show what actually gates a merge.

Never assume a default such as `npm test`. Run the focused command while iterating and the full-suite command at close. If no runner exists, use the Exceptions below; never invent one.

## Never weaken the verifier

A check turned green by loosening it proves nothing. These are never acceptable ways to reach GREEN, unless the user asked for it with a stated reason:

- Adding a suppression (`// @ts-ignore`, `eslint-disable`, `# noqa`, `#[allow]`, `@SuppressWarnings`) to silence the failure.
- Skipping, disabling, or deleting a test or assertion, or loosening an expected value to match wrong output.
- Stubbing the behavior under test, leaving an unimplemented body, or an empty `catch` that swallows the error.
- Committing a credential, or a fixture holding a real one, to make a test run.
- Widening a type, lowering a threshold, or editing a constraints file to let the change pass.

Fix the cause. When a test is wrong, change it with a stated reason and say so in the report.

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
