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
    const explore = line(session, /^2\. Explore/)
    assert.match(explore, /construct-memory search/)
    // The MCP tool comes first and the CLI is the fallback (S1 of odd/tasks/memory-mcp-first.md).
    assert.ok(explore.indexOf('`mem_search`') >= 0 && explore.indexOf('`mem_search`') < explore.indexOf('construct-memory search'), 'mem_search before the CLI')
    assert.match(explore, /tool search/)
    assert.match(explore, /if the tool is missing or fails, `construct-memory search/)
    const close = line(session, /^8\. Close/)
    assert.match(close, /construct-memory save/)
    assert.ok(close.indexOf('`mem_save`') >= 0 && close.indexOf('`mem_save`') < close.indexOf('construct-memory save'), 'mem_save before the CLI')
    assert.match(close, /`mem_session_summary`/)
    assert.match(close, /session summary/)
    assert.ok(close.indexOf('construct-memory save') < close.indexOf('one report'), 'save before the report')
    assert.match(close, /Risk line \(format below\)\.$/)
  })

  // S5 of odd/tasks/memory-mcp-first.md: every skill line that names the CLI names its MCP tool first.
  test('skills name the mem_* tool before the construct-memory command on each line', () => {
    for (const file of ['skills/workflow/SKILL.md', 'skills/workflow/references/persistence.md', 'skills/workflow/references/research.md', 'skills/debugging/SKILL.md', 'skills/delegation/SKILL.md', 'skills/review/SKILL.md', 'skills/constraints/SKILL.md', 'skills/migration/SKILL.md', 'skills/sources/SKILL.md']) {
      for (const l of read(file).split('\n').filter((x) => /construct-memory (search|save|summary)/.test(x))) {
        const tool = l.search(/`mem_(search|save|session_summary|context)`/)
        assert.ok(tool >= 0 && tool < l.search(/construct-memory (search|save|summary)/), `${file}: ${l.slice(0, 80)}`)
      }
    }
    assert.match(read('agents/explorer.md'), /construct-memory search/)
  })

  test('subagent contract ends reports with `## Key Learnings:`', () => {
    assert.match(read('hooks/contract/subagent.md'), /`## Key Learnings:`/)
  })

  const MEMORY = /construct-memory/
  const LEARNINGS = /## Key Learnings:/
  const cases = [
    ['skills/workflow/SKILL.md', MEMORY],
    ['skills/workflow/SKILL.md', /\*\*Close\.\*\* Save[^\n]*construct-memory save[^\n]*then one report[^\n]*and the Risk line \(last\)\./],
    ['skills/workflow/references/persistence.md', /construct-memory search/],
    ['skills/delegation/SKILL.md', MEMORY],
    ['skills/delegation/references/handoffs.md', /## Memory/],
    ['skills/debugging/SKILL.md', /construct-memory search/],
    ['skills/review/SKILL.md', MEMORY],
    ['skills/constraints/SKILL.md', /quality\/<rule>/],
    ['skills/migration/SKILL.md', /migration\/<name>/],
    ['skills/memory/SKILL.md', /Where memory is used/],
    ['agents/explorer.md', /construct-memory search/],
    ['agents/worker.md', LEARNINGS],
    ['agents/general.md', LEARNINGS],
    ['agents/verifier.md', LEARNINGS],
  ]
  for (const [file, re] of cases) test(`${file} names its memory touchpoint`, () => assert.match(read(file), re))

  test('debugging and review save a bugfix; review saves a deferred advisory as a decision', () => {
    assert.match(read('skills/debugging/SKILL.md'), /bugfix/)
    const review = read('skills/review/SKILL.md')
    assert.match(review, /bugfix/)
    assert.match(review, /decision/)
  })

  test('the memory skill map lists every touchpoint', () => {
    const skill = read('skills/memory/SKILL.md')
    for (const name of ['workflow', 'delegation', 'debugging', 'review', 'constraints', 'migration', 'explorer', 'Key Learnings']) {
      assert.ok(skill.includes(name), name)
    }
  })
})
