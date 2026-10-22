# Remove CodeGraph

Objective: Construct has no third-party dependency; CodeGraph (CLI, MCP server, skill, auto-index) is removed. Branch: feat/remove-codegraph. Baseline: c22668e. Delivery strategy: ask-on-risk. Test runner: `node --test tests/` and `claude plugin test plugins/construct`.

## Specs

- **S1 — No CodeGraph in the plugin.** "Vamos cone le plan de eliminarlo" (the plan: remove CodeGraph entirely). Delete `skills/codegraph/`; remove `mcp__codegraph__codegraph_explore` from every agent's `tools:` and from agent instructions; remove the CodeGraph sentence from `hooks/contract/session.md` and the CodeGraph rule from `hooks/contract/subagent.md`; remove the missing-index notice and auto-index from `hooks/scripts/contract.mjs`; remove `codegraph_auto_index` from `plugin.json`; remove `checkCodegraph` and its doctor row. Acceptance: `grep -ri codegraph plugins/construct` finds only the NOTICE attribution if still needed, or nothing.
- **S2 — Native replacement for structural questions.** Structural questions (architecture, call flow, references, impact) use the native `LSP` tool when a language server is available, otherwise Grep, Glob, and Read. Explorer and judge agents gain `LSP` in `tools:`. Assumption: `LSP` is a valid agent tool name.
- **S3 — Installer without npm or MCP.** `install.sh` no longer runs `npm install -g` or `claude mcp add`, and no longer requires npm. Assumption: `--no-mcp` stays accepted as a no-op so existing `curl ... | bash -s -- --no-mcp` commands keep working, and it is documented as deprecated. Assumption: an existing codegraph CLI or MCP server is left alone, with one line saying Construct no longer needs it (as engram is handled today).
- **S4 — Docs match.** README (install, options, `userConfig`, MCP servers section, doctor) and CONTRIBUTING (the consistency row's "CodeGraph notice") describe the system without CodeGraph; README tells users how to remove an earlier registration (`claude mcp remove --scope user codegraph`).
- **S5 — Tests follow.** Tests that assert CodeGraph behavior are removed or inverted (asserting its absence); `node --test tests/` and `claude plugin test plugins/construct` pass.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1, S2, S5 | Plugin: skill, agents, contracts, contract.mjs, plugin.json, doctor, NOTICE, and their tests | odd-worker (parallel with T2) | item 3 | done | 7bb62d6 |
| T2 | S3, S4, S5 | install.sh, its tests, README, CONTRIBUTING | odd-worker (parallel with T1) | item 3, item 5 | done | 9d162e8 |

## Log

- **L1 (2026-10-21, user):** "que nos falta para que nuestro sistema 100% claude native y sin dependencias" → analysis found CodeGraph as the only third-party dependency; recommended removing it, with Read/Glob/Grep primary and native `LSP` where a language server exists.
- **L2 (2026-10-21, user):** "Vamos cone le plan de eliminarlo"
- **L3 (2026-10-21):** Out of scope: Node.js runtime requirement and the `construct-memory` permission merge (both unverified whether removable); release and version bump stay with the user. `.gitignore` keeps `.codegraph/` so existing local indexes stay untracked.
- **L4 (2026-10-21):** T1 and T2 done. `node --test tests/`: 715 pass, 0 fail. `claude plugin validate --strict .`: passed. `claude plugin test plugins/construct`: 168 pass, 3 fail; the same 3 fail on c22668e (AskUserQuestion permission denied in this environment), so not caused here. Not verified: that `LSP` is accepted in agent `tools:` at runtime (validation accepts it). Slice: 616 authored lines in 2 commits, mostly deletions; no further commits planned. Review lenses (reliability, risk, resilience) and odd-verify launched on subject c22668e.
- **L5 (2026-10-21):** Review on c22668e..9d162e8: review-reliability, review-risk, review-resilience approved, no findings. odd-verify: S1-S5 pass, no blockers. Advisories applied in 84e90ff (test pins `LSP` in agent tools; `--no-mcp` warns like `--force`); `node --test tests/`: 716 pass, 0 fail. Advisories left: users with `codegraph_auto_index` set keep an unread setting (unknown-key handling unverified); `.gitignore` keeps `.codegraph/` by decision (L3). Lenses relaunched on the new head. Slice boundary: whole branch (630 lines, mostly deletions) is one PR.
- **L6 (2026-10-21):** Re-review on c22668e..84e90ff: review-reliability, review-risk, review-resilience approved, no findings. Branch ready for the user to push and open a PR; release/version bump (breaking: 5.0.0) is the user's.
