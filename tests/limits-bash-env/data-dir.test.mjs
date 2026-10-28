// S3 of .vault/tasks/config-surface.md: the Bash tool has no CLAUDE_PLUGIN_DATA, so `construct-limits set` writes to the
// fallback directory; hooks (which have it) must still see the declared limits.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { makeRepo, scratchDir } from '../helpers/repo.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const run = (cmd, args, env, input) => spawnSync(cmd, args, { input, encoding: 'utf8', env })

test('limits set without CLAUDE_PLUGIN_DATA apply to hooks that have it', () => {
  const tmp = scratchDir('limits-tmp-')
  const data = scratchDir('limits-data-')
  const base = { ...process.env, TMPDIR: tmp }
  delete base.CLAUDE_CODE_SESSION_ID
  delete base.CLAUDE_PLUGIN_OPTION_INLINE_EDIT_MAX_LINES
  delete base.CLAUDE_PLUGIN_OPTION_ITERATION_CAP
  const cliEnv = { ...base, CLAUDE_CODE_SESSION_ID: 'sA' }
  delete cliEnv.CLAUDE_PLUGIN_DATA
  const r = run(join(PLUGIN, 'bin/construct-limits'), ['set', 'inline=300', 'cap=5'], cliEnv)
  assert.equal(r.status, 0, r.stderr)

  const hookEnv = { ...base, CLAUDE_PLUGIN_DATA: data }
  const repo = makeRepo({ 'src/a.js': 'a\n' })
  const lines = (n) => Array.from({ length: n }, (_, i) => `n${i}`).join('\n')
  const edit = (n) =>
    run('node', [join(PLUGIN, 'hooks/scripts/surface-guard.mjs')], hookEnv,
      JSON.stringify({ session_id: 'sA', cwd: repo, tool_name: 'Edit', tool_input: { file_path: join(repo, 'src/a.js'), old_string: 'a', new_string: lines(n) } })).stdout
  assert.equal(edit(300), '')
  const denied = JSON.parse(edit(301))
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /limit of 300\b/)

  const cap = join(PLUGIN, 'hooks/scripts/iteration-cap.mjs')
  const hook = (event) =>
    run('node', [cap], hookEnv, JSON.stringify({ session_id: 'sA', hook_event_name: event, tool_name: 'Bash', tool_input: { command: 'node --test x' }, error: 'Exit code 1', is_interrupt: false })).stdout
  for (let i = 0; i < 5; i++) {
    assert.equal(hook('PreToolUse'), '', `run ${i + 1} allowed`)
    hook('PostToolUseFailure')
  }
  assert.match(hook('PreToolUse'), /deny/)
})

test('readLimits uses the newer of the plugin data dir and fallback dir files', () => {
  const tmp = scratchDir('limits-tmp-')
  const data = scratchDir('limits-data-')
  for (const [dir, inline, time] of [[data, 200, 1000], [join(tmp, `construct-${process.getuid()}`), 400, 2000]]) {
    mkdirSync(join(dir, 'limits'), { recursive: true, mode: 0o700 })
    const f = join(dir, 'limits', 'sB.json')
    writeFileSync(f, JSON.stringify({ inline }))
    utimesSync(f, time, time)
  }
  const script = `import { readLimits } from ${JSON.stringify(join(PLUGIN, 'hooks/scripts/limits.mjs'))}; console.log(JSON.stringify(readLimits('sB')))`
  const r = run('node', ['--input-type=module', '-e', script], { ...process.env, TMPDIR: tmp, CLAUDE_PLUGIN_DATA: data })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(JSON.parse(r.stdout).inline, 400)
})
