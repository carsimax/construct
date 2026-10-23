# Memory MCP first

Objective: Claude recalls and saves memory through the `mem_*` MCP tools without being told to, with the CLI as the fallback. Branch: feat/memory-mcp-first. Baseline: 2c323b3. Delivery strategy: single-pr. Test runner: `node --test tests/`.

## Specs

- **S1 — The session contract names the tools first.** "Si vamos con robustecer el contrato" (to: "cambiar el contrato para que diga 'busca con `mem_search` (MCP de memoria) primero; `construct-memory` si la herramienta no está'"). Step 2 (Explore) recalls with the `mem_search` tool first, loading it through tool search when it is deferred, and `construct-memory search <area>` only when the tool is missing. Step 8 (Close) saves with `mem_save` (large work also `mem_session_summary`), else `construct-memory save`. The injected contract stays at or under 8,000 characters.
- **S2 — The SessionStart Memory line is an instruction.** It tells Claude to call the `mem_*` tools of the construct memory MCP server and names `construct-memory` as the fallback, keeping the session id and the absolute CLI path.
- **S3 — The memory skill leads with the tools.** "reescribir el skill con las herramientas `mem_*` primero y el CLI como alternativa". Its intro maps each CLI command to its tool and says to call the tool and use the CLI only when the tool is missing or the command is CLI-only; it stays at or under 800 words and keeps every command, flag, relation, and type it names. `construct:explorer` keeps the CLI (fixed tool list).
- **S4 — Live check.** "Verificación: con `claude -p`, pidiendo 'busca en la memoria X' sin mencionar MCP, comprobar que llama a `mem_search`." Same prompt and permissions before (main) and after (this branch), 3 runs each; the first memory call of each run is recorded.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S4 | Baseline live runs on main | parent | none | done (1/3 MCP first) | see L3 |
| T2 | S1, S2, S3 | Contract, Memory line, skill, tests | parent | 3 | done (RED 5 fail; suite 1175/0) | see L4 |
| T3 | S4 | Live runs on the branch | parent | none | done (3/3 MCP first) | see L5 |

## Log

- **L1 (2026-10-23, user):** "Si vamos con robustecer el contrato"
- **L2 (2026-10-23, user report):** In a Claude Code 8.6.0 session, "Pudes consultar las memorias?" ran a shell command; only "Pero por medio del mcp se puede?" made Claude load and call `mem_search` ("hasta que le dije explicitamente que use el mcp lo uso"). Parent: session.md:8 says "Run `construct-memory search <area>` first" and step 8 says `construct-memory save`; the memory skill names `construct-memory` 18 times in its procedures; Claude Code defers MCP tool schemas until a tool search, while Bash is already loaded.
- **L3 (2026-10-23, parent, T1):** Baseline on main (git archive 2c323b3, `--plugin-dir` overrides the installed 8.6.0), prompt "¿Puedes consultar las memorias sobre zebra-quartz?", both the CLI and the mem tools allowed: run 1 ToolSearch -> mem_search -> mem_get_observation (then a grep in the plugin cache); runs 2 and 3 went straight to `construct-memory search` through Bash. All three found the marker. About $0.21-0.24 per run.
- **L4 (2026-10-23, parent, T2):** RED: 5 fail (contract order and tool search, the Memory line in 3 hook tests, the skill mapping). GREEN: contract step 2 recalls with `mem_search` first (tool search when deferred), step 8 saves with `mem_save` and `mem_session_summary`; the Memory line is an instruction; the skill intro maps the ten tools to their commands and says to call the tool. Injected contract 7208/8000 characters; skill 797/800 words (the "Where memory is used" paragraph and three others rewritten in place). Suite 1175/0.
- **L5 (2026-10-23, parent, T3):** Branch copy, same prompt and permissions: all three runs went ToolSearch -> mem_search -> mem_get_observation and found the marker; none called the CLI. Baseline was 1/3. Run 3 (and baseline run 1) also grepped `~/.claude/plugins` for the marker after answering, outside the scratch repository; unrelated to this change, not addressed. About $0.23-0.24 per run; six runs total.
