// S2: the oracle-record SubagentStop hook locks the blob id of every exact path in an oracle's surfaces.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { git, makeRepo, scratchDir, write } from '../helpers/repo.mjs'
import { readOracles } from '../../plugins/construct/hooks/scripts/review-store.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const HOOK = join(PLUGIN, 'hooks/scripts/oracle-record.mjs')
const ORACLE = 'construct:oracle'

const prompt = (...paths) => `Write the acceptance tests.\n\nSpec: .vault/tasks/feat.md, T1 (covers S1)\n\n## Allowed edit surfaces\n${paths.join('\n')}\n\n## Verification\n- node --test\n`

function stop(repo, { type = ORACLE, text, transcript = true, raw } = {}) {
  const file = join(scratchDir('odd-oracle-'), 't.jsonl')
  writeFileSync(file, `${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`)
  const input = { session_id: 's1', agent_id: 'a1', agent_type: type, cwd: repo, hook_event_name: 'SubagentStop', ...(transcript ? { agent_transcript_path: file } : {}) }
  const r = spawnSync('node', [HOOK], { input: raw ?? JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_DATA: scratchDir('odd-oracle-data-') } })
  return { status: r.status, stdout: r.stdout }
}

describe('oracle-record', () => {
  test('writes one record per existing surface path with the git blob id', () => {
    const repo = makeRepo({})
    write(repo, 'tests/a.test.mjs', 'a\n')
    write(repo, 'tests/b.test.mjs', 'b\n')
    const r = stop(repo, { text: prompt('tests/a.test.mjs', 'tests/b.test.mjs', 'tests/missing.test.mjs') })
    assert.deepEqual(r, { status: 0, stdout: '' })
    const records = readOracles(repo).sort((x, y) => x.path.localeCompare(y.path))
    assert.deepEqual(records.map((x) => x.path), ['tests/a.test.mjs', 'tests/b.test.mjs'])
    for (const rec of records) {
      assert.equal(rec.blob, git(repo, 'hash-object', rec.path).trim())
      assert.equal(rec.feature, '.vault/tasks/feat.md')
      assert.equal(rec.task, 'T1')
      assert.equal(typeof rec.at, 'number')
    }
  })

  test('a later record for the same path leaves the existing lock untouched', () => {
    const repo = makeRepo({})
    write(repo, 'tests/a.test.mjs', 'one\n')
    stop(repo, { text: prompt('tests/a.test.mjs') })
    const first = readOracles(repo)[0]
    write(repo, 'tests/a.test.mjs', 'two\n')
    stop(repo, { text: prompt('tests/a.test.mjs').replace('feat.md, T1', 'other.md, T2') })
    assert.deepEqual(readOracles(repo), [first])
    assert.equal(first.feature, '.vault/tasks/feat.md')
    assert.equal(first.task, 'T1')
  })

  test('another agent type records nothing', () => {
    const repo = makeRepo({})
    write(repo, 'tests/a.test.mjs', 'a\n')
    assert.deepEqual(stop(repo, { type: 'construct:worker', text: prompt('tests/a.test.mjs') }), { status: 0, stdout: '' })
    assert.deepEqual(readOracles(repo), [])
  })

  test('malformed input, a missing transcript, or a prompt without a Spec line exits 0 silently and records nothing', () => {
    const repo = makeRepo({})
    write(repo, 'tests/a.test.mjs', 'a\n')
    for (const r of [
      stop(repo, { raw: 'not json' }),
      stop(repo, { raw: '' }),
      stop(repo, { text: prompt('tests/a.test.mjs'), transcript: false }),
      stop(repo, { text: '## Allowed edit surfaces\ntests/a.test.mjs\n' }),
      stop(repo, { text: 'Spec: .vault/tasks/feat.md, T1\n\nno surfaces' }),
    ]) assert.deepEqual(r, { status: 0, stdout: '' })
    assert.deepEqual(readOracles(repo), [])
  })

  test('hooks.json registers it on SubagentStop in exec form', () => {
    const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks/hooks.json'), 'utf8')).hooks
    const entry = hooks.SubagentStop.find((e) => e.hooks.some((h) => h.args?.[0]?.endsWith('oracle-record.mjs')))
    assert.deepEqual(entry.hooks[0], { type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/oracle-record.mjs'], timeout: 10 })
  })
})
