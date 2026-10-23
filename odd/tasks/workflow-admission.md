# Workflow admission

Objective: a `Workflow` tool call cannot launch a writing agent past delegation admission. Branch: feat/workflow-admission. Baseline: 7f50469. Delivery strategy: single-pr. Test runner: `node --test tests/`.

## Specs

- **S1 — A workflow may launch only read-only agents.** "Vamos con lo que sigu!" (to: "propongo cerrar el hueco del `Workflow` con la regla estricta: un hook `PreToolUse` sobre `Workflow` que niegue los scripts con agentes que puedan escribir, o con un `agent()` sin `agentType`"). `delegation-admission.mjs` also runs on PreToolUse `Workflow` and denies, with a reason naming the call and the allowed types, a script in which any `agent(...)` call lacks a literal `agentType` option, names a type outside the read-only set, or `agent` is used other than as a direct call. Read-only set: the registry's reader, lens, and judge kinds (`construct:explorer`, `construct:review-*`, `construct:judge-a`, `construct:judge-b`, prefix optional) and the built-in `Explore` and `Plan`. Strings, template text, and comments never count as calls; code inside `${...}` does.
- **S2 — Where the script comes from.** `script` is checked as given; `scriptPath` is read (relative to the cwd) and an unreadable path is denied; `name` is looked up as a saved workflow (`meta.name` in `.claude/workflows/*.js` of the project, then `~/.claude/workflows/*.js`) and checked when found; a name with no saved file (a bundled workflow such as `/deep-research`) and a bare `resumeFromRunId` pass. Any internal error fails open, as the rest of the hook does.
- **S3 — Docs.** README (delegation admission), CLAUDE.md hook list, and the delegation skill say that workflows are read-only and writes go through `construct:worker` with the Agent tool.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1, S2, S3 | Workflow admission in delegation-admission.mjs, hooks.json, tests, docs | parent | 2 | done (RED 8+1 fail; suite 1132/0; validate; live L3) | a858a2f |
| T2 | S1 | Close the bypasses the parent probing found (L4) | parent | 2 | done (RED 3+1 fail; suite 1134/0) | pending-commit |

## Log

- **L1 (2026-10-23, user):** "Vamos con lo que sigu!"
- **L2 (2026-10-23, parent):** Claude Code 2.1.309 workflow-authoring reference (binary): `agent(prompt, opts?: {label, phase, schema, model, effort, isolation, agentType})`; "opts.agentType uses a custom subagent type [...] instead of the default workflow subagent", and `isolation: 'worktree'` exists for "agents [that] mutate files", so the default workflow agent can write. deterministic-signals L2: a workflow's `agent()` fires no PreToolUse:Agent, so today it skips this hook. Discipline layer, not a sandbox: an aliased or computed reference to `agent` that the scanner cannot see is denied only when the bare identifier appears.
- **L3 (2026-10-23, parent, T1):** RED: tests/admission/workflow.test.mjs 8 fail, 3 pass (the allowed cases). Then green; added global-object, computed-key, and eval/Function denials (RED 1 fail first). Live `claude -p` on 2.1.309 with the plugin copy: an inline script `agent('Say hi')` was denied with the hook's reason ("no literal agentType"); `agent('...', { agentType: 'Explore' })` ran and returned "hi".
- **L4 (2026-10-23, parent, T2):** The independent review could not start: jd-judge-a failed with "spawn /opt/homebrew/Cellar/node/26.8.1/bin/node ENOENT" (Homebrew moved node to 26.12.1 mid-session; the Pi host keeps the old path; not retried). Parent probed bypasses against a858a2f instead and found eight that launched a writer: a duplicated `agentType` (first wins in the scan, last in JavaScript), a second argument object, `...spread` in the options, `const { agent: a } = x`, `\u0061gent(...)`, a regex literal holding a backtick (opened a false template), `globalThis['ag' + 'ent']` / `const g = globalThis`, and a computed or quoted `agentType` key after a valid one. Fixed test-first (RED 3 fail, then 1): every `agentType` key at an argument object's level must be a read-only literal, a spread, computed, or quoted key makes it non-literal, destructuring `agent` and any global-object reference are denied, an escape outside a string is denied, and regex literals are tokenized. Probed again (bypass scripts in /tmp/wfprobe): all denied; legitimate shapes (schema with arrays, division, template prompts, `{ agent: 1 }`) pass. Suite 1134/0.
