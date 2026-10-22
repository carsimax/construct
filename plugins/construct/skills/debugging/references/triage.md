# Triage

## Cannot reproduce

Compare, in order: timing (races, timeouts, clock, ordering), environment (versions, OS, variables, config, network), state (stale cache, leftover data, migrations, shared fixtures), randomness (seeds, hash order, concurrency). Repeat the run 20 times or pin the seed. Record which variable made it fail. Without a reproduction, report the triage and what evidence is missing; never claim a fix.

## Which layer

Walk from the symptom inward and stop at the first layer whose input is already wrong: UI, API, data, build, external service, test. Print or inspect the value at each boundary; instrument only when the failure is intermittent or crosses components, and remove it after the guard test passes, at once if it logs sensitive data.

## By failure kind

- Test failure: read the assertion and the diff of expected and actual. Decide whether the code or the test encodes the wrong contract by checking the spec, not by guessing. Run the test alone, then in the suite; a difference means shared state or order.
- Build failure: read the first error, not the last. Check versions, lockfile drift, generated files, config changes since the last green build (`git log`, `git bisect`).
- Runtime failure: take the stack trace to the first frame in your code; check inputs there for null, type, range, and encoding; check what changed in the data or the deployment.

## Where the fix lives

Correct the origin: the query that returns wrong rows, the writer that stored bad data, the caller that passes the wrong shape. A guard or default downstream that hides the symptom leaves the bug in place for the next reader. If the cause is outside the repository, fix what you own and record the external cause.
