# CONSTRAINTS.md template and defaults

Adapted from agent-skills `constraint-driven-development` (MIT, Addy Osmani).

## Template

```markdown
# Constraints

Last reviewed: <date> by <owner>

## Floor (always enforced, no setup required)

- No new suppression comments: `@ts-ignore`, `eslint-disable`, `# noqa`, `# type: ignore`, `//nolint`
- No unimplemented stubs: `throw new Error("Not implemented")`, empty `catch {}`
- No skipped or deleted tests without a reason in the commit message
- No credentials or keys in source
- This file does not get weakened to make a change pass

## Enforced with numbers

| Dimension | Rule | Checked by | Runs at |
|---|---|---|---|
| Types | Zero type errors | `<project command>` | every edit |
| Lint | Zero errors from our config | `<project command>` | every edit |
| Leaked keys | None in source | `gitleaks detect --redact --no-banner` | every edit |
| Coverage | Changed lines >= 80% covered | `<test runner> --coverage` + git diff | task end, CI |
| Dependencies | Nothing at high or above | `osv-scanner scan source -r .` | CI |

Every row names the command that produces the verdict.

## Measured, not yet enforced

| Metric | Today | Direction |
|---|---|---|
| Project coverage | <measured> | must not fall |

## Exceptions

| ID | Rule | Path | Reason | Owner | Expires |
|---|---|---|---|---|---|
```

## Default thresholds

Use only when the user has no number; state the reason beside each.

| Constraint | Default | Reason |
|---|---|---|
| Coverage of changed lines | >= 80% | Forces a test, allows a config line |
| Project coverage | today's value, must not fall | Needs no argument to adopt |
| Mutation score (if used) | >= 60% to start | Typical for a never-mutated suite |
| Dependency vulnerabilities | nothing at high or above | Below that is mostly noise |
| LCP / CLS | <= 2500 ms / <= 0.1 | Core Web Vitals "good" |
| Accessibility | zero critical or serious axe violations | Lower levels are often debatable |
| Exception lifetime | 90 days | Long enough to plan, short enough to remember |
| Ratchet tolerance | 0.5% | Absorbs drift from unrelated files |

## Tools by dimension (use the project's own first)

| Dimension | Tool | Run |
|---|---|---|
| Types | tsc / mypy | `tsc --noEmit` / `mypy .` |
| Lint | existing config | `eslint .` / `biome check` / `ruff check` |
| Coverage | test runner | read the lcov the suite already writes; intersect with `git diff` |
| Code security | Semgrep | `semgrep scan --config p/default` |
| Leaked keys | gitleaks | `gitleaks detect --redact --no-banner` |
| Dependencies | osv-scanner | `osv-scanner scan source -r .` |
| Performance | Lighthouse / size-limit | needs a running URL / byte budget per entry |
| Accessibility | axe-core | needs a running URL |
| Architecture | dependency-cruiser | `depcruise --validate src` |

Notes:

- `--redact` on gitleaks is mandatory: report the rule and location, never the leaked value.
- Lighthouse and axe need a URL; for a CLI or library, drop them rather than invent a check.
- Scope expensive checks (mutation, Semgrep) to the changed files.
- Do not run the suite twice to get a coverage number.
- `CONSTRAINTS.md` is canonical; any `check:*` script mirrors it and the file wins on drift.

## Ratchets

Record today's value and a direction in "Measured, not yet enforced"; every check compares against the recorded value. When a number improves, update it; when it drops beyond the tolerance, that is the finding.

## Guard moves to look for in a diff

1. Threshold moved: a budget lowered, a severity dropped, a check removed from the fast stage.
2. Test made easier: skip added, test file deleted, assertions removed.
3. Checker silenced: new suppression, `istanbul ignore`, `Stryker disable`, `nosemgrep`, `gitleaks:allow`.
4. Work unfinished: throwing stub, empty `catch`, a `TODO` where code belongs.
5. Exception added without discussion.
