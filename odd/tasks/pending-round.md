# Pending round

Objective: close the advisory follow-ups left open by mechanical-guards, panel-clean-room, and panel-default-bg, then release 6.1.0. Branch: fix/pending-round (release on chore/release-6.1.0 after it). Baseline: e55ea09. Delivery strategy: ask-on-risk; chains: stacked-to-main (fixes PR, then release PR). Test runner: `node --test tests/` and `claude plugin test plugins/construct`.

## Specs

- **S1 — `git restore` at the root asks.** "Vamos con esta ronda de todos los pendientes entonces" (mechanical-guards L6: "`git restore ./` and `:/` do not ask"). `git restore ./` and `git restore :/` (also after `--`) ask exactly as `git restore .` does, with the same `--staged`-only exception, reusing `ROOTS` in `command-guard.mjs`.
  - Given `git restore ./` When command-guard runs Then it asks; Given `git restore --staged :/` Then no output.
- **S2 — Exported hooks-path config is denied.** Same request (mechanical-guards L6: "`export GIT_CONFIG_PARAMETERS=...; git ...` as a separate statement is not caught"). A statement that sets `GIT_CONFIG_PARAMETERS` containing `core.hooksPath`, or `GIT_CONFIG_KEY_<n>=core.hooksPath`, through `export`, `declare` or `typeset` (any flags), `readonly`, `local`, or a bare assignment statement, is denied whether or not a `git` command shares that statement. Assumption: denying the assignment itself is acceptable, since nothing legitimate in this workflow sets these variables to a hooks path.
  - Given `export GIT_CONFIG_PARAMETERS="'core.hooksPath=/dev/null'"; git commit -m x` When command-guard runs Then it denies.
- **S3 — Trailing TODO comments are flagged.** Same request (mechanical-guards L7: "a trailing `// TODO` after code on the same line is not flagged"). The risk-line marker scan also flags an added non-Markdown line where code is followed by whitespace and a comment opener (`//`, `#`) and `TODO`. URLs (`http://`) and `#` with no whitespace before it (e.g. `a#TODO`) do not match. String literals that contain ` // TODO` may match; that limit gets a `shortcut:` comment.
  - Given an added line `x = 1 // TODO fix` When the check runs Then it blocks once naming `path:line`.
- **S4 — Double-width characters count as two columns.** Same request (panel-clean-room L14: "double-width names count as one column"). Panel row width and clipping in `hooks/panel/layout.js` count East Asian wide and fullwidth characters and emoji as two columns, so a row with such a name never exceeds its card width. No new dependency.
  - Given an agent name of CJK characters at 40 columns When the panel renders Then every row fits its width.
- **S5 — Subagents report what they did not add.** Same request (panel-default-bg L6: "the source's 'mention it at the end instead of doing it' route is missing"). The subagent contract's "Add nothing the prompt did not request" rule tells the subagent to name the unrequested work in its report instead. The injected contract stays at or under its 3,000-character cap. The other two L6 advisories are already settled: the evidence rule is scoped to runnable work, and "halt only if blocked" agrees with the worker's `partial` stop.
- **S6 — Release 6.1.0.** "Antes de eso ya esta publicado la ultma version y el release con su tag" / "Vamos con esta ronda de todos los pendientes entonces". Minor release carrying #54-#56 and S1-S5, following CONTRIBUTING.md Releases and the 6.0.0 release commit: `plugin.json` version, `install.sh` `CONSTRUCT_REF` and header URL, README badge, URLs, pinned tag, "Current version" and "Changes in 6.1.0" (6.0.0 list becomes a one-line summary), install test literals. Assumption: minor (6.1.0), because #55 changes what the panel shows. Tagging, GitHub Releases, and remote branch cleanup are the user's decisions.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1, S2 | `command-guard.mjs` restore roots and exported hooks-path config, with tests | worker | 2 | done (RED 10 fail; tests/guard 103/0) | 4d5c3fd |
| T2 | S3 | risk-line trailing TODO marker, with tests | worker | 6 | done (RED 2 fail; tests/risk-line 87/0; node --test 988/0) | 7442caa |
| T3 | S4 | Panel display width for wide characters, with tests | worker | 6 | done (RED 2 fail; mod 214/3 env, same 3 as baseline) | 5dbc679 |
| T4 | S5 | Subagent contract unrequested-work wording | worker | 6 | done (RED 1 fail; contract+word-budget 44/0; injected 2882 → 2933/3000) | fb7ebac |
| T6 | S2, S3 | Verifier advisories (L3): `readonly`/`local` start a hooks-path statement; header comment says `declare`/`typeset` with any flags; tests for `readonly`+bare `export`, `sh -c 'declare -x ...'`, `git restore --staged -- ./ :/` silent, `git restore -s HEAD :/` asks; risk-line header comment no longer claims every marker is line-anchored | worker | 2 | done (RED 2 fail; tests/guard 109/0; tests/risk-line 87/0) | 4e5b581 |
| T7 | S4 | Verifier advisory (L3): panel width test also covers wide text in the branch, ODD feature, and change path at widths 40-80 | worker | 6 | done (GREEN on HEAD, RED with e55ea09 layout.js; mod 215/3 env) | see log |
| T5 | S6 | Release 6.1.0 bump and notes | worker | 5 | pending | — |

## Log

- **L1 (2026-10-22, user):** "Vamos con esta ronda de todos los pendientes entonces" (after the list of open advisories and "Antes de eso ya esta publicado la ultma version y el release con su tag").
- **L2 (2026-10-22, parent):** Checked against the code at e55ea09: prompt-hardening's `Branch:` follow-up is already fixed (`feature-state.mjs:87-92`); the panel-default-bg L6 evidence and "stops only when blocked" advisories are settled by the construct-native rewrite; only the "mention it instead" route is left (S5). Out of scope here, user decisions: GitHub Releases for v4.0.0-v6.0.0 (tags exist, Releases stop at v3.0.0) and the 29 stale remote branches.
- **L3 (2026-10-22, review):** Subject e55ea09..13688a0: review-risk and review-reliability approved, no findings. Verifier: S1-S5 pass (guard probes: all new forms ask/deny, negatives silent; panel sweep 30-80 cols: baseline 710 rows over, candidate 0, ASCII byte-identical; suite 988/0; mod 214/3 env). Advisories applied as T6-T7: `readonly X=core.hooksPath; export X` bypass; S2 wording broader than `declare -x`; stale risk-line anchoring comment; S5 clause about shortening (cap held without it). Accepted: the branch's own TODO fixtures and the shortcut comment hit the trailing-TODO scan.

Next step: T6, T7 workers; recheck (lenses on the new subject, verifier recheck of the guard); then the fixes PR is the user's call; T5 after.
