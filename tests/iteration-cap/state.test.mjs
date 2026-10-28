// The iteration-cap state never keeps a command's text: a failing command can carry a secret inline.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { scratchDir } from '../helpers/repo.mjs'

const HOOK = new URL('../../plugins/construct/hooks/scripts/iteration-cap.mjs', import.meta.url).pathname

test('state files hold no command text and are private to the user', () => {
  const data = scratchDir('iteration-cap-state-')
  const command = "curl -H 'Authorization: Bearer s3cr3t-token' https://example.invalid"
  const env = { ...process.env, CLAUDE_PLUGIN_DATA: data }
  delete env.CLAUDE_PLUGIN_OPTION_ITERATION_CAP
  const run = (event) => spawnSync('node', [HOOK], { input: JSON.stringify({ session_id: 's1', hook_event_name: event, tool_name: 'Bash', tool_input: { command }, error: 'Exit code 1', is_interrupt: false }), encoding: 'utf8', env })
  for (let i = 0; i < 3; i++) run('PostToolUseFailure')
  assert.match(run('PreToolUse').stdout, /"deny"/)
  const dir = join(data, 'iteration-cap', 's1')
  const files = readdirSync(dir)
  assert.equal(files.length, 1)
  assert.doesNotMatch(readFileSync(join(dir, files[0]), 'utf8'), /s3cr3t|Authorization|curl/)
  assert.equal(statSync(join(dir, files[0])).mode & 0o077, 0)
})
