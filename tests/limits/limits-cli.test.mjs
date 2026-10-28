// S3 of .vault/tasks/config-surface.md: the limits leave userConfig and `construct-limits` sets and shows them per session.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { scratchDir } from '../helpers/repo.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const CLI = join(PLUGIN, 'bin/construct-limits')

// The CLI run as an executable, with the session id and data dir given (inherited ones removed).
function limits(data, session, ...args) {
  const env = { ...process.env, CLAUDE_PLUGIN_DATA: data }
  delete env.CLAUDE_CODE_SESSION_ID
  delete env.CLAUDE_PLUGIN_OPTION_INLINE_EDIT_MAX_LINES
  delete env.CLAUDE_PLUGIN_OPTION_ITERATION_CAP
  if (session !== undefined) env.CLAUDE_CODE_SESSION_ID = session
  const r = spawnSync(CLI, args, { encoding: 'utf8', env })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error }
}

const ok = (r) => {
  assert.equal(r.error, undefined, `construct-limits did not run: ${r.error?.message}`)
  assert.equal(r.status, 0, r.stderr)
}
const shows = (data, session, inline, cap) => {
  const r = limits(data, session, 'show')
  ok(r)
  assert.match(r.stdout, new RegExp(`(^|\\W)inline=${inline}(\\W|$)`))
  assert.match(r.stdout, new RegExp(`(^|\\W)cap=${cap}(\\W|$)`))
}

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

describe('userConfig (S3)', () => {
  test('plugin.json userConfig has no inline_edit_max_lines and no iteration_cap', () => {
    const config = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin/plugin.json'), 'utf8')).userConfig ?? {}
    assert.equal(Object.hasOwn(config, 'inline_edit_max_lines'), false)
    assert.equal(Object.hasOwn(config, 'iteration_cap'), false)
  })
})

describe('construct-limits (S3)', () => {
  test('bin/construct-limits is executable', () => {
    assert.ok(statSync(CLI).mode & 0o111)
  })

  test('show with nothing declared prints the defaults inline=150 and cap=3', () => {
    shows(scratchDir('limits-cli-'), 'sA', 150, 3)
  })

  test('set inline and cap together is shown in that session and not in another', () => {
    const data = scratchDir('limits-cli-')
    ok(limits(data, 'sA', 'set', 'inline=300', 'cap=5'))
    shows(data, 'sA', 300, 5)
    shows(data, 'sB', 150, 3)
  })

  test('either key may be set alone; the other keeps its default', () => {
    const a = scratchDir('limits-cli-')
    ok(limits(a, 'sA', 'set', 'inline=40'))
    shows(a, 'sA', 40, 3)
    const b = scratchDir('limits-cli-')
    ok(limits(b, 'sA', 'set', 'cap=7'))
    shows(b, 'sA', 150, 7)
  })

  test('show prints the clamped values: inline at most 500, cap at most 10', () => {
    const data = scratchDir('limits-cli-')
    ok(limits(data, 'sA', 'set', 'inline=900', 'cap=50'))
    shows(data, 'sA', 500, 10)
  })

  test('0 is a valid value for both keys', () => {
    const data = scratchDir('limits-cli-')
    ok(limits(data, 'sA', 'set', 'inline=0', 'cap=0'))
    shows(data, 'sA', 0, 0)
  })

  const invalid = [
    ['a non-integer value', ['inline=abc']],
    ['a fractional value', ['cap=2.5']],
    ['an empty value', ['inline=']],
    ['a negative value', ['cap=-1']],
    ['an unknown key', ['lines=20']],
    ['one invalid pair beside a valid one', ['inline=200', 'cap=x']],
  ]
  for (const [name, args] of invalid) {
    test(`${name} exits non-zero with a message on stderr and changes nothing`, () => {
      const data = scratchDir('limits-cli-')
      ok(limits(data, 'sA', 'set', 'inline=20', 'cap=4'))
      const before = snapshot(data)
      const r = limits(data, 'sA', 'set', ...args)
      assert.equal(r.error, undefined, `construct-limits did not run: ${r.error?.message}`)
      assert.notEqual(r.status, 0)
      assert.notEqual(r.stderr.trim(), '')
      assert.deepEqual(snapshot(data), before)
      shows(data, 'sA', 20, 4)
    })
  }

  test('a missing session id exits non-zero with a message on stderr and changes nothing', () => {
    const data = scratchDir('limits-cli-')
    const before = snapshot(data)
    for (const session of [undefined, '']) {
      const r = limits(data, session, 'set', 'inline=300')
      assert.equal(r.error, undefined, `construct-limits did not run: ${r.error?.message}`)
      assert.notEqual(r.status, 0)
      assert.notEqual(r.stderr.trim(), '')
    }
    assert.deepEqual(snapshot(data), before)
  })
})
