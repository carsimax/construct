// S19: pins every place the harness reads or writes memory, so a later edit cannot drop one silently.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const read = (path) => readFileSync(join(PLUGIN, path), 'utf8')
const line = (text, re) => text.split('\n').find((l) => re.test(l)) ?? ''

describe('memory touchpoints (S19)', () => {
  test('session contract: Explore searches memory, Close saves what was learned', () => {
    const session = read('hooks/contract/session.md')
    assert.match(line(session, /^2\. Explore/), /construct-memory search/)
    const close = line(session, /^8\. Close/)
    assert.match(close, /construct-memory save/)
    assert.match(close, /session summary/)
    assert.ok(close.indexOf('construct-memory save') < close.indexOf('one report'), 'save before the report')
    assert.match(close, /Risk line \(format below\)\.$/)
  })

  test('subagent contract ends reports with `## Key Learnings:`', () => {
    assert.match(read('hooks/contract/subagent.md'), /`## Key Learnings:`/)
  })

  const MEMORY = /construct-memory/
  const LEARNINGS = /## Key Learnings:/
  const cases = [
    ['skills/odd-workflow/SKILL.md', MEMORY],
    ['skills/odd-workflow/SKILL.md', /\*\*Close\.\*\* Save[^\n]*construct-memory save[^\n]*then one report[^\n]*and the Risk line \(last\)\./],
    ['skills/odd-workflow/references/persistence.md', /construct-memory search/],
    ['skills/odd-delegation/SKILL.md', MEMORY],
    ['skills/odd-delegation/references/handoffs.md', /## Memory/],
    ['skills/debugging/SKILL.md', /construct-memory search/],
    ['skills/rdd-review/SKILL.md', MEMORY],
    ['skills/constraint-driven/SKILL.md', /quality\/<rule>/],
    ['skills/migration/SKILL.md', /migration\/<name>/],
    ['skills/memory/SKILL.md', /Where memory is used/],
    ['agents/odd-explorer.md', /construct-memory search/],
    ['agents/odd-worker.md', LEARNINGS],
    ['agents/odd-general.md', LEARNINGS],
    ['agents/odd-verify.md', LEARNINGS],
  ]
  for (const [file, re] of cases) test(`${file} names its memory touchpoint`, () => assert.match(read(file), re))

  test('debugging and rdd-review save a bugfix; rdd-review saves a deferred advisory as a decision', () => {
    assert.match(read('skills/debugging/SKILL.md'), /bugfix/)
    const review = read('skills/rdd-review/SKILL.md')
    assert.match(review, /bugfix/)
    assert.match(review, /decision/)
  })

  test('the memory skill map lists every touchpoint', () => {
    const skill = read('skills/memory/SKILL.md')
    for (const name of ['odd-workflow', 'odd-delegation', 'debugging', 'rdd-review', 'constraint-driven', 'migration', 'odd-explorer', 'Key Learnings']) {
      assert.ok(skill.includes(name), name)
    }
  })
})
