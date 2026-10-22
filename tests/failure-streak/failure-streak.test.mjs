// S3: the repeated-failure nudge, driven as a real PostToolUseFailure hook.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const HOOK = join(PLUGIN, 'hooks/scripts/failure-streak.mjs')

const fresh = () => mkdtempSync(join(tmpdir(), 'failure-streak-'))

function fail(data, fields = {}, { now, input } = {}) {
  const result = spawnSync('node', [HOOK], {
    input: input ?? JSON.stringify({ session_id: 's1', hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', error: 'boom', is_interrupt: false, ...fields }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_DATA: data, ...(now === undefined ? {} : { FAILURE_STREAK_NOW: String(now) }) },
  })
  return { status: result.status, stdout: result.stdout }
}

const repeat = (data, n, fields, opts) => Array.from({ length: n }, () => fail(data, fields, opts))

describe('failure streak (S3)', () => {
  test('four failures print nothing, the fifth emits the exact shape', () => {
    const data = fresh()
    for (const r of repeat(data, 4)) assert.deepEqual(r, { status: 0, stdout: '' })
    const r = fail(data)
    assert.equal(r.status, 0)
    const out = JSON.parse(r.stdout)
    assert.deepEqual(Object.keys(out), ['hookSpecificOutput'])
    assert.deepEqual(Object.keys(out.hookSpecificOutput), ['hookEventName', 'additionalContext'])
    assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUseFailure')
    assert.match(out.hookSpecificOutput.additionalContext, /Bash failed 5 times/)
    assert.match(out.hookSpecificOutput.additionalContext, /change strategy or report the blocker/)
    assert.equal(r.stdout.trim().split('\n').length, 1)
  })

  test('the counter resets after nudging', () => {
    const data = fresh()
    assert.notEqual(repeat(data, 5).at(-1).stdout, '')
    for (const r of repeat(data, 4)) assert.equal(r.stdout, '')
    assert.notEqual(fail(data).stdout, '')
  })

  test('failures older than 10 minutes do not count', () => {
    const data = fresh()
    const t0 = 1_000_000_000_000
    repeat(data, 4, {}, { now: t0 })
    assert.equal(fail(data, {}, { now: t0 + 11 * 60_000 }).stdout, '')
    // The old four expired, so four more recent ones are still below five.
    for (const r of repeat(data, 3, {}, { now: t0 + 11 * 60_000 })) assert.equal(r.stdout, '')
    assert.notEqual(fail(data, {}, { now: t0 + 11 * 60_000 }).stdout, '')
  })

  test('failures inside the window still count', () => {
    const data = fresh()
    const t0 = 1_000_000_000_000
    repeat(data, 4, {}, { now: t0 })
    assert.notEqual(fail(data, {}, { now: t0 + 9 * 60_000 }).stdout, '')
  })

  test('interrupts are ignored', () => {
    const data = fresh()
    for (const r of repeat(data, 10, { is_interrupt: true })) assert.equal(r.stdout, '')
    for (const r of repeat(data, 4)) assert.equal(r.stdout, '')
  })

  test('tools, agents, and sessions count separately', () => {
    const data = fresh()
    repeat(data, 4, { tool_name: 'Bash' })
    assert.equal(fail(data, { tool_name: 'Read' }).stdout, '')
    assert.equal(fail(data, { agent_id: 'a1' }).stdout, '')
    assert.equal(fail(data, { session_id: 's2' }).stdout, '')
    assert.notEqual(fail(data, { tool_name: 'Bash' }).stdout, '')
  })

  test('subagent failures count under their agent_id', () => {
    const data = fresh()
    repeat(data, 4, { agent_id: 'a1' })
    assert.notEqual(fail(data, { agent_id: 'a1' }).stdout, '')
  })

  test('bad input prints nothing and exits 0', () => {
    const data = fresh()
    for (const input of ['not json', '{}', '[]', 'null']) assert.deepEqual(fail(data, {}, { input }), { status: 0, stdout: '' })
  })
})

describe('registration (S3)', () => {
  test('hooks.json registers failure-streak on PostToolUseFailure in exec form, failing open', () => {
    const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks/hooks.json'), 'utf8')).hooks
    const entry = hooks.PostToolUseFailure.flatMap((g) => g.hooks).find((h) => h.args?.[0].endsWith('failure-streak.mjs'))
    assert.deepEqual(entry, { type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/failure-streak.mjs'], timeout: 10 })
    assert.equal(entry.onFailure, undefined)
  })
})
