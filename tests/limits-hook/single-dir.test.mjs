// S2 of .vault/tasks/limits-hook.md: the limits live in dataDir() only. No hook reads or creates the temp fallback
// directory for limits, and the CLI no longer writes state.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { makeRepo, scratchDir } from '../helpers/repo.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const RECORD = join(PLUGIN, 'hooks/scripts/limits-record.mjs')
const GUARD = join(PLUGIN, 'hooks/scripts/surface-guard.mjs')
const CAP = join(PLUGIN, 'hooks/scripts/iteration-cap.mjs')
const CLI = join(PLUGIN, 'bin/construct-limits')
const FALLBACK = (tmp) => join(tmp, `construct-${process.getuid()}`)

const clean = (extra) => {
  const out = { ...process.env }
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_PLUGIN_OPTION_INLINE_EDIT_MAX_LINES', 'CLAUDE_PLUGIN_OPTION_ITERATION_CAP']) delete out[k]
  return { ...out, ...extra }
}
const runHook = (script, data, tmp, input) => {
  const r = spawnSync('node', [script], { input: JSON.stringify(input), encoding: 'utf8', env: clean({ CLAUDE_PLUGIN_DATA: data, TMPDIR: tmp }) })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

// Every file under dir with its content.
function snapshot(dir) {
  const out = {}
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else out[p] = readFileSync(p, 'utf8')
    }
  }
  walk(dir)
  return out
}

const repo = makeRepo({ 'src/a.js': 'a\n' })
const lines = (n) => Array.from({ length: n }, (_, i) => `n${i}`).join('\n')
const edit = (data, tmp, n) =>
  runHook(GUARD, data, tmp, { session_id: 'sA', cwd: repo, tool_name: 'Edit', tool_input: { file_path: join(repo, 'src/a.js'), old_string: 'a', new_string: lines(n) } })
const allowed = (r) => assert.deepEqual({ status: r.status, stdout: r.stdout }, { status: 0, stdout: '' })
const denied = (r) => {
  assert.equal(r.status, 0)
  assert.notEqual(r.stdout, '', 'expected a deny, got no output')
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny')
}

describe('one directory for the limits (S2)', () => {
  test('a main-thread set through the hook leaves nothing under the temp fallback directory', () => {
    const data = scratchDir('limits-1d-data-')
    const tmp = scratchDir('limits-1d-tmp-')
    const r = runHook(RECORD, data, tmp, { session_id: 'sA', cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'construct-limits set inline=300 cap=5' } })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(existsSync(join(data, 'limits', 'sA.json')), true, 'the hook must write dataDir()/limits/sA.json')
    assert.equal(existsSync(FALLBACK(tmp)), false)
  })

  test('a limits file only in the temp fallback directory has no effect on surface-guard', () => {
    const data = scratchDir('limits-1d-data-')
    const tmp = scratchDir('limits-1d-tmp-')
    mkdirSync(join(FALLBACK(tmp), 'limits'), { recursive: true, mode: 0o700 })
    writeFileSync(join(FALLBACK(tmp), 'limits', 'sA.json'), JSON.stringify({ inline: 400 }), { mode: 0o600 })
    allowed(edit(data, tmp, 150))
    denied(edit(data, tmp, 151))
  })

  test('surface-guard and iteration-cap do not create the temp fallback directory', () => {
    const data = scratchDir('limits-1d-data-')
    const tmp = scratchDir('limits-1d-tmp-')
    allowed(edit(data, tmp, 10))
    const cap = runHook(CAP, data, tmp, { session_id: 'sA', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'node --test x' } })
    assert.equal(cap.status, 0, cap.stderr)
    assert.equal(existsSync(FALLBACK(tmp)), false)
  })
})

describe('construct-limits CLI writes no state (S2)', () => {
  // The CLI as the Bash tool runs it: no CLAUDE_PLUGIN_DATA, with scratch TMPDIR, HOME and working directory.
  const cli = (...args) => {
    const tmp = scratchDir('limits-1d-tmp-')
    const home = scratchDir('limits-1d-home-')
    const cwd = scratchDir('limits-1d-cwd-')
    const env = clean({ TMPDIR: tmp, HOME: home, CLAUDE_CODE_SESSION_ID: 'sA' })
    delete env.CLAUDE_PLUGIN_DATA
    const r = spawnSync(CLI, args, { cwd, encoding: 'utf8', env })
    assert.equal(r.error, undefined, `construct-limits did not run: ${r.error?.message}`)
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', written: { ...snapshot(tmp), ...snapshot(home), ...snapshot(cwd) }, tmp }
  }

  test('set validates only: inline=300 exits 0 printing the value, inline=abc exits non-zero with stderr; neither writes anything', () => {
    const r = cli('set', 'inline=300')
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /(^|\W)inline=300(\W|$)/)
    assert.deepEqual(r.written, {})
    assert.equal(existsSync(FALLBACK(r.tmp)), false)
    const bad = cli('set', 'inline=abc')
    assert.notEqual(bad.status, 0)
    assert.notEqual(bad.stderr.trim(), '')
    assert.deepEqual(bad.written, {})
  })

  test('show exits 0, says the hook reports the active limits, and writes nothing', () => {
    const r = cli('show')
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /hook/i)
    assert.deepEqual(r.written, {})
  })
})
