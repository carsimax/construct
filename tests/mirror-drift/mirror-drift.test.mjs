// Mirror drift gate (S8a): node mirror-drift.mjs on Stop blocks once per turn when an
// odd/tasks/<f>.md changed during the turn (risk-line's `mark` record) and the transcript since the
// last real user prompt holds no engram mem_save with topic_key odd/<f>/tasks.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyFiles, makeRepo, scratchDir } from '../helpers/repo.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const MIRROR = join(PLUGIN, 'hooks/scripts/mirror-drift.mjs')
const RISK = join(PLUGIN, 'hooks/scripts/risk-line.mjs')

const run = (script, args, input, e) => {
  const result = spawnSync('node', [script, ...args], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ...e } })
  let json = null
  try {
    json = JSON.parse(result.stdout)
  } catch {
    // No output.
  }
  return { status: result.status, stdout: result.stdout, json }
}

const user = (text, uuid = 'u1') => ({ type: 'user', uuid, message: { role: 'user', content: text } })
const toolResult = { type: 'user', uuid: 'r1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }
const save = (topic, name = 'mcp__engram__mem_save') => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name, input: { title: 'x', content: 'y', topic_key: topic } }] },
})

function turn({ docs = { 'odd/tasks/feat.md': '# feat\nchanged\n' }, rows = [], subagent = false, active = false, cwd } = {}) {
  const repo = makeRepo({ 'src/a.js': 'export const a = 1\n', 'odd/tasks/feat.md': '# feat\n', 'odd/tasks/other.md': '# other\n' })
  const e = { CLAUDE_PLUGIN_DATA: scratchDir('odd-mirror-data-') }
  const input = { session_id: 's1', cwd: cwd ?? repo, stop_hook_active: false }
  run(RISK, ['mark'], input, e)
  applyFiles(repo, docs)
  const transcript = join(scratchDir('odd-mirror-tr-'), 't.jsonl')
  writeFileSync(transcript, [user('earlier', 'u0'), user('do it', 'u1'), ...rows].map((r) => JSON.stringify(r)).join('\n') + '\n')
  if (subagent) {
    mkdirSync(join(e.CLAUDE_PLUGIN_DATA, 'subagent-count', 's1'), { recursive: true })
    writeFileSync(join(e.CLAUDE_PLUGIN_DATA, 'subagent-count', 's1', 'agent1'), '{}')
  }
  const stop = (extra = {}) => run(MIRROR, [], { ...input, transcript_path: transcript, stop_hook_active: active, ...extra }, e)
  return { repo, e, stop, transcript, input }
}

const silent = (r) => {
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
}

describe('registration', () => {
  test('hooks.json registers mirror-drift on Stop in exec form', () => {
    const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks/hooks.json'), 'utf8')).hooks
    const entry = hooks.Stop.flatMap((g) => g.hooks).find((h) => h.args?.[0] === '${CLAUDE_PLUGIN_ROOT}/hooks/scripts/mirror-drift.mjs')
    assert.equal(entry.command, 'node')
  })
})

describe('mirror-drift Stop gate', () => {
  test('blocks a changed feature document with no mem_save, naming the document and topic key', () => {
    const { stop } = turn()
    const r = stop()
    assert.equal(r.status, 0)
    assert.equal(r.json.decision, 'block')
    assert.match(r.json.reason, /odd\/tasks\/feat\.md/)
    assert.match(r.json.reason, /odd\/feat\/tasks/)
    assert.match(r.json.reason, /mem_save/)
  })

  test('blocks once per turn: the next Stop of the same turn is silent', () => {
    const { stop } = turn()
    assert.equal(stop().json.decision, 'block')
    silent(stop())
  })

  test('a mem_save with the matching topic_key (either engram tool name) is silent', () => {
    for (const name of ['mcp__engram__mem_save', 'mcp__plugin_engram_engram__mem_save']) {
      const { stop } = turn({ rows: [save('odd/feat/tasks', name), toolResult] })
      silent(stop())
    }
  })

  test('another topic key or another tool does not satisfy the gate', () => {
    for (const row of [save('odd/other/tasks'), save('odd/feat/tasks-extra'), save('odd/feat/tasks', 'mcp__engram__mem_update'), save('odd/feat/tasks', 'Bash')]) {
      const { stop } = turn({ rows: [row] })
      assert.equal(stop().json?.decision, 'block')
    }
  })

  test('with two changed documents only the unsaved one is named', () => {
    const { stop } = turn({ docs: { 'odd/tasks/feat.md': '# feat\nx\n', 'odd/tasks/other.md': '# other\nx\n' }, rows: [save('odd/feat/tasks')] })
    const r = stop()
    assert.equal(r.json.decision, 'block')
    assert.match(r.json.reason, /odd\/other\/tasks/)
    assert.doesNotMatch(r.json.reason, /odd\/feat\/tasks/)
  })

  test('a mem_save from before the last real user prompt does not count', () => {
    const { stop, transcript } = turn()
    writeFileSync(transcript, [user('first', 'a'), save('odd/feat/tasks'), toolResult, user('second', 'b')].map((r) => JSON.stringify(r)).join('\n') + '\n')
    assert.equal(stop().json.decision, 'block')
  })

  test('a tool_result user row is not a prompt boundary', () => {
    const { stop } = turn({ rows: [save('odd/feat/tasks'), toolResult, toolResult] })
    silent(stop())
  })

  test('silent when subagents are open', () => silent(turn({ subagent: true }).stop()))
  test('silent on stop_hook_active', () => silent(turn({ active: true }).stop()))

  test('silent when no document changed (a source change alone, or nothing)', () => {
    silent(turn({ docs: { 'src/a.js': 'export const a = 2\n' } }).stop())
    silent(turn({ docs: {} }).stop())
  })

  test('silent for a change outside odd/tasks, including a non-markdown file there', () => {
    silent(turn({ docs: { 'docs/feat.md': 'x\n', 'odd/tasks/notes.txt': 'x\n', 'odd/other/feat.md': 'x\n' } }).stop())
  })

  test('silent without a mark record, on a missing transcript, and on garbage input', () => {
    const { stop, e, repo } = turn()
    silent(run(MIRROR, [], { session_id: 'nope', cwd: repo, stop_hook_active: false }, e))
    silent(stop({ transcript_path: '/nonexistent/t.jsonl' }))
    silent(run(MIRROR, [], 'not an object', e))
    const bad = spawnSync('node', [MIRROR], { input: '{oops', encoding: 'utf8', env: { ...process.env, ...e } })
    assert.equal(bad.status, 0)
    assert.equal(bad.stdout, '')
  })

  test('silent outside a repository', () => silent(turn({ cwd: scratchDir('odd-mirror-nogit-') }).stop()))

  test('a new turn (new prompt, new mark) can block again', () => {
    const { stop, e, input, repo, transcript } = turn()
    assert.equal(stop().json.decision, 'block')
    run(RISK, ['mark'], input, e)
    applyFiles(repo, { 'odd/tasks/feat.md': '# feat\nchanged again\n' })
    writeFileSync(transcript, [user('third', 'u3')].map((r) => JSON.stringify(r)).join('\n') + '\n')
    assert.equal(stop().json.decision, 'block')
  })

  test('only the tail of a large transcript is read; a save inside it still counts', () => {
    const { stop, transcript } = turn()
    const filler = Array.from({ length: 3000 }, (_, i) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: `pad ${i} ${'x'.repeat(200)}` }] } }))
    writeFileSync(transcript, [JSON.stringify(user('go', 'g')), ...filler, JSON.stringify(save('odd/feat/tasks'))].join('\n') + '\n')
    silent(stop())
  })
})

describe('risk-line stays importable without running', () => {
  test('importing risk-line.mjs exports the record helpers and prints nothing', async () => {
    const r = spawnSync('node', ['--input-type=module', '-e', `const m = await import(${JSON.stringify(RISK)}); console.log(typeof m.recordFile, typeof m.readRecord)`], { encoding: 'utf8', input: '' })
    assert.equal(r.stdout.trim(), 'function function')
  })
})

describe('repeated UserPromptSubmit within one turn (T10)', () => {
  test('a same-prompt_id mark after the change keeps the baseline, so the gate blocks', () => {
    const repo = makeRepo({ 'odd/tasks/feat.md': '# feat\n' })
    const e = { CLAUDE_PLUGIN_DATA: scratchDir('odd-mirror-data-') }
    const input = { session_id: 's1', cwd: repo, stop_hook_active: false, prompt_id: 'p1' }
    run(RISK, ['mark'], { ...input, prompt: 'do it' }, e)
    applyFiles(repo, { 'odd/tasks/feat.md': '# feat\nchanged\n' })
    run(RISK, ['mark'], { ...input, prompt: '<task-notification>\nx\n</task-notification>' }, e)
    const transcript = join(scratchDir('odd-mirror-tr-'), 't.jsonl')
    writeFileSync(transcript, `${JSON.stringify(user('do it'))}\n`)
    const r = run(MIRROR, [], { ...input, transcript_path: transcript }, e)
    assert.equal(r.json?.decision, 'block')
  })
})
