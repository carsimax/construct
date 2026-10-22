# Testing

Test-first when a runnable, deterministic test and a clear expected outcome exist. A non-runnable unit states the exception and runs structural checks. Never invent RED or GREEN.

1. One failing test per requested rule; observe RED.
2. Implement until GREEN; refactor with the tests green.
3. Each existing command or option the change touches gets one test proving its prior behavior.

## A test is worth keeping when

- It fails on a real regression, uses the public interface, and no existing test covers it.
- It asserts every observable effect: output, exit code, persisted data.
- These do not count: source-text matches, no-throw checks, snapshot-only, a mock-was-called check.
- Committed tests never read git history.

## Weakening a verifier

Never: skip a test, delete an assertion, suppress an error, widen a type, or commit a real credential or a fixture holding one.

## Runner

Find the repository's own runner before the first test (scripts, Makefile, CONTRIBUTING, CI); never assume `npm test`. Iterate with the focused command, then run the full suite once at close. Report each as `<command>: <observed result>`.

The Risk-line hook blocks a reply that adds skipped, focused, or stub test markers (`.skip`, `.only`, `xit`, `NotImplementedError`, a `TODO` comment).
