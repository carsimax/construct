// S2 of .vault/tasks/oracle-limits.md: the `## Envelope` section of an oracle reply, parsed with fixed ceilings and defaults.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { CEILINGS, DEFAULTS, parseEnvelope } from '../../plugins/construct/hooks/scripts/envelope.mjs'

const reply = (body) => `**Status**: done\n\n## Envelope\n${body}\n\n## Key Learnings:\n- x\n`
const FULL = '- Command: node --test tests/a.test.mjs\n- Surfaces:\n  - src/a.js\n  - `src/lib/**`\n- Attempts: 7\n- Minutes: 20\n- Lines: 300'

describe('parseEnvelope', () => {
  test('constants: ceilings 10, 60, 1500 and defaults 5, 30, 400', () => {
    assert.deepEqual(CEILINGS, { attempts: 10, minutes: 60, lines: 1500 })
    assert.deepEqual(DEFAULTS, { attempts: 5, minutes: 30, lines: 400 })
  })
  test('reads command, surfaces, and the three budgets', () => {
    assert.deepEqual(parseEnvelope(reply(FULL)), { command: 'node --test tests/a.test.mjs', surfaces: ['src/a.js', 'src/lib/**'], attempts: 7, minutes: 20, lines: 300 })
  })
  test('a missing, invalid, zero, or negative number takes the default', () => {
    for (const bad of ['', '- Attempts: many', '- Attempts: 0', '- Attempts: -3', '- Attempts: 2.5']) {
      const e = parseEnvelope(reply(`- Command: t\n- Surfaces:\n- a.js\n${bad}`))
      assert.equal(e.attempts, 5, bad)
      assert.equal(e.minutes, 30)
      assert.equal(e.lines, 400)
    }
  })
  test('a value above its ceiling clamps to it', () => {
    const e = parseEnvelope(reply('- Command: t\n- Surfaces:\n- a.js\n- Attempts: 99\n- Minutes: 61\n- Lines: 100000'))
    assert.deepEqual([e.attempts, e.minutes, e.lines], [10, 60, 1500])
  })
  test('a missing Command or Surfaces, or no section, is no envelope', () => {
    assert.equal(parseEnvelope(reply('- Surfaces:\n- a.js')), null)
    assert.equal(parseEnvelope(reply('- Command: t')), null)
    assert.equal(parseEnvelope(reply('- Command: t\n- Surfaces:\n- Attempts: 3')), null)
    assert.equal(parseEnvelope('**Status**: done\n'), null)
    assert.equal(parseEnvelope(undefined), null)
  })
  test('the section ends at the next heading', () => {
    const e = parseEnvelope(reply('- Command: t\n- Surfaces:\n- a.js\n\n## Other\n- Attempts: 9'))
    assert.equal(e.attempts, 5)
  })
})
