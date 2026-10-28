// S3 of .vault/tasks/config-surface.md and S2 of .vault/tasks/limits-hook.md: the limits leave userConfig; `construct-limits` validates and prints, a hook records.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { scratchDir } from '../helpers/repo.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const CLI = join(PLUGIN, 'bin/construct-limits')

// The CLI run as an executable. It writes no state (S2 of .vault/tasks/limits-hook.md), so it needs no session id or data dir.
function limits(...args) {
  const env = { ...process.env }
  delete env.CLAUDE_CODE_SESSION_ID
  const r = spawnSync(CLI, args, { encoding: 'utf8', env, cwd: scratchDir('limits-cli-') })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error }
}

const ok = (r) => {
  assert.equal(r.error, undefined, `construct-limits did not run: ${r.error?.message}`)
  assert.equal(r.status, 0, r.stderr)
}
const prints = (r, inline, cap) => {
  ok(r)
  if (inline !== undefined) assert.match(r.stdout, new RegExp(`(^|\\W)inline=${inline}(\\W|$)`))
  if (cap !== undefined) assert.match(r.stdout, new RegExp(`(^|\\W)cap=${cap}(\\W|$)`))
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

  test('show says the hook reports the active limits', () => {
    const r = limits('show')
    ok(r)
    assert.match(r.stdout, /hook/i)
  })

  test('--help explains that the hook records the values', () => {
    const r = limits('--help')
    ok(r)
    assert.match(r.stdout, /hook records/i)
  })

  test('set prints the requested values and either key may be set alone', () => {
    prints(limits('set', 'inline=300', 'cap=5'), 300, 5)
    const a = limits('set', 'inline=40')
    prints(a, 40)
    assert.doesNotMatch(a.stdout, /cap=/)
    const b = limits('set', 'cap=7')
    prints(b, undefined, 7)
    assert.doesNotMatch(b.stdout, /inline=/)
  })

  test('set prints the clamped values: inline at most 500, cap at most 10', () => {
    prints(limits('set', 'inline=900', 'cap=50'), 500, 10)
  })

  test('0 is a valid value for both keys', () => {
    prints(limits('set', 'inline=0', 'cap=0'), 0, 0)
  })

  const invalid = [
    ['a non-integer value', ['inline=abc']],
    ['a fractional value', ['cap=2.5']],
    ['an empty value', ['inline=']],
    ['a negative value', ['cap=-1']],
    ['an unknown key', ['lines=20']],
    ['no arguments', []],
    ['one invalid pair beside a valid one', ['inline=200', 'cap=x']],
  ]
  for (const [name, args] of invalid) {
    test(`${name} exits non-zero with a message on stderr`, () => {
      const r = limits('set', ...args)
      assert.equal(r.error, undefined, `construct-limits did not run: ${r.error?.message}`)
      assert.notEqual(r.status, 0)
      assert.notEqual(r.stderr.trim(), '')
    })
  }

  test('an unknown command exits non-zero with a message on stderr', () => {
    const r = limits('bogus')
    assert.notEqual(r.status, 0)
    assert.notEqual(r.stderr.trim(), '')
  })
})
