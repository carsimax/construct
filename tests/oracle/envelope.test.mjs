// S2 of .vault/tasks/oracle-limits.md: oracle-record stores the envelope of the oracle's reply in the review store.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { makeRepo, scratchDir, write } from '../helpers/repo.mjs'
import { readEnvelope, readTaskState, writeTaskState, readOracles } from '../../plugins/construct/hooks/scripts/review-store.mjs'

const HOOK = new URL('../../plugins/construct/hooks/scripts/oracle-record.mjs', import.meta.url).pathname
const FEATURE = '.vault/tasks/feat.md'
const prompt = (...paths) => `Write the tests.\n\nSpec: ${FEATURE}, T1 (covers S2)\n\n## Allowed edit surfaces\n${paths.join('\n')}\n`
const envelope = (attempts) => `Done.\n\n## Envelope\n- Command: node --test tests/a.test.mjs\n- Surfaces:\n  - src/a.js\n- Attempts: ${attempts}\n- Minutes: 20\n- Lines: 300\n`

function stop(repo, reply, { type = 'construct:oracle', asTranscript = false } = {}) {
  const file = join(scratchDir('odd-env-'), 't.jsonl')
  const rows = [{ type: 'user', message: { role: 'user', content: prompt('tests/a.test.mjs') } }]
  if (asTranscript) rows.push({ type: 'assistant', message: { content: [{ type: 'text', text: reply }] } })
  writeFileSync(file, rows.map((r) => `${JSON.stringify(r)}\n`).join(''))
  const input = { session_id: 's1', agent_id: 'a1', agent_type: type, cwd: repo, hook_event_name: 'SubagentStop', agent_transcript_path: file, ...(asTranscript ? {} : { last_assistant_message: reply }) }
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_DATA: scratchDir('odd-env-data-') } })
  return { status: r.status, stdout: r.stdout }
}

describe('oracle-record envelope', () => {
  test('stores the parsed envelope keyed by feature and task', () => {
    const repo = makeRepo({})
    write(repo, 'tests/a.test.mjs', 'a\n')
    assert.deepEqual(stop(repo, envelope(7)), { status: 0, stdout: '' })
    const e = readEnvelope(repo, FEATURE, 'T1')
    assert.deepEqual({ ...e, at: typeof e.at }, { feature: FEATURE, task: 'T1', command: 'node --test tests/a.test.mjs', surfaces: ['src/a.js'], attempts: 7, minutes: 20, lines: 300, at: 'number' })
    assert.equal(readEnvelope(repo, FEATURE, 'T2'), null)
  })
  test('reads the reply from the transcript when last_assistant_message is absent', () => {
    const repo = makeRepo({})
    write(repo, 'tests/a.test.mjs', 'a\n')
    stop(repo, envelope(3), { asTranscript: true })
    assert.equal(readEnvelope(repo, FEATURE, 'T1').attempts, 3)
  })
  test('an active lock of the task keeps the existing envelope', () => {
    const repo = makeRepo({})
    write(repo, 'tests/a.test.mjs', 'a\n')
    stop(repo, envelope(7))
    stop(repo, envelope(9))
    assert.equal(readOracles(repo).length, 1)
    assert.equal(readEnvelope(repo, FEATURE, 'T1').attempts, 7)
  })
  test('with no active lock of the task the envelope is replaced', () => {
    const repo = makeRepo({})
    stop(repo, envelope(7)) // the oracle wrote no test file: no lock
    stop(repo, envelope(9))
    assert.equal(readEnvelope(repo, FEATURE, 'T1').attempts, 9)
  })
  test('a replaced envelope starts the task with no spent budget', () => {
    const repo = makeRepo({})
    stop(repo, envelope(7))
    writeTaskState(repo, FEATURE, 'T1', { attempts: 7, bestPass: 0, startedAt: Date.now(), baseTree: null, budget: { attempts: 7, minutes: 20 } })
    stop(repo, envelope(9))
    assert.equal(readTaskState(repo, FEATURE, 'T1'), null)
  })
  test('a reply without an envelope, or another agent type, stores nothing', () => {
    const repo = makeRepo({})
    write(repo, 'tests/a.test.mjs', 'a\n')
    stop(repo, 'Done, no envelope.')
    stop(repo, envelope(7), { type: 'construct:worker' })
    assert.equal(readEnvelope(repo, FEATURE, 'T1'), null)
  })
})
