# Drop the context7 MCP server

Objective: stop installing, documenting, and naming the context7 MCP server; Claude's native fetch and search tools cover library documentation. Branch: `chore/drop-context7`, baseline `c7673a0` (main). Delivery strategy: ask-on-risk. Test runner: `node --test tests/`; `claude plugin validate --strict ./plugins/construct`.

## Specs

- **S1 — No context7 in delivery.** Source: "vamos a provechar esta sesion para quitar context7, realmente en ninguna sesion se ha ocupado y creo que haz ocupado mas tus capacidades nativas como Fetch". `install.sh` no longer registers context7 (no `CONTEXT7_PACKAGE`, no `add_mcp context7`); `--no-mcp` keeps its flag name and now skips only the codegraph CLI and the codegraph MCP server. Its help text, warnings, and header comment name only codegraph. The installer test asserts context7 is never registered.
- **S2 — No context7 in docs.** `README.md` and `plugins/construct/skills/codegraph/SKILL.md` no longer name context7 (registration command, tool names, `--no-mcp` row). Assumption: existing registrations on users' machines are left alone; the installer does not unregister them.
- **S3 — Worktree placement wording.** Carried from the same session: the CodeGraph skill's worktree rule defines `<repo-parent>` as the immediate parent of the repository root, with the `~/Projects/Rust/foo` example (upstream gentle-ai `fix(guidance)` #4151). Already applied before this feature started.

Historical feature documents (`odd-skills-plugin.md`, `curl-installer.md`) keep their context7 mentions as history.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S3 | CodeGraph worktree wording | odd-worker | none | done | — |
| T2 | S1, S2 | Remove context7 from `install.sh`, `tests/install/install.test.mjs`, `README.md`, codegraph skill | odd-worker | 5 | done | `chore: drop the context7 MCP server` |
| T4 | S1, S2 | Close the L6 follow-ups: `--no-mcp` test name and skip-message assertion; README removal hint for an existing context7 registration | odd-worker | none | done | `test: pin the --no-mcp skip message and document context7 removal` |
| T5 | — | Release 0.7.2 (`plugin.json` version) | parent | 5 | done | `chore: release 0.7.2` |
| T3 | S1 | Unregister context7 from the user's machine (`claude mcp remove --scope user context7`) | parent | none (reversible) | done | — |

Risk item 5: the installer is delivery; a broken MCP step would fail installs.

## Log

- **L1 (2026-10-20, user):** "vamos a provechar esta sesion para quitar context7, realmente en ninguna sesion se ha ocupado y creo que haz ocupado mas tus capacidades nativas como Fetch".
- **L2 (2026-10-20, parent):** References: `install.sh:3,19,29,155,164,170`; `tests/install/install.test.mjs:97`; `README.md:24,31,68,122`; `skills/codegraph/SKILL.md:58,61`. No agent, hook, or settings file references `mcp__context7__*`. Live registration: user scope in `~/.claude.json`.
- **L3 (2026-10-20, parent):** T3 done. `claude mcp remove --scope user context7` removed it; `claude mcp list` no longer shows it. Undo: `claude mcp add --scope user context7 -- npx -y --package=@upstash/context7-mcp@2.2.5 -- context7-mcp`.
- **L4 (2026-10-20):** T2 done. RED: the clean-machine installer test failed while `install.sh` still added context7; GREEN after removal, plus a negative assertion that no call names context7. The skill's tool sentence now names `mcp__codegraph__codegraph_explore`, which every agent lists. `node --test tests/` 625 pass; `claude plugin validate --strict ./plugins/construct` passed; `bash -n install.sh` OK; the only context7 hit left in delivered files is the negative assertion.
- **L5 (2026-10-20, RDD):** `odd-assess` c7673a0..ad8c0d9: high (process_boundary, shell_source in `install.sh`), review due. Consent granted. Lineage `review-0b56b64ef86a17b7`: 4 lenses, 0 findings, approved and acknowledged.
- **L6 (2026-10-20, odd-verify):** S1 PASS, S2 PASS, S3 PASS, no blockers. `--help` matches baseline except the `--no-mcp` line; `--no-mcp` and npm-failure tests pass; `git grep -i context7 HEAD -- . ':!odd/tasks'` hits only the negative assertion. Follow-ups (advisory, not done): the `--no-mcp` test name still says "MCP servers" and does not assert the new skip message (`tests/install/install.test.mjs:187`); the README does not say how to remove an existing context7 registration.
- **L7 (2026-10-20):** T4 done: `--no-mcp` test renamed to singular and asserts the `codegraph MCP server (--no-mcp)` skip message (RED seen with a broken regex, then restored); README tells users how to remove an earlier context7 registration. T5: `plugin.json` 0.7.2. `node --test tests/` 625 pass; both `claude plugin validate --strict` passed. No open follow-ups.
