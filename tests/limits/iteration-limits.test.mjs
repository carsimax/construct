// S3 of .vault/tasks/config-surface.md: iteration-cap reads the cap from `construct-limits`, per session, clamped to 10.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { scratchDir } from '../helpers/repo.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const RECORD = join(PLUGIN, 'hooks/scripts/limits-record.mjs')
const HOOK = join(PLUGIN, 'hooks/scripts/iteration-cap.mjs')
const CMD = 'node --test tests/a.test.mjs'

const baseEnv = (data, extra = {}) => {
  const env = { ...process.env, CLAUDE_PLUGIN_DATA: data, ...extra }
  delete env.CLAUDE_CODE_SESSION_ID
  for (const k of ['CLAUDE_PLUGIN_OPTION_INLINE_EDIT_MAX_LINES', 'CLAUDE_PLUGIN_OPTION_ITERATION_CAP']) if (!(k in extra)) delete env[k]
  return env
}
const set = (data, session, ...pairs) => {
  // The main thread's `construct-limits set` is recorded by the limits-record hook (S1 of .vault/tasks/limits-hook.md).
  const r = spawnSync('node', [RECORD], { input: JSON.stringify({ session_id: session, cwd: process.cwd(), hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `construct-limits set ${pairs.join(' ')}` } }), encoding: 'utf8', env: baseEnv(data) })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /set recorded/)
}
function hook(data, payload, extra) {
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(payload), encoding: 'utf8', env: baseEnv(data, extra) })
  return { status: r.status, stdout: r.stdout }
}
const fail = (data, session, fields = {}, extra) =>
  hook(data, { session_id: session, hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: CMD }, error: 'Exit code 1', is_interrupt: false, ...fields }, extra)
const pre = (data, session, fields = {}, extra) => hook(data, { session_id: session, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: CMD }, ...fields }, extra)
const allowed = (r) => assert.deepEqual(r, { status: 0, stdout: '' })
const denied = (r) => {
  assert.equal(r.status, 0)
  assert.notEqual(r.stdout, '', 'expected a deny, got no output')
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny')
}
// n failures, checking the run before each one is allowed.
const failN = (data, session, n, fields, extra) => {
  for (let i = 0; i < n; i++) {
    allowed(pre(data, session, fields, extra))
    allowed(fail(data, session, fields, extra))
  }
}

describe('iteration cap from construct-limits (S3)', () => {
  test('with no declared cap the 4th run after 3 failures is denied, whatever the old option says', () => {
    for (const extra of [{}, { CLAUDE_PLUGIN_OPTION_ITERATION_CAP: '0' }, { CLAUDE_PLUGIN_OPTION_ITERATION_CAP: '10' }]) {
      const data = scratchDir('limits-ic-')
      failN(data, 'sA', 3, {}, extra)
      denied(pre(data, 'sA', {}, extra))
    }
  })

  test('set cap=5 denies after 5 failures in that session; another session keeps 3', () => {
    const data = scratchDir('limits-ic-')
    set(data, 'sA', 'cap=5')
    failN(data, 'sA', 5)
    denied(pre(data, 'sA'))
    failN(data, 'sB', 3)
    denied(pre(data, 'sB'))
  })

  test('the declared cap applies to a subagent of that session too', () => {
    const data = scratchDir('limits-ic-')
    set(data, 'sA', 'cap=5')
    failN(data, 'sA', 5, { agent_id: 'a1' })
    denied(pre(data, 'sA', { agent_id: 'a1' }))
  })

  test('the old option does not override a declared cap', () => {
    const data = scratchDir('limits-ic-')
    set(data, 'sA', 'cap=5')
    const extra = { CLAUDE_PLUGIN_OPTION_ITERATION_CAP: '2' }
    failN(data, 'sA', 5, {}, extra)
    denied(pre(data, 'sA', {}, extra))
  })

  test('set cap=50 is clamped to 10', () => {
    const data = scratchDir('limits-ic-')
    set(data, 'sA', 'cap=50')
    failN(data, 'sA', 10)
    denied(pre(data, 'sA'))
  })

  test('set cap=0 never denies', () => {
    const data = scratchDir('limits-ic-')
    set(data, 'sA', 'cap=0')
    failN(data, 'sA', 12)
    allowed(pre(data, 'sA'))
  })
})
