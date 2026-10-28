// S4 of .vault/tasks/config-surface.md: while a feature document has an unfinished task, the main thread writes only .vault/tasks/.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { makeRepo, scratchDir } from '../helpers/repo.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const RECORD = join(PLUGIN, 'hooks/scripts/limits-record.mjs')
const ADMISSION = join(PLUGIN, 'hooks/scripts/delegation-admission.mjs')
const GUARD = join(PLUGIN, 'hooks/scripts/surface-guard.mjs')
const WORKER = 'construct:worker'

const baseEnv = (data) => {
  const env = { ...process.env, CLAUDE_PLUGIN_DATA: data }
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_PLUGIN_OPTION_INLINE_EDIT_MAX_LINES', 'CLAUDE_PLUGIN_OPTION_ITERATION_CAP']) delete env[k]
  return env
}
function run(script, args, data, input) {
  const r = spawnSync('node', [script, ...args], { input: JSON.stringify(input), encoding: 'utf8', env: baseEnv(data) })
  return { status: r.status, stdout: r.stdout }
}
const set = (data, session, ...pairs) => {
  // The main thread's `construct-limits set` is recorded by the limits-record hook (S1 of .vault/tasks/limits-hook.md).
  const r = spawnSync('node', [RECORD], { input: JSON.stringify({ session_id: session, cwd: process.cwd(), hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `construct-limits set ${pairs.join(' ')}` } }), encoding: 'utf8', env: baseEnv(data) })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /set recorded/)
}

// The feature document template of tests/feature-state/feature-state.test.mjs.
function doc(rows) {
  const body = rows.map(([id, task, status]) => `| ${id} | S1 | ${task} | worker | none | ${status} | — |`).join('\n')
  return `# Feature X\n\nObjective: do the thing.\nBranch: feat/x\n\n## Specs\n\n- **S1 — Same.**\n\n## Tasks\n\n| ID | Specs | Task | Route | Risk | Status | Commit |\n|---|---|---|---|---|---|---|\n${body}\n\n## Log\n`
}

// A 1-line main-thread Edit of src/a.js.
const edit = (data, repo, session = 's1') => run(GUARD, [], data, { session_id: session, cwd: repo, tool_name: 'Edit', tool_input: { file_path: join(repo, 'src/a.js'), old_string: 'a', new_string: 'b' } })
const writeTasks = (data, repo) => run(GUARD, [], data, { session_id: 's1', cwd: repo, tool_name: 'Write', tool_input: { file_path: join(repo, '.vault/tasks/x.md'), content: doc([['T1', 'First', 'done'], ['T2', 'Second', 'in progress']]) } })
const allowed = (r) => assert.deepEqual(r, { status: 0, stdout: '' })
const deniedNamingWorker = (r) => {
  assert.equal(r.status, 0)
  assert.notEqual(r.stdout, '', 'expected a deny, got no output')
  const out = JSON.parse(r.stdout).hookSpecificOutput
  assert.equal(out.permissionDecision, 'deny')
  assert.match(out.permissionDecisionReason, /construct:worker/)
}

describe('no inline writes during tracked work (S4)', () => {
  test('an unfinished task denies a 1-line main-thread edit naming construct:worker; .vault/tasks/ still passes', () => {
    const data = scratchDir('limits-tw-')
    const repo = makeRepo({ 'src/a.js': 'a\n', '.vault/tasks/x.md': doc([['T1', 'First', 'done'], ['T2', 'Second', 'pending']]) })
    deniedNamingWorker(edit(data, repo))
    allowed(writeTasks(data, repo))
  })

  test('the denial holds whatever the declared inline limit', () => {
    const data = scratchDir('limits-tw-')
    const repo = makeRepo({ 'src/a.js': 'a\n', '.vault/tasks/x.md': doc([['T1', 'First', 'in progress']]) })
    set(data, 's1', 'inline=500')
    deniedNamingWorker(edit(data, repo))
  })

  test('a writer subagent keeps its surface rule while a task is unfinished', () => {
    const data = scratchDir('limits-tw-')
    const repo = makeRepo({ 'src/a.js': 'a\n', '.vault/tasks/x.md': doc([['T1', 'First', 'pending']]) })
    const prompt = 'Do it\n\nSpec: .vault/tasks/x.md, T1\n\n## Allowed edit surfaces\nsrc/a.js\n\n## Verification\n- x\n'
    run(ADMISSION, [], data, { session_id: 's1', cwd: repo, tool_name: 'Agent', tool_input: { subagent_type: WORKER, prompt, description: 'u' } })
    run(ADMISSION, ['start'], data, { session_id: 's1', agent_id: 'a1', agent_type: WORKER })
    deniedNamingWorker(edit(data, repo))
    const asWorker = (path) => run(GUARD, [], data, { session_id: 's1', cwd: repo, agent_id: 'a1', tool_name: 'Write', tool_input: { file_path: join(repo, path), content: 'b\n' } })
    allowed(asWorker('src/a.js'))
    const outside = asWorker('src/b.js')
    assert.equal(JSON.parse(outside.stdout).hookSpecificOutput.permissionDecision, 'deny')
    assert.match(JSON.parse(outside.stdout).hookSpecificOutput.permissionDecisionReason, /src\/b\.js/)
  })

  test('with every row done the same 1-line edit passes and the declared inline limit applies', () => {
    const data = scratchDir('limits-tw-')
    const repo = makeRepo({ 'src/a.js': 'a\n', '.vault/tasks/x.md': doc([['T1', 'First', 'done'], ['T2', 'Second', 'done']]) })
    allowed(edit(data, repo))
    set(data, 's1', 'inline=300')
    const big = (n) => run(GUARD, [], data, { session_id: 's1', cwd: repo, tool_name: 'Edit', tool_input: { file_path: join(repo, 'src/a.js'), old_string: 'a', new_string: Array.from({ length: n }, (_, i) => `n${i}`).join('\n') } })
    allowed(big(300))
    assert.equal(JSON.parse(big(301).stdout).hookSpecificOutput.permissionDecision, 'deny')
  })
})
