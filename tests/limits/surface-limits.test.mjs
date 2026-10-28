// S3 of .vault/tasks/config-surface.md: surface-guard reads the main thread's inline limit from `construct-limits`, per session, clamped to 500.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { makeRepo, scratchDir } from '../helpers/repo.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const RECORD = join(PLUGIN, 'hooks/scripts/limits-record.mjs')
const GUARD = join(PLUGIN, 'hooks/scripts/surface-guard.mjs')

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
const lines = (n, tag = 'n') => Array.from({ length: n }, (_, i) => `${tag}${i}`).join('\n')
function guard(data, input, extra) {
  const r = spawnSync('node', [GUARD], { input: JSON.stringify(input), encoding: 'utf8', env: baseEnv(data, extra) })
  return { status: r.status, stdout: r.stdout }
}
// A main-thread (no agent_id) Edit of src/a.js that changes n lines.
const edit = (data, repo, session, n, extra) =>
  guard(data, { session_id: session, cwd: repo, tool_name: 'Edit', tool_input: { file_path: join(repo, 'src/a.js'), old_string: 'a', new_string: lines(n) } }, extra)
const allowed = (r) => assert.deepEqual(r, { status: 0, stdout: '' })
const denied = (r) => {
  assert.equal(r.status, 0)
  assert.notEqual(r.stdout, '', 'expected a deny, got no output')
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny')
}

describe('surface-guard inline limit from construct-limits (S3)', () => {
  const repo = makeRepo({ 'src/a.js': 'a\n' })

  test('with no declared limit 150 lines pass and 151 are denied, whatever the old option says', () => {
    const data = scratchDir('limits-sg-')
    for (const extra of [{}, { CLAUDE_PLUGIN_OPTION_INLINE_EDIT_MAX_LINES: '50' }, { CLAUDE_PLUGIN_OPTION_INLINE_EDIT_MAX_LINES: '1000' }, { CLAUDE_PLUGIN_OPTION_INLINE_EDIT_MAX_LINES: '0' }]) {
      allowed(edit(data, repo, 'sA', 150, extra))
      denied(edit(data, repo, 'sA', 151, extra))
    }
  })

  test('set inline=300 lets a 300-line edit pass in that session and not in another', () => {
    const data = scratchDir('limits-sg-')
    set(data, 'sA', 'inline=300')
    allowed(edit(data, repo, 'sA', 300))
    denied(edit(data, repo, 'sA', 301))
    denied(edit(data, repo, 'sB', 300))
    allowed(edit(data, repo, 'sB', 150))
  })

  test('the old option does not override a declared limit', () => {
    const data = scratchDir('limits-sg-')
    set(data, 'sA', 'inline=300')
    allowed(edit(data, repo, 'sA', 300, { CLAUDE_PLUGIN_OPTION_INLINE_EDIT_MAX_LINES: '10' }))
    denied(edit(data, repo, 'sA', 301, { CLAUDE_PLUGIN_OPTION_INLINE_EDIT_MAX_LINES: '1000' }))
  })

  test('set inline=900 is clamped to 500', () => {
    const data = scratchDir('limits-sg-')
    set(data, 'sA', 'inline=900')
    allowed(edit(data, repo, 'sA', 500))
    denied(edit(data, repo, 'sA', 501))
  })

  test('set inline=0 allows only .vault/tasks/', () => {
    const data = scratchDir('limits-sg-')
    set(data, 'sA', 'inline=0')
    denied(edit(data, repo, 'sA', 1))
    allowed(guard(data, { session_id: 'sA', cwd: repo, tool_name: 'Write', tool_input: { file_path: join(repo, '.vault/tasks/f.md'), content: lines(600) } }))
    allowed(edit(data, repo, 'sB', 1))
  })
})
