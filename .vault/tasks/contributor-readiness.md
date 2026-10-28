# Contributor readiness

Objective: make the public repository ready for outside feedback and contributions: CI, security policy, issue and PR templates, a changelog, and an easier entry in the docs. Branch: chore/contributor-readiness. Baseline: 5e92b62. Delivery strategy: single-pr. Test runner: `node --test 'tests/**/*.test.mjs'`.

## Specs

- **S1 — CI runs the four checks.** "Un workflow de GitHub Actions con `node --test tests/` en Node 22, más un intento de las validaciones `claude plugin validate` si el CLI se puede instalar en CI." On every pull request and push to `main`: the repository tests (`node --test 'tests/**/*.test.mjs'`, see L2) on Node 22.16.0 (the floor) and Node 24; `claude plugin test plugins/construct` and both `claude plugin validate --strict` runs with `@anthropic-ai/claude-code@2.1.304` (the documented minimum). Read-only `contents` permission, no secrets. Parent evidence: validate and test pass with an empty `HOME` and no login.
- **S2 — Security policy.** "`SECURITY.md`. El plugin tiene guards, una publication gate e instala permisos en `~/.claude/settings.json`, así que alguien va a encontrar un bypass y necesita un canal privado para reportarlo." Private reporting through GitHub security advisories, supported version, what is in scope, and the statement that the guards are a discipline layer, not a security boundary.
- **S3 — Issue and PR templates.** "Un `bug_report` debería pedir la versión de Claude Code y de Node y la salida de `/construct doctor`". Bug report and feature request issue forms, a config linking the security policy, and a PR template with the four checks and the Risk line.
- **S4 — Changelog.** "`CHANGELOG.md` arrancando desde 8.x." Entries for 8.0.0 through 8.6.1 from the tagged release commits, an Unreleased section, and a Releases step in CONTRIBUTING that updates it.
- **S5 — Easier entry.** "Con este ritmo de versiones, los usuarios necesitan saber qué cambió"; "un 'qué es ODD en 30 segundos'"; "Anunciarlo como preview, pidiendo retro de uso (issues) antes que PRs." README states the project is a preview, says what ODD is in a few lines, and links feedback, changelog, security, and contributing. CONTRIBUTING says requirements up front, issues before PRs, `good first issue`, and that CI runs the checks.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1 | CI workflow | parent | 5 | done (22.16 glob 1176/0; validate and mod tests pass on 2.1.304; not yet run on GitHub) | 7ef0f57 |
| T2 | S2, S3 | SECURITY.md and GitHub templates | parent | none | done (YAML parses) | 243a422 |
| T3 | S4, S5 | CHANGELOG, README and CONTRIBUTING entry | parent | none | done (suite 1176/0, mod 223/0, validate both) | 470eadf |

## Log

- **L1 (2026-10-23, user):** "Podemos it con ese plan completo" (the plan: CI; SECURITY.md, issue and PR templates, CHANGELOG from 8.x; announce as a preview asking for usage feedback before PRs).
- **L2 (2026-10-23, parent evidence):** On Node 22.16.0, `node --test tests/` fails (`Cannot find module '.../tests'`: Node 22 takes no directory argument), so the documented check broke on the documented floor. `node --test 'tests/**/*.test.mjs'` runs the same 1176 tests on 22.16.0 and 26.12.1 (1176 pass, 0 fail). CI, CLAUDE.md, CONTRIBUTING, the PR template, and the authoring skill use the quoted glob. `claude plugin validate --strict` (both) and `claude plugin test` pass on 2.1.304 with an empty `HOME`.
- **L3 (2026-10-23, parent):** Private vulnerability reporting was off on carsimax/construct; enabled it (`gh api -X PUT .../private-vulnerability-reporting` → `{"enabled":true}`) so SECURITY.md's link works.
- **L4 (2026-10-23, native review):** lineage review-08de1fa26c09c995 over origin/main..470eadf, lenses risk and readability: approved and acknowledged. Advisory, non-blocking follow-ups: pin `actions/checkout` and `actions/setup-node` to commit SHAs (ci.yml:29-30); the global npm install of `@anthropic-ai/claude-code@2.1.304` has no lockfile (ci.yml:46); 8.6.1 is described in both CHANGELOG and README Status (kept: the release step updates both); S1 still named the old command (fixed here).
