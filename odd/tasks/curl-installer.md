# One-command curl installer

Objective: one `curl | bash` command sets up Construct and its tools and merges the Construct settings into the user's Claude Code settings. Branch: `feat/curl-installer`. Delivery strategy: ask-on-risk. Test runner: `node --test tests/`.

## Specs

- **S1 — Single curl command.** "podemos hacer un script que se instale con curl". The script is `install.sh` at the repository root and runs as `curl -fsSL https://raw.githubusercontent.com/carsimax/construct/<tag>/install.sh | bash`. The whole body runs from a function called on the last line, so a truncated download does nothing. Every external command gets `</dev/null`, so none of them reads the rest of the piped script.
- **S2 — Setup of all the tools.** "eso incluiria el setup de todas las herramientas". In order: preflight (`claude` >= 2.1.287, `node` >= 20, `git`; `brew` only when `engram` is missing), stopping with the missing item and no changes; engram binary through Homebrew when missing, then `engram setup claude-code`; the engram and construct marketplaces and `construct@construct`, each skipped when already present; the codegraph CLI and the codegraph and context7 user-scope MCP servers, each skipped when already registered, all skipped with `--no-mcp` (assumption: MCPs stay optional, as in the README).
- **S3 — Settings merge.** "setear los ajustes de settings.json de su claude". Merge into `~/.claude/settings.json`: `theme: "custom:construct:construct"`, `outputStyle: "construct:Neutral"`, and `permissions.allow` entries `mcp__engram` and `mcp__plugin_engram_engram` (server-level rules, assumption). Deep merge, never overwrite: other keys stay, `allow` is a union without duplicates. An existing different `theme` or `outputStyle` is kept with a warning unless `--force`. Back up to `settings.json.bak-<timestamp>` before any change; no write and no backup when nothing changes. Invalid JSON aborts with the file untouched. The installer never sets any other permission or `skipDangerousModePermissionPrompt`.
- **S4 — Idempotent and reported.** A second run changes nothing. The run ends with a summary of what was installed, skipped, and where the backup is.
- **S5 — Docs.** The README Quick path leads with the one-command install, the inspect-before-run alternative, the flags, and keeps the manual steps.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1-S4 | `install.sh` plus `tests/install/install.test.mjs` with stubbed `claude`, `brew`, `engram`, `npm` and a scratch `HOME`, run through piped stdin | inline | 5, 1 | done | see L5 |
| T2 | S5 | README install section | inline | none | done | see L6 |
| T3 | S3, S4 | Fix review and verify findings: symlink and mode kept, npm failure non-fatal, engram idempotency pinned | inline | 5, 1 | done | see L7 |

## Log

- **L1 (2026-10-20, user):** "ahora bien como podemos hacer el setup mas sencillo para los nuevos usuarios de mi herramienta podemos hacer un script que se instale con curl eso incluiireia el setup de todas las herramientas y setear los ajustes de settings.json de su claude como quedaria?"
- **L2 (2026-10-20, assistant):** Proposed design: preflight, engram, marketplaces and plugin, optional MCPs, Node-based deep merge with backup and `--force`, idempotent, pinned tag, no `skipDangerousModePermissionPrompt`.
- **L3 (2026-10-20, user):** "sí, impleméntalo"
- **L4 (2026-10-20):** Evidence: `/config` stores `outputStyle: "construct:Neutral"` in `~/.claude/settings.local.json`; `theme` is `custom:construct:construct` in `settings.json`. `engram setup claude-code` is non-interactive with an explicit agent. `claude mcp get <name>` exits 1 when missing. `claude plugin marketplace list` prints `Source: GitHub (<owner>/<repo>)`; `claude plugin list` prints `❯ <plugin>@<marketplace>`. No git tags exist yet.
- **L5 (2026-10-20):** T1 done. RED: `node --test tests/install/` failed with ENOENT on `install.sh`. GREEN: 9 pass. A second RED made the invalid-JSON test require that nothing is installed first; the settings check moved into preflight (`settings_tool check`), GREEN 9 pass. Full `node --test tests/`: 510 pass, 0 fail. `bash -n install.sh`: ok. Tests run under the macOS system `/bin/bash` 3.2.57. `shellcheck`: not installed, skipped. Not run against the real `~/.claude` (would change the user's settings).
- **L6 (2026-10-20):** T2 done. README gains "One-command install" (command, what it does, options, inspect-before-run) before Quick path, and an `install.sh` row in the layout table. Passive docs: no RED. `node --test tests/`: 510 pass. Pending for the user: push the branch, open the PR, and create and push the `v0.1.0` tag the curl URL points to.
- **L7 (2026-10-20):** odd-verify: S1, S2, S4, S5 PASS; S3 FAIL (B1 symlinked `settings.json` replaced by a regular file; B2 mode 600 loosened to 644). RDD lineage `review-2be65b667426cec9` (risk, resilience, readability, reliability) over `f504421..327174b`: approved and acknowledged, with WARNINGs matching B1/B2 (risk, resilience, reliability) and a failed `npm install -g` aborting before the settings merge (resilience). T3 RED: 3 new tests failed; GREEN after writing through `realpath` with the original mode and making the codegraph install non-fatal. The engram stub now registers its MCP server and the second-run test covers `engram setup`. `node --test tests/install/`: 12 pass. Advisory follow-ups, not fixed: a read-only `~/.claude` passes preflight and fails at the merge with a raw stack trace; an empty `settings.json` is treated as invalid.
