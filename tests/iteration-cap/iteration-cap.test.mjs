// S1-S5: the iteration cap, driven as a real hook on PostToolUseFailure, PreToolUse, UserPromptSubmit, and SubagentStop.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { scratchDir } from '../helpers/repo.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const HOOK = join(PLUGIN, 'hooks/scripts/iteration-cap.mjs')
const CMD = 'node --test tests/a.test.mjs'

const fresh = () => scratchDir('iteration-cap-')

function run(data, payload, { cap, input } = {}) {
  const env = { ...process.env, CLAUDE_PLUGIN_DATA: data }
  delete env.CLAUDE_PLUGIN_OPTION_ITERATION_CAP
  if (cap !== undefined) env.CLAUDE_PLUGIN_OPTION_ITERATION_CAP = cap
  const result = spawnSync('node', [HOOK], { input: input ?? JSON.stringify(payload), encoding: 'utf8', env })
  return { status: result.status, stdout: result.stdout }
}

const fail = (data, fields = {}, opts) =>
  run(data, { session_id: 's1', hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: CMD }, error: 'Exit code 1\nboom', is_interrupt: false, ...fields }, opts)
const pre = (data, fields = {}, opts) =>
  run(data, { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: CMD }, ...fields }, opts)
const prompt = (data, fields = {}) => run(data, { session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: 'go on', ...fields })
const stop = (data, fields = {}) => run(data, { session_id: 's1', hook_event_name: 'SubagentStop', agent_type: 'construct:worker', ...fields })

const failN = (data, n, fields, opts) => {
  for (let i = 0; i < n; i++) assert.deepEqual(fail(data, fields, opts), { status: 0, stdout: '' })
}
const allowed = (r) => assert.deepEqual(r, { status: 0, stdout: '' })
function denied(r) {
  assert.equal(r.status, 0)
  const out = JSON.parse(r.stdout)
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse')
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny')
  const reason = out.hookSpecificOutput.permissionDecisionReason
  assert.equal(typeof reason, 'string')
  assert.match(reason, /stop/i)
  assert.match(reason, /report/i)
  assert.match(reason, /hypothesis/i)
  assert.match(reason, /never edit the test/i)
}

describe('count and cap (S1, S2)', () => {
  test('after 2 failures the 3rd run is allowed; after 3 failures the 4th run is denied', () => {
    const data = fresh()
    failN(data, 2)
    allowed(pre(data))
    failN(data, 1)
    denied(pre(data))
  })

  test('whitespace-normalized variants of a command count together', () => {
    const data = fresh()
    fail(data, { tool_input: { command: 'node  --test tests/a.test.mjs' } })
    fail(data, { tool_input: { command: ' node --test\ttests/a.test.mjs ' } })
    allowed(pre(data))
    fail(data)
    denied(pre(data, { tool_input: { command: 'node --test   tests/a.test.mjs' } }))
  })

  test('different commands count separately', () => {
    const data = fresh()
    failN(data, 3)
    allowed(pre(data, { tool_input: { command: 'node --test tests/b.test.mjs' } }))
    failN(data, 2, { tool_input: { command: 'npm test' } })
    allowed(pre(data, { tool_input: { command: 'npm test' } }))
    denied(pre(data))
  })

  test('a subagent and the main thread count separately', () => {
    const data = fresh()
    failN(data, 3, { agent_id: 'a1' })
    allowed(pre(data))
    allowed(pre(data, { agent_id: 'a2' }))
    denied(pre(data, { agent_id: 'a1' }))
    failN(data, 3)
    denied(pre(data))
    allowed(pre(data, { agent_id: 'a2' }))
  })

  test('sessions count separately', () => {
    const data = fresh()
    failN(data, 3)
    allowed(pre(data, { session_id: 's2' }))
    denied(pre(data))
  })

  test('interrupts are not failures', () => {
    const data = fresh()
    failN(data, 5, { is_interrupt: true })
    allowed(pre(data))
    failN(data, 2)
    allowed(pre(data))
  })

  test('a non-Bash tool is ignored, both failing and running', () => {
    const data = fresh()
    failN(data, 5, { tool_name: 'Read', tool_input: { command: CMD, file_path: '/x' } })
    allowed(pre(data))
    failN(data, 3)
    allowed(pre(data, { tool_name: 'Read', tool_input: { command: CMD, file_path: '/x' } }))
    denied(pre(data))
  })
})

describe('reset (S3)', () => {
  test('SubagentStop ends that agent only', () => {
    const data = fresh()
    failN(data, 3, { agent_id: 'a1' })
    failN(data, 3, { agent_id: 'a2' })
    failN(data, 3)
    allowed(stop(data, { agent_id: 'a1' }))
    allowed(pre(data, { agent_id: 'a1' }))
    denied(pre(data, { agent_id: 'a2' }))
    denied(pre(data))
  })

  test('UserPromptSubmit resets the main thread only', () => {
    const data = fresh()
    failN(data, 3)
    failN(data, 3, { agent_id: 'a1' })
    allowed(prompt(data))
    allowed(pre(data))
    denied(pre(data, { agent_id: 'a1' }))
  })

  test('UserPromptSubmit in another session leaves this session counted', () => {
    const data = fresh()
    failN(data, 3)
    allowed(prompt(data, { session_id: 's2' }))
    denied(pre(data))
  })

  test('after a reset the count starts over', () => {
    const data = fresh()
    failN(data, 3)
    prompt(data)
    failN(data, 2)
    allowed(pre(data))
    failN(data, 1)
    denied(pre(data))
  })
})

describe('configurable cap (S4)', () => {
  test('cap 2 denies the 3rd run', () => {
    const data = fresh()
    failN(data, 1, {}, { cap: '2' })
    allowed(pre(data, {}, { cap: '2' }))
    failN(data, 1, {}, { cap: '2' })
    denied(pre(data, {}, { cap: '2' }))
  })

  for (const cap of ['abc', '-1', '2.5', '', ' ']) {
    test(`invalid cap ${JSON.stringify(cap)} falls back to 3`, () => {
      const data = fresh()
      failN(data, 2, {}, { cap })
      allowed(pre(data, {}, { cap }))
      failN(data, 1, {}, { cap })
      denied(pre(data, {}, { cap }))
    })
  }

  test('cap 0 turns the cap off', () => {
    const data = fresh()
    failN(data, 10, {}, { cap: '0' })
    allowed(pre(data, {}, { cap: '0' }))
  })
})

describe('fails open (S5)', () => {
  test('malformed input prints nothing and exits 0 for every event', () => {
    const data = fresh()
    for (const input of ['not json', '{}', '[]', 'null', '']) allowed(run(data, null, { input }))
    for (const hook_event_name of ['PostToolUseFailure', 'PreToolUse', 'UserPromptSubmit', 'SubagentStop']) {
      allowed(run(data, { hook_event_name }))
      allowed(run(data, { hook_event_name, session_id: 's1', tool_name: 'Bash', tool_input: null }))
      allowed(run(data, { hook_event_name, session_id: 's1', tool_name: 'Bash', tool_input: { command: 42 } }))
    }
  })

  test('failures without a session are not attributed, so they never deny', () => {
    const data = fresh()
    failN(data, 3, { session_id: undefined })
    allowed(pre(data, { session_id: undefined }))
  })

  test('an unwritable data dir prints nothing and exits 0', () => {
    const file = join(fresh(), 'not-a-dir')
    writeFileSync(file, '')
    for (let i = 0; i < 4; i++) allowed(fail(file))
    allowed(pre(file))
    allowed(prompt(file))
    allowed(stop(file, { agent_id: 'a1' }))
  })
})
