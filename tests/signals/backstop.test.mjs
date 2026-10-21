// S7(b): the context backstop notice, once per session, main thread only, from the tail of the transcript.
import assert from 'node:assert/strict'
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { scratchDir } from '../review/helpers.mjs'
import { featureRepo, hook, lines } from './helpers.mjs'

const row = (tokens, model = 'claude-opus-4-7') =>
  `${JSON.stringify({ type: 'assistant', message: { model, role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 10, cache_read_input_tokens: tokens - 20, cache_creation_input_tokens: 5, output_tokens: 5 } } })}\n`

function transcript(...rows) {
  const file = join(scratchDir('odd-sig-tr-'), 't.jsonl')
  writeFileSync(file, rows.join(''))
  return file
}

const post = (transcript_path, extra = {}, env = {}) => hook({ cwd: '/', tool_name: 'Read', tool_input: {}, tool_response: {}, transcript_path, ...extra }, env)

describe('context backstop', () => {
  test('below the 150k cap stays silent, whatever the model id says', () => {
    for (const model of ['claude-opus-5-5', 'claude-opus-4-7[1m]']) {
      const r = post(transcript(row(100_000, model)))
      assert.equal(r.status, 0)
      assert.equal(r.stdout, '')
    }
    assert.equal(post(transcript(row(55_786))).stdout, '')
    assert.equal(post(transcript(row(149_999))).stdout, '')
  })

  test('at the 150k cap it notifies, without guessing a window', () => {
    for (const model of ['claude-opus-5-5', 'claude-opus-4-7[1m]']) {
      const r = post(transcript(row(150_000, model)))
      assert.equal(r.json.hookSpecificOutput.hookEventName, 'PostToolUse')
      assert.match(r.context, /Context backstop: the parent context measures 150,000 tokens, at or past the 150,000-token backstop/)
      assert.doesNotMatch(r.context, /context window|%/)
      assert.match(r.context, /construct:odd-worker/)
    }
  })

  test('the latest usage wins, not the first', () => {
    assert.equal(post(transcript(row(150_000), row(1_000))).stdout, '')
    assert.match(post(transcript(row(1_000), row(150_000))).context, /150,000 tokens/)
  })

  test('once per session; another session still notifies; falling below re-arms', () => {
    const data = { CLAUDE_PLUGIN_DATA: scratchDir('odd-sig-state-') }
    const t = transcript(row(150_000))
    assert.match(post(t, {}, data).context, /Context backstop/)
    assert.equal(post(t, {}, data).stdout, '')
    assert.match(post(t, { session_id: 's2' }, data).context, /Context backstop/)
    appendFileSync(t, row(1_000))
    assert.equal(post(t, {}, data).stdout, '')
    appendFileSync(t, row(150_000))
    assert.match(post(t, {}, data).context, /Context backstop/)
  })

  test('a subagent call is ignored and does not use up the notice', () => {
    const data = { CLAUDE_PLUGIN_DATA: scratchDir('odd-sig-state-') }
    const t = transcript(row(150_000))
    assert.equal(post(t, { agent_id: 'a1', agent_type: 'construct:odd-worker' }, data).stdout, '')
    assert.match(post(t, {}, data).context, /Context backstop/)
  })

  test('a large transcript is read from the tail only', () => {
    const file = join(scratchDir('odd-sig-big-'), 't.jsonl')
    // 60 MB of filler rows with a stale huge usage first, then a small recent one is below; then a big one at the end.
    const filler = `${JSON.stringify({ type: 'user', message: { content: 'y'.repeat(1_000_000) } })}\n`
    writeFileSync(file, row(190_000) + filler.repeat(60) + row(160_000))
    const started = Date.now()
    const r = post(file)
    assert.match(r.context, /160,000 tokens/)
    assert.ok(Date.now() - started < 5_000)
  })

  test('a tail with no usage row, a missing file, or a missing path stays silent', () => {
    const file = join(scratchDir('odd-sig-big-'), 't.jsonl')
    const filler = `${JSON.stringify({ type: 'user', message: { content: 'y'.repeat(1_000_000) } })}\n`
    writeFileSync(file, row(190_000) + filler.repeat(5))
    assert.equal(post(file).stdout, '')
    assert.equal(post('/nonexistent/t.jsonl').stdout, '')
    assert.equal(post(undefined).stdout, '')
  })

  test('garbled rows and a synthetic zero-usage row are skipped', () => {
    const synthetic = `${JSON.stringify({ type: 'assistant', message: { model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 } } })}\n`
    assert.match(post(transcript(row(150_000), 'not json\n', synthetic)).context, /150,000 tokens/)
  })

  test('both signals can share one reply', () => {
    const repo = featureRepo({ 'src/b.js': lines(3) })
    const r = hook({ cwd: repo, tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, tool_response: { stdout: 'ok' }, transcript_path: transcript(row(150_000)) })
    assert.match(r.context, /Commit slice: 3 authored/)
    assert.match(r.context, /Context backstop/)
  })
})
