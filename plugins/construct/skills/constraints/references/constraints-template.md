# CONSTRAINTS.md template

Fill every `Checked by` with a command that exists in the repository or that the user agreed to install.

```markdown
# Constraints

## Floor (never weakened)

- No new suppression markers: `@ts-ignore`, `eslint-disable`, `# noqa`, `# type: ignore`, `//nolint`.
- No skipped, focused, or deleted tests without a reason in the commit.
- No stub bodies that throw "not implemented", and no empty `catch`.
- No credentials or keys in the repository.
- This file is not weakened by the change it checks.

## Numeric rules

| Rule | Threshold | Checked by | Runs at |
|---|---|---|---|
| Type errors | 0 | `<typecheck command>` | pre-push, CI |
| Lint errors | 0 | `<lint command>` | pre-commit, CI |
| Leaked keys | 0 | `gitleaks detect --redact` | CI |
| Changed-line coverage | >= 80% | `<coverage command>` | CI |
| Dependency vulnerabilities (high, critical) | 0 | `<audit command>` | CI |

## Measured, not enforced (ratchets)

- Project coverage must not fall below the last recorded value (<N>%, tolerance 0.5%).

## Exceptions

| ID | Rule | Path | Reason | Owner | Expires |
|---|---|---|---|---|---|
| E1 | <rule> | <path> | <why> | <name> | <date, at most 90 days out> |
```

## Default thresholds

Use only when the user has no number and no measurement exists.

| Dimension | Default | Reason |
|---|---|---|
| Mutation score | >= 60% | tests that survive mutants prove little |
| Largest Contentful Paint | <= 2500 ms | "good" boundary of Core Web Vitals |
| Cumulative Layout Shift | <= 0.1 | "good" boundary of Core Web Vitals |
| Accessibility (axe) | 0 critical or serious | blocks real users |
| Ratchet tolerance | 0.5% | absorbs measurement noise |

Drop LCP, CLS, and axe when the project has no URL to test.

## Tools

Use the project's own tools first. When it has none, offer one default per dimension and ask before installing:

- Types and lint: the language's standard checker.
- Coverage: the test runner's built-in coverage.
- Secrets: gitleaks, always with `--redact`. Report the rule and file location of a finding, never the value.
- Dependencies: the package manager's audit command.
- Mutation: Stryker (JavaScript), mutmut (Python), or the ecosystem's equivalent.
- Performance and accessibility: Lighthouse and axe against a local URL.

Scope expensive checks (mutation, browser audits) to changed files or a nightly job so the commit path stays fast.

## Exceptions

An exception without an owner and an expiry is a permanent hole. Review expired entries; renewing one is the user's decision.
