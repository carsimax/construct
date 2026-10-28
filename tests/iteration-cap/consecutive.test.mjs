// The cap counts consecutive failures: a passing run of the command resets its count (L4 of odd/tasks/iteration-cap.md).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { scratchDir } from '../helpers/repo.mjs'

const HOOK = new URL('../../plugins/construct/hooks/scripts/iteration-cap.mjs', import.meta.url).pathname
const HOOKS_JSON = new URL('../../plugins/construct/hooks/hooks.json', import.meta.url)

function driver() {
  const env = { ...process.env, CLAUDE_PLUGIN_DATA: scratchDir('iteration-cap-consecutive-') }
  delete env.CLAUDE_PLUGIN_OPTION_ITERATION_CAP
  return (event, command = 'npm test') =>
    spawnSync('node', [HOOK], { input: JSON.stringify({ session_id: 's1', hook_event_name: event, tool_name: 'Bash', tool_input: { command }, error: 'Exit code 1', is_interrupt: false }), encoding: 'utf8', env }).stdout
}

test('a passing run resets the count, so only consecutive failures reach the cap', () => {
  const run = driver()
  run('PostToolUseFailure')
  run('PostToolUseFailure')
  run('PostToolUse')
  run('PostToolUseFailure')
  run('PostToolUseFailure')
  assert.equal(run('PreToolUse'), '')
  run('PostToolUseFailure')
  assert.match(run('PreToolUse'), /"deny"/)
})

test('a passing run of another command does not reset this one', () => {
  const run = driver()
  for (let i = 0; i < 3; i++) run('PostToolUseFailure')
  run('PostToolUse', 'npm run lint')
  assert.match(run('PreToolUse'), /"deny"/)
})

test('hooks.json registers the cap in exec form on every event it needs', () => {
  const hooks = JSON.parse(readFileSync(HOOKS_JSON, 'utf8')).hooks
  for (const [event, matcher] of [['PreToolUse', 'Bash'], ['PostToolUse', 'Bash'], ['PostToolUseFailure', undefined], ['SubagentStop', undefined], ['UserPromptSubmit', undefined]]) {
    const entries = (hooks[event] ?? []).filter((e) => e.hooks.some((h) => h.command === 'node' && h.args?.some((a) => a.endsWith('/iteration-cap.mjs'))))
    assert.equal(entries.length, 1, event)
    if (matcher) assert.equal(entries[0].matcher, matcher, event)
  }
})
