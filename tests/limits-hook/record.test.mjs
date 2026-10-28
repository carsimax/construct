// S1 of .vault/tasks/limits-hook.md: a PreToolUse hook on Bash records the main thread's `construct-limits set` in
// dataDir()/limits/<session_id>.json and reports the active limits in its context; `show` reports them from any agent.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { makeRepo, scratchDir } from '../helpers/repo.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const RECORD = join(PLUGIN, 'hooks/scripts/limits-record.mjs')
const GUARD = join(PLUGIN, 'hooks/scripts/surface-guard.mjs')
const CAP = join(PLUGIN, 'hooks/scripts/iteration-cap.mjs')

// Each hook runs with the plugin data dir given and TMPDIR pointing elsewhere; inherited session and option values removed.
const env = (data, tmp) => {
  const out = { ...process.env, CLAUDE_PLUGIN_DATA: data, TMPDIR: tmp }
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_PLUGIN_OPTION_INLINE_EDIT_MAX_LINES', 'CLAUDE_PLUGIN_OPTION_ITERATION_CAP']) delete out[k]
  return out
}
const runHook = (script, { data, tmp }, input) => {
  const r = spawnSync('node', [script], { input: JSON.stringify(input), encoding: 'utf8', env: env(data, tmp) })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

// The record hook for one Bash command; returns its additionalContext after checking the output shape.
function record(ctx, command, { session = 'sA', agent } = {}) {
  const input = { session_id: session, cwd: ctx.cwd, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }
  if (agent) input.agent_id = agent
  const r = runHook(RECORD, ctx, input)
  assert.equal(r.status, 0, `limits-record exited ${r.status}: ${r.stderr}`)
  const lines = r.stdout.split('\n').filter((l) => l.trim() !== '')
  assert.equal(lines.length, 1, `expected one JSON line, got ${JSON.stringify(r.stdout)}`)
  const out = JSON.parse(lines[0]).hookSpecificOutput
  assert.equal(out.hookEventName, 'PreToolUse')
  assert.equal(Object.hasOwn(out, 'permissionDecision'), false, 'limits-record must never decide a permission')
  assert.equal(typeof out.additionalContext, 'string')
  return out.additionalContext
}

const names = (ctx, inline, cap) => assert.match(ctx, new RegExp(`(^|\\W)inline=${inline} cap=${cap}(\\W|$)`))
const limitsFile = (data, session = 'sA') => join(data, 'limits', `${session}.json`)
const saved = (data, session) => JSON.parse(readFileSync(limitsFile(data, session), 'utf8'))

// Every file under dir with its content: the persisted state.
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

const fresh = () => ({ data: scratchDir('limits-hook-data-'), tmp: scratchDir('limits-hook-tmp-'), cwd: scratchDir('limits-hook-cwd-') })

// surface-guard on a main-thread Edit of src/a.js changing n lines.
const repo = makeRepo({ 'src/a.js': 'a\n' })
const lines = (n) => Array.from({ length: n }, (_, i) => `n${i}`).join('\n')
const edit = (ctx, n, session = 'sA') =>
  runHook(GUARD, ctx, { session_id: session, cwd: repo, tool_name: 'Edit', tool_input: { file_path: join(repo, 'src/a.js'), old_string: 'a', new_string: lines(n) } })
const allowed = (r) => assert.deepEqual({ status: r.status, stdout: r.stdout }, { status: 0, stdout: '' })
const denied = (r) => {
  assert.equal(r.status, 0)
  assert.notEqual(r.stdout, '', 'expected a deny, got no output')
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny')
}

// iteration-cap: n failed runs of one command, each run allowed, then the next run must be denied.
const capInput = (session, event) => ({ session_id: session, hook_event_name: event, tool_name: 'Bash', tool_input: { command: 'node --test tests/a.test.mjs' }, error: 'Exit code 1', is_interrupt: false })
const deniesAfter = (ctx, session, n) => {
  for (let i = 0; i < n; i++) {
    allowed(runHook(CAP, ctx, capInput(session, 'PreToolUse')))
    allowed(runHook(CAP, ctx, capInput(session, 'PostToolUseFailure')))
  }
  denied(runHook(CAP, ctx, capInput(session, 'PreToolUse')))
}

describe('limits-record: main-thread set (S1)', () => {
  test('set inline=300 cap=5 is written for the session, named in the context, and applied by both hooks in that session only', () => {
    const ctx = fresh()
    names(record(ctx, 'construct-limits set inline=300 cap=5'), 300, 5)
    const s = saved(ctx.data, 'sA')
    assert.equal(s.inline, 300)
    assert.equal(s.cap, 5)
    allowed(edit(ctx, 300))
    denied(edit(ctx, 301))
    allowed(edit(ctx, 150, 'sB'))
    denied(edit(ctx, 151, 'sB'))
    deniesAfter(ctx, 'sA', 5)
    deniesAfter(ctx, 'sB', 3)
  })

  test('construct-limits at an absolute path matches by basename', () => {
    const ctx = fresh()
    names(record(ctx, '/abs/path/bin/construct-limits set cap=4'), 150, 4)
    assert.equal(saved(ctx.data, 'sA').cap, 4)
    deniesAfter(ctx, 'sA', 4)
  })

  test('a set inside a compound command is recorded', () => {
    const ctx = fresh()
    names(record(ctx, 'cd x && construct-limits set inline=200'), 200, 3)
    assert.equal(saved(ctx.data, 'sA').inline, 200)
    allowed(edit(ctx, 200))
    denied(edit(ctx, 201))
  })

  test('values over the ceilings are clamped: inline 900 to 500, cap 50 to 10', () => {
    const ctx = fresh()
    names(record(ctx, 'construct-limits set inline=900 cap=50'), 500, 10)
    allowed(edit(ctx, 500))
    denied(edit(ctx, 501))
    deniesAfter(ctx, 'sA', 10)
  })

  test('a set of one key keeps the other', () => {
    const ctx = fresh()
    names(record(ctx, 'construct-limits set inline=300'), 300, 3)
    names(record(ctx, 'construct-limits set cap=4'), 300, 4)
    const s = saved(ctx.data, 'sA')
    assert.equal(s.inline, 300)
    assert.equal(s.cap, 4)
    allowed(edit(ctx, 300))
    denied(edit(ctx, 301))
  })
})

describe('limits-record: rejected and ignored sets (S1)', () => {
  for (const args of ['inline=-1', 'inline=abc', 'foo=1', '']) {
    test(`set ${JSON.stringify(args)} writes nothing and the context says it was rejected`, () => {
      const ctx = fresh()
      assert.match(record(ctx, `construct-limits set ${args}`.trim()), /reject/i)
      assert.deepEqual(snapshot(ctx.data), {})
      names(record(ctx, 'construct-limits set inline=20 cap=4'), 20, 4)
      const before = snapshot(ctx.data)
      assert.match(record(ctx, `construct-limits set ${args}`.trim()), /reject/i)
      assert.deepEqual(snapshot(ctx.data), before)
    })
  }

  test('a subagent set records nothing', () => {
    const ctx = fresh()
    record(ctx, 'construct-limits set inline=300 cap=5', { agent: 'a1' })
    assert.equal(existsSync(limitsFile(ctx.data)), false)
    assert.deepEqual(snapshot(ctx.data), {})
    allowed(edit(ctx, 150))
    denied(edit(ctx, 151))
  })
})

describe('limits-record: show (S1)', () => {
  test('show with nothing declared reports the defaults, from the main thread and a subagent', () => {
    const ctx = fresh()
    names(record(ctx, 'construct-limits show'), 150, 3)
    names(record(ctx, 'construct-limits show', { agent: 'a1' }), 150, 3)
  })

  test('show reports the session limits after a main-thread set, from the main thread and a subagent', () => {
    const ctx = fresh()
    record(ctx, 'construct-limits set inline=300 cap=5')
    names(record(ctx, 'construct-limits show'), 300, 5)
    names(record(ctx, 'construct-limits show', { agent: 'a1' }), 300, 5)
    names(record(ctx, 'construct-limits show', { session: 'sB' }), 150, 3)
  })
})

describe('hooks.json (S1)', () => {
  test('limits-record.mjs is registered under PreToolUse with matcher Bash in exec form', () => {
    const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks/hooks.json'), 'utf8')).hooks
    const found = (hooks.PreToolUse ?? [])
      .filter((e) => e.matcher === 'Bash')
      .flatMap((e) => e.hooks)
      .filter((h) => h.command === 'node' && Array.isArray(h.args) && h.args[0] === '${CLAUDE_PLUGIN_ROOT}/hooks/scripts/limits-record.mjs')
    assert.equal(found.length, 1, 'expected one exec-form registration of limits-record.mjs under PreToolUse matcher Bash')
    assert.equal(found[0].type, 'command')
  })
})
