## What and why

<!-- The change, the issue it closes (Closes #N), and anything a reviewer should look at first. -->

## Checks

CI runs these; tick the ones you ran locally.

- [ ] `node --test 'tests/**/*.test.mjs'`
- [ ] `claude plugin test plugins/construct`
- [ ] `claude plugin validate --strict .`
- [ ] `claude plugin validate --strict ./plugins/construct`
- [ ] Docs and help text updated for any changed command, option, or message ([consistency table](https://github.com/carsimax/construct/blob/main/CONTRIBUTING.md#consistency-the-tests-enforce))

## Risk

<!-- One line: `Risk: none` or `Risk: item N (reason)`, using the six items in plugins/construct/hooks/contract/session.md. -->

Risk:
