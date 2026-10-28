# Engram-only memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construct stops shipping its own memory (construct-memory store, CLI, MCP server, hooks, panel card) and relies entirely on Engram (https://github.com/Gentleman-Programming/engram) as a hard dependency.

**Architecture:** Pure deletion plus rewiring. Engram's own Claude Code plugin (`engram@engram`) already provides the `mem_*` MCP tools (server `engram`, user scope), the SessionStart context, prompt capture, SubagentStop passive capture of `## Key Learnings:` blocks, and SessionEnd. Construct keeps the instructions that tell agents *when* to use memory and points them at Engram's tools; the installer refuses to install when Engram is missing.

**Tech Stack:** Node.js ESM (22.16+), Markdown, bash installer, `node --test`, `claude plugin test`.

**Spec:** this plan (decisions taken with the user on 2026-10-27, listed below; no separate spec document).

## Global Constraints

- Engram is a hard dependency: the installer fails, installing nothing, when the `engram` binary is not on PATH or the `engram@engram` plugin is not installed.
- No data migration. Existing `construct-memory/` stores under the git common dir are left on disk untouched; nothing reads, exports, or deletes them.
- The panel MEMORY card is removed, not ported to Engram.
- The review-lens memory hints (`ODD_REVIEW_MEMORY_HINTS_*` in `review-context.mjs`) are removed with the store; Engram is not queried from hooks.
- Engram install text, verbatim: `brew install gentleman-programming/tap/engram && engram setup claude-code`.
- Engram tool names in this session: `mcp__engram__mem_*` (server `engram`). Contract text names tools as `mem_search`, `mem_save`, `mem_session_summary`, without the prefix.
- `MIN_NODE` stays `22.16` (no change requested; lowering it is out of scope).
- Release is `9.0.0` (breaking: the `construct-memory` CLI and the `memory` MCP server disappear).
- Commit messages follow CONTRIBUTING.md; no AI attribution lines (project CLAUDE.md overrides).
- Tests are not weakened: an assertion is deleted only when the behavior it pins is deleted by this plan, and each such deletion is listed in the task.

## Review Focus

1. A user with Engram binary but without the `engram@engram` plugin: installer must fail with the setup line, not install a Construct with no memory. (Task 4 test.)
2. A user who already has the old `mcp__plugin_construct_memory__*` and `Bash(construct-memory …)` allow rules: the installer leaves their existing rules alone (it never removes user rules) and adds none. (Task 4 test.)
3. Engram installed but `engram version` fails or times out: `/construct doctor` shows one failed `Engram` row and still renders the other rows. (Task 2 test.)
4. Stale references: any remaining `construct-memory`, `memory-store`, `memory-mcp`, `construct:memory` string in shipped files would point agents at a missing tool. (Task 3 grep check.)
5. Session contract still under 8,000 characters after the edit. (Existing contract test, Task 3.)

---

### Task 1: Remove the store, CLI, MCP server, and hooks

**Files:**
- Delete: `plugins/construct/hooks/scripts/memory-store.mjs`, `plugins/construct/hooks/scripts/memory-hooks.mjs`, `plugins/construct/hooks/scripts/memory-mcp.mjs`, `plugins/construct/bin/construct-memory`, `plugins/construct/.mcp.json`, `tests/memory/` (whole directory, fixtures included)
- Delete: `plugins/construct/evals/memory-recall/` (it seeds the construct store; Engram is a user-scope plugin the isolated eval run does not load)
- Modify: `plugins/construct/hooks/hooks.json` (remove the 5 entries whose args start with `${CLAUDE_PLUGIN_ROOT}/hooks/scripts/memory-hooks.mjs`; remove an event block only if it becomes empty)
- Modify: `plugins/construct/hooks/scripts/hook-io.mjs:40` (drop `'memory-hooks'` from `STATE_DIRS`)
- Modify: `plugins/construct/hooks/scripts/review-context.mjs:30-46,83` (delete `memoryHints` and its call; drop imports it alone used)
- Modify: `tests/review-hooks/review-hooks.test.mjs:9,427-494` (delete the `memory hints for lenses` describe block and the `DatabaseSync` import if unused) — deleted because the feature is deleted
- Modify: `tests/skills.test.mjs:126-130` (replace the "only MCP server is the plugin's own memory server" test)
- Modify: `scripts/eval.sh:18-26` (drop the `construct-memory` allow rules and their comment lines)

**Interfaces:**
- Produces: no `construct-memory` binary, no `.mcp.json`; later tasks must not reference them.

- [ ] **Step 1: Replace the MCP test in `tests/skills.test.mjs`**

```js
test('the plugin ships no MCP server; memory comes from Engram', () => {
  assert.equal(existsSync(join(pluginRoot, '.mcp.json')), false)
  assert.equal(existsSync(join(pluginRoot, 'bin/construct-memory')), false)
})
```

- [ ] **Step 2: Run it, expect FAIL** — `node --test tests/skills.test.mjs` → fails on `.mcp.json` existing.
- [ ] **Step 3: Delete the files and edit `hooks.json`, `hook-io.mjs`, `review-context.mjs`, `review-hooks.test.mjs`, `eval.sh` as listed.**
- [ ] **Step 4: Run** `node --test 'tests/**/*.test.mjs'` → only failures left are in tests Task 3/4 own (`contract.test.mjs` anchors, `install.test.mjs`, `agents-config.test.mjs`, skills list); note them, do not fix here. Also `grep -rn "memory-hooks\|memory-store\|memory-mcp" plugins tests scripts` → no hits.
- [ ] **Step 5: Commit** `refactor(memory)!: remove construct-memory store, CLI, MCP server, and hooks`

### Task 2: Mod — drop the MEMORY card and memory doctor, add an Engram doctor row

**Files:**
- Delete: `plugins/construct/hooks/status/memory.js`
- Modify: `plugins/construct/hooks/register.js:23-24,136,157,222,253-282` (remove `memoryStats`, `memoryDoctor`, `memoryBin`, `data.memory`; doctor rows become `[checkClaude, checkNode, checkEngram]`)
- Modify: `plugins/construct/hooks/status/doctor.js:36-58` (delete `MEMORY_PROBE`, `checkMemory`, `memoryDoctorRows`; add `checkEngram`)
- Modify: `plugins/construct/hooks/panel/layout.js:262-283,387,395` (delete `memoryCard` and the `memory` param of `buildPanel`)
- Test: `plugins/construct/tests/doctor.test.ts`, `panel.test.ts`, `panel-layout.test.ts`, `status.test.ts` (delete MEMORY card, memory probe, memory doctor, `parseMemoryStats` tests — feature deleted)

**Interfaces:**
- Produces: `checkEngram(out: string | null) => { ok: boolean, label: string, hint: string }` in `doctor.js`; `out` is stdout of `engram version` (e.g. `engram 3.6.0`). Label `Engram <version>` or `Engram (not found)`; hint `brew install gentleman-programming/tap/engram && engram setup claude-code`.

- [ ] **Step 1: Write failing tests in `doctor.test.ts`**

```ts
test('engram row reads `engram version`', () => {
  expect(checkEngram('engram 3.6.0\n')).toEqual({ ok: true, label: 'Engram 3.6.0', hint: expect.any(String) })
  for (const out of [null, '', 'garbage']) expect(checkEngram(out).ok).toBe(false)
  expect(checkEngram(null).hint).toBe('brew install gentleman-programming/tap/engram && engram setup claude-code')
})
```

and in `panel.test.ts`: `/construct doctor` with a run stub where `a[0] === 'engram'` returns `ok('engram 3.6.0')` shows `✓ Engram 3.6.0`; with it throwing or timing out shows `✗ Engram (not found)` and still shows the Node row.

- [ ] **Step 2: Run** `claude plugin test plugins/construct` → new tests FAIL.
- [ ] **Step 3: Implement** — `checkEngram` parses `/^engram (\d+\.\d+\.\d+)/`; `register.js` probes `runText($, ['engram', 'version'], cwd ?? undefined, GIT_MS)`; delete the memory code and tests listed.
- [ ] **Step 4: Run** `claude plugin test plugins/construct` → PASS; `grep -rn "memory" plugins/construct/hooks/status plugins/construct/hooks/panel plugins/construct/hooks/register.js` → no memory-card or construct-memory hits.
- [ ] **Step 5: Commit** `refactor(mod)!: drop the memory card; doctor checks Engram`

### Task 3: Rewire contracts, skills, agents, and docs to Engram

**Files:**
- Delete: `plugins/construct/skills/memory/` (Engram ships `engram:memory`)
- Modify: `plugins/construct/hooks/contract/session.md` items 2, 8, and the `construct:memory` line (~50)
- Modify: `plugins/construct/hooks/contract/subagent.md:31` (`memory-hooks saves them` → `Engram's SubagentStop hook captures them`)
- Modify: `plugins/construct/agents/explorer.md:18` (`Start with the mem_search tool (Engram)`)
- Modify: every hit of `grep -rln "construct-memory\|construct:memory" plugins/construct/skills .claude/skills` (workflow, review, debugging, constraints, sources, migration, delegation, `workflow/references/*`, `context-budget`, `mods`)
- Modify: `README.md` (Memory section → "Requires Engram", install lines), `CONTRIBUTING.md:13,71,76` (prerequisite adds Engram; drop the memory row; drop the `construct-memory` example), `CLAUDE.md` (Memory sentence, `memory` skill, memory hooks/MCP in Architecture), `SECURITY.md` if it names the store
- Test: `tests/contract.test.mjs:62-63`, `tests/skills.test.mjs:14`, `tests/agents-config.test.mjs:86-100`

**Interfaces:**
- Consumes: Task 1 (no CLI), Engram tool names from Global Constraints.

- [ ] **Step 1: Update tests first**
  - `contract.test.mjs`: anchors `'construct:memory'`, `'construct-memory'` → `'mem_search'`, `'Engram'`; add `assert.doesNotMatch(text, /construct-memory|construct:memory/)`.
  - `skills.test.mjs:14`: remove `'memory'` from the skill list.
  - `agents-config.test.mjs`: the "no engram tool" test keeps `gentle-ai` and drops the engram assertion; the explorer test becomes `explorer tells agents to recall with mem_search` (`assert.match(text, /mem_search/)`), keeping `manifest.dependencies === undefined` (Engram is not a plugin dependency; the installer enforces it).
- [ ] **Step 2: Run** `node --test tests/contract.test.mjs tests/skills.test.mjs tests/agents-config.test.mjs` → FAIL.
- [ ] **Step 3: Edit the text.** Session item 2: "Recall memory first with Engram's `mem_search` tool (load it through tool search when deferred), proportionately." Item 8: "Save decisions, root causes, and conventions with `mem_save` (large work also `mem_session_summary`)". Skill pointer line: "`engram:memory`: saving, recalling, or consolidating memory." Remove every CLI fallback.
- [ ] **Step 4: Run** `node --test 'tests/**/*.test.mjs'` (only `install.test.mjs` may still fail) and `grep -rn "construct-memory\|construct:memory\|memory-store\|memory-mcp" plugins README.md CONTRIBUTING.md CLAUDE.md SECURITY.md .claude/skills` → no hits (CHANGELOG and `odd/tasks/` are history and stay).
- [ ] **Step 5: Commit** `docs(memory)!: contracts, skills, and docs use Engram`

### Task 4: Installer requires Engram

**Files:**
- Modify: `install.sh:85-87` (delete the `node:sqlite` FTS5 probe), `:98-103` (replace `note_engram` with `require_engram`), `:157-163,211` (delete the memory allow rules and their report line)
- Test: `tests/install/install.test.mjs` (delete `MEMORY_RULES` and the tests pinning them, the FTS5 probe tests at ~292 and ~526, and the two "engram is never installed / not needed" tests at ~544-561 — all pin deleted behavior; add the tests below)

**Interfaces:**
- Produces: `require_engram()` in `install.sh`, called before anything is written. Fails when `has engram` is false, or when `run claude plugin list` output lacks `engram@engram`. Message, both cases: `Construct needs Engram for memory; install it with: brew install gentleman-programming/tap/engram && engram setup claude-code`.

- [ ] **Step 1: Write failing tests** (sandbox gains a `claude plugin list` stub that prints `engram@engram` when `engramPlugin: true`)

```js
test('without the engram binary nothing is installed and one line says how to get it', () => {
  const run = install(sandbox({ engram: false }))
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /brew install gentleman-programming\/tap\/engram && engram setup claude-code/)
  assert.deepEqual(run.calls.filter((c) => /claude plugin (install|marketplace add)/.test(c)), [])
})
test('engram binary without the engram@engram plugin also fails before installing', () => { /* same assertions, sandbox({ engram: true, engramPlugin: false }) */ })
test('with engram and its plugin, install proceeds and adds no memory allow rule', () => {
  const box = sandbox({ engram: true, engramPlugin: true })
  const before = { permissions: { allow: ['Bash(construct-memory search *)'] } }
  // write `before` to settings, run, then:
  assert.deepEqual(readSettings(box).permissions.allow, before.permissions.allow, 'old user rules are kept, none added')
})
```

- [ ] **Step 2: Run** `node --test tests/install/install.test.mjs` → FAIL.
- [ ] **Step 3: Implement** `require_engram` and the deletions; existing sandboxes that must install get `engram: true, engramPlugin: true` as their default.
- [ ] **Step 4: Run** `node --test 'tests/**/*.test.mjs'` → all PASS.
- [ ] **Step 5: Commit** `feat(install)!: require Engram`

### Task 5: Release 9.0.0

**Files:** `plugins/construct/.claude-plugin/plugin.json`, `install.sh` (`CONSTRUCT_REF` and header URL), `CHANGELOG.md`, README badge/install lines and install test refs (as in the 8.7.0 release commit `42d4f82`).

- [ ] **Step 1:** `CHANGELOG.md` `Unreleased` → `9.0.0` with a **Breaking** note: construct-memory CLI and MCP server removed; Engram required; old stores stay on disk and are not migrated.
- [ ] **Step 2:** Bump the version everywhere `git show 42d4f82 --stat` touched.
- [ ] **Step 3: Verify** `node --test 'tests/**/*.test.mjs'`, `claude plugin test plugins/construct`, `claude plugin validate --strict .`, `claude plugin validate --strict ./plugins/construct` → all pass.
- [ ] **Step 4: Commit** `chore: release 9.0.0`. Push and PR only when the user asks.
