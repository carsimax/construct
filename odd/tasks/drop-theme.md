# Drop the Construct theme

Objective: stop shipping the Construct color theme and clean the `theme` setting earlier installs wrote. Branch: `chore/drop-theme`, baseline `6525fbd` (main). Delivery strategy: ask-on-risk. Test runner: `node --test tests/`; `claude plugin test plugins/construct`; `claude plugin validate --strict ./plugins/construct`.

## Specs

- **S1 — No theme in the plugin.** Source: "podemos eliminar el tema que gestiona nuestro harness?". `plugins/construct/themes/` is deleted. `tests/styles.test.mjs` asserts the plugin ships no `themes/` directory instead of checking the palette. The status panel keeps coloring with theme keys, so it follows whatever theme is active.
- **S2 — The installer cleans the old theme.** Source: "si, debemos limpiar el theme". `install.sh` no longer sets `theme`. When `~/.claude/settings.json` has `theme` equal to `custom:construct:construct`, the merge deletes that key (with the usual backup) and reports it as changed (`+ theme custom:construct:construct removed`). Any other `theme` value, and a missing one, stays untouched with no warning. A second run changes nothing. `~/.claude/settings.local.json` is not touched.
- **S3 — `--force` is deprecated, not removed.** `--force` is still accepted for one release so scripted installs do not fail; it has no effect and the installer prints a warning saying so. The help text marks it deprecated. Assumption: it is removed in a later release.
- **S4 — Docs.** `README.md` (feature list, installer bullets, `--force` row, setup steps, theme section) and `CLAUDE.md` no longer describe a shipped theme; the README states that the installer removes the old `custom:construct:construct` value. Historical feature documents keep their theme mentions as history.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1–S4 | Delete the theme, change the installer merge and `--force`, update tests and docs | odd-worker | 1, 5 | done | `feat(installer): drop the Construct theme and clean its setting` |
| T2 | — | Release 1.1.0 (`plugin.json` version) | parent | 5 | done | `chore: release 1.1.0` |

Risk item 1: the installer edits the user's persisted `settings.json`. Item 5: the installer is delivery.

## Log

- **L1 (2026-10-20, user):** "podemos eliminar el tema que gestiona nuestro harness?" then "si, debemos limpiar el theme".
- **L2 (2026-10-20, parent):** References: `plugins/construct/themes/construct.json`; `install.sh:7,29,183,187,301,307`; `tests/styles.test.mjs:41-67`; `tests/install/install.test.mjs:100,120,137,156,159-170,274,300`; `README.md:17,43,45,50,90,142,369-371`; `CLAUDE.md:9`.
- **L3 (2026-10-20):** T1 done. RED: 11 failures in the installer and styles tests before the change; GREEN: `node --test tests/` 835 pass, `claude plugin test plugins/construct` 139 pass, `claude plugin validate --strict ./plugins/construct` passed, `/bin/bash -n install.sh` (3.2.57) OK. Not run against a real Claude Code install.
- **L4 (2026-10-20):** odd-verify: S1–S4 pass, no blockers. Advisories closed: README badge and Status line at 1.1.0, dead `!` branch and comment removed from `install.sh`, tests added for `settings.local.json` untouched and `--force` no-op (green before the change; guards). `node --test tests/` 837 pass. The v1.1.0 installer URLs need the `v1.1.0` tag (release step 3, user's call).
