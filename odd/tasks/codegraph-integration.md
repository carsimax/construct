# Integrate CodeGraph v1.6.2 into Construct

Objective: make agents actually use CodeGraph, aligned with upstream v1.6.2. Branch: `feat/codegraph-integration`, baseline `24b490d` (main). Delivery strategy: single-pr. Test runner: `node --test tests/`.

## Specs

- **S1 — Subagents learn CodeGraph.** Upstream: the MCP server's guidance reaches only the main agent, so subagents never see it. `hooks/contract/subagent.md` gains a short rule: structural questions (architecture, call flow, references, impact) go to `mcp__codegraph__codegraph_explore` first, or the `codegraph explore` CLI without the MCP tool, when the project has a `.codegraph/` index; otherwise fall back to file tools and say so.
- **S2 — Missing index is visible at session start.** The `SessionStart` contract output adds one line when the session's project is a git root with no `.codegraph/` directory, telling the agent the index is missing and that `codegraph init <root>` is the user's decision (suggest `! codegraph init <root>`). No line when the index exists or the directory is not a git root. The session contract stays under 8,000 characters; output for a given directory is identical across startup, resume, clear, and compact.
- **S3 — The skill no longer initializes on its own.** `skills/codegraph/SKILL.md`: a missing index means asking the user to run `codegraph init`, never running it (upstream: "indexing stays your decision"). The mandatory `codegraph sync` before CLI reads becomes "only when the staleness banner or results show a stale index" (upstream auto-syncs via its daemon). Document `codegraph.json` (`exclude`, `include`, `deprioritize`). Note that the MCP server exposes only `codegraph_explore`.
- **S4 — Setup docs match upstream.** README "MCP servers" and the skill's Setup: register CodeGraph with `alwaysLoad: true` (so `codegraph_explore` is not deferred behind ToolSearch) and allow `mcp__codegraph__*` in permissions.
- User scope confirmation (L2): "Si vamos con ese alcance".

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1, S2 | Subagent contract rule, session index notice in `contract.mjs`, tests | odd-worker (parallel with T2) | 3 (contract text and hook output) | done (RED 3 fail → GREEN 13/13) | 37a674a |
| T2 | S3, S4 | Rewrite codegraph skill, README MCP setup | odd-worker (parallel with T1) | none | done (skills 9/9) | cdb4fca |

## Log

- **L1 (2026-10-20, user):** "Podemos revisar algo que estoy detectando no se esta ocupando correctamente codegraph hasta el momento no se ha utilizado en ninguna sesion" then "de paso lee la ultima veriosn https://github.com/colbymchenry/codegraph para integrarlo mejor"
- **L2 (2026-10-20, user):** "Si vamos con ese alcance"
- **L3 (2026-10-20, parent):** Evidence: 13 sessions, 2 `codegraph_explore` calls (one odd-explorer), both returned "isn't indexed … don't call codegraph for it again"; `construct:codegraph` skill loaded 0 times; repo has no `.codegraph/`; `subagent.md` never mentions CodeGraph; local CLI is v1.6.2 = upstream latest; `.codegraph/` already gitignored.
- **L4 (2026-10-20, parent):** T1 and T2 done. `claude mcp add` has no alwaysLoad flag, so setup uses `claude mcp add-json --scope user`. `tests/skills.test.mjs` codegraph assertion updated to the new setup. `node --test tests/`: 567 pass, 0 fail. Session contract with notice: 7,105 chars. Notice fires only when cwd is itself a git root. Next: user runs `! codegraph init`, release bump and PR are user decisions.
