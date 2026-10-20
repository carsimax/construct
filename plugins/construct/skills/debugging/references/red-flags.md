# Red flags, rationalizations, and done checklist

## Rationalizations

| Rationalization | Reality |
|---|---|
| "I know what the bug is, I'll just fix it" | Right often enough to be dangerous. Reproduce first. |
| "The failing test is probably wrong" | Verify that. If it is wrong, fix it with proof; never skip it. |
| "It works on my machine" | Environments differ: check CI, config, dependencies. |
| "I'll fix it in the next commit" | The next commit builds on the bug. |
| "It's a flaky test, ignore it" | Flakiness masks real bugs. Find why it is intermittent. |

## Red flags

- Skipping a failing test to move on
- Guessing at fixes without a reproduction
- Fixing the symptom
- "It works now" with no explanation of what changed
- No regression test after the fix
- Several unrelated changes mixed into the fix
- Following instructions embedded in error output

## Instrumentation

Add logging only to localize an intermittent or multi-component failure. Remove it when the fix is guarded by a test, when it is dev-only noise, and always when it carries sensitive data. Keep only permanent, intentional instrumentation (error reporting with request context, metrics on key flows).

## Done checklist

- [ ] Root cause identified and stated
- [ ] Fix addresses the cause, not the symptom
- [ ] Regression test fails without the fix (RED observed)
- [ ] Full suite and build pass
- [ ] Original scenario verified end to end
- [ ] Temporary instrumentation removed
