// S1 of .vault/tasks/limits-hook.md, edges the oracle leaves out: unrelated and unparsable commands produce no output; a set inside `sh -c` is recorded.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { scratchDir } from '../helpers/repo.mjs'

const RECORD = join(new URL('../../plugins/construct/', import.meta.url).pathname, 'hooks/scripts/limits-record.mjs')
const run = (data, command) => {
  const input = { session_id: 'sA', cwd: data, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }
  const r = spawnSync('node', [RECORD], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_DATA: data } })
  return { status: r.status, stdout: r.stdout }
}

test('a command without construct-limits and an unparsable command give no output and write nothing', () => {
  const data = scratchDir('limits-edge-')
  for (const command of ['ls -la', 'echo "unterminated', 'echo construct-limits set inline=1']) {
    assert.deepEqual(run(data, command), { status: 0, stdout: '' })
  }
  assert.equal(existsSync(join(data, 'limits')), false)
})

test('a set whose write fails reports set failed and still prints the active limits', () => {
  const file = join(scratchDir('limits-edge-'), 'not-a-dir')
  writeFileSync(file, 'x')
  const ctx = JSON.parse(run(file, 'construct-limits set inline=300').stdout).hookSpecificOutput.additionalContext
  assert.match(ctx, /set failed, nothing written: /)
  assert.doesNotMatch(ctx, /set recorded/)
  assert.match(ctx, /active limits inline=150 cap=3/)
})

test('a set inside sh -c is recorded', () => {
  const data = scratchDir('limits-edge-')
  assert.match(JSON.parse(run(data, `sh -c 'construct-limits set cap=4'`).stdout).hookSpecificOutput.additionalContext, /cap=4/)
  assert.equal(existsSync(join(data, 'limits', 'sA.json')), true)
})
