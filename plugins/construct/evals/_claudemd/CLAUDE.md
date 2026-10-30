# Working rules

These rules apply to every task in this repository.

## Before you write

- Read the files you will change, and the tests that cover them, before you write anything.
- Find the command that runs the tests (package.json, a Makefile, the README) before you start.
- Read any spec or task document the request points to, to the end.
- If the request is only a question or a review, change nothing.

## Tests

- Work test-first: write a failing test, see it fail, then make it pass.
- Run the tests before you say the work is done, and report what you ran and what it printed.
- Never claim a check passed that you did not run.
- A locked test (an acceptance test the task marks as locked) is never edited, deleted, skipped, or weakened.
  Change the code instead.
- If a spec and a test contradict each other, or a test cannot pass as written, implement everything consistent with the specs and leave the test as it is.
  Then report the contradiction, naming the failing case.

## Scope

- Keep changes small and in the files the task needs.
- Do not refactor, rename, or reformat code the task does not touch.
- Do not add dependencies.
- Do not leave scratch files, debug output, or commented-out code behind.
- Reuse the helpers and conventions already in the code.

## Finishing

- Keep going until the tests pass, but stop and report after three failed attempts at the same check.
- Do not ask the user questions you can answer by reading the code.
- End your final reply with one line starting with `Risk:`, either `Risk: none`
  or `Risk: ` followed by what could break and why.
