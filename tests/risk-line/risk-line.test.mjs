// The Risk line gate, driven as real hooks: node risk-line.mjs mark|check with the
// hook JSON on stdin and a scratch CLAUDE_PLUGIN_DATA directory.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyFiles, makeRepo, scratchDir } from '../review/helpers.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const SCRIPT = join(PLUGIN, 'hooks/scripts/risk-line.mjs')

const env = () => ({ CLAUDE_PLUGIN_DATA: scratchDir('odd-risk-data-') })

function run(mode, cwd, e, { session = 's1', extra = {}, input } = {}) {
  const result = spawnSync('node', [SCRIPT, mode], {
    input: input ?? JSON.stringify({ session_id: session, cwd, stop_hook_active: false, ...extra }),
    encoding: 'utf8',
    env: { ...process.env, ...e },
  })
  let json = null
  try {
    json = JSON.parse(result.stdout)
  } catch {
    // No output.
  }
  return { status: result.status, stdout: result.stdout, json }
}

const silent = (r) => {
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
}
const check = (repo, e, message, extra = {}) => run('check', repo, e, { extra: { last_assistant_message: message, ...extra } })

// A repository with the turn's prompt marked and one source file changed.
function changed(files = { 'src/a.js': 'export const a = 2\n' }) {
  const repo = makeRepo({ 'src/a.js': 'export const a = 1\n' })
  const e = env()
  silent(run('mark', repo, e))
  applyFiles(repo, files)
  return { repo, e }
}

describe('registration', () => {
  test('hooks.json registers mark and check in exec form', () => {
    const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks/hooks.json'), 'utf8')).hooks
    const script = '${CLAUDE_PLUGIN_ROOT}/hooks/scripts/risk-line.mjs'
    const entry = (event, mode) =>
      hooks[event].flatMap((group) => group.hooks).find((hook) => hook.args?.[0] === script && hook.args[1] === mode)
    assert.equal(entry('UserPromptSubmit', 'mark').command, 'node')
    assert.equal(entry('Stop', 'check').command, 'node')
    assert.ok(hooks.Stop.flatMap((group) => group.hooks).some((hook) => hook.args?.[0].endsWith('review-gate.mjs')))
  })
})

describe('check', () => {
  test('blocks a change outside odd/tasks without a Risk line', () => {
    const { repo, e } = changed()
    const r = check(repo, e, 'Done.')
    assert.equal(r.status, 0)
    assert.equal(r.json.decision, 'block')
    assert.match(r.json.reason, /src\/a\.js/)
    assert.match(r.json.reason, /Risk: item N \(reason\)/)
    assert.match(r.json.reason, /Risk: none/)
  })

  test('names at most three changed paths', () => {
    const { repo, e } = changed({ 'a.txt': '1', 'b.txt': '1', 'c.txt': '1', 'd.txt': '1' })
    const r = check(repo, e, 'Done.')
    assert.equal(r.json.decision, 'block')
    assert.equal(['a.txt', 'b.txt', 'c.txt', 'd.txt'].filter((p) => r.json.reason.includes(p)).length, 3)
  })

  for (const line of ['Risk: none', '- **Risk:** item 2 (touches auth)', '* `Risk:` item 6 (x)', '_Risk:_ none', 'Summary\n\nRisk: item 1 (money)',
    '**Risk**: none', 'Risk: **none**', 'Risk: `none`', '**Risk:** item 2', 'Risk:none',
    '+ Risk: none', '1. Risk: none', '2) Risk: item 3 (x)', 'Risk: item 2(x)', 'Risk: none \t']) {
    test(`accepts ${JSON.stringify(line)}`, () => {
      const { repo, e } = changed()
      silent(check(repo, e, line))
    })
  }

  for (const line of ['risk: none', 'Risk: item 7 (x)', 'Risk: maybe', 'The Risk: none holds',
    'Risk: None', 'Risk: item 10', '> Risk: none', '## Risk: none',
    'Risk: none-ish', 'Risk: nonexistent', 'Risk: item 2x', 'Risk: item 2-ish', 'Risk: none.']) {
    test(`rejects ${JSON.stringify(line)}`, () => {
      const { repo, e } = changed()
      assert.equal(check(repo, e, line).json?.decision, 'block')
    })
  }

  test('accepts a multi-line unified close that ends with the Risk line', () => {
    const { repo, e } = changed()
    const close = [
      'Verified: node --test tests/: 631 pass; claude plugin test plugins/construct: 139 pass.',
      'Skipped: claude plugin validate (not installed here).',
      'Not checked: behavior in a real session.',
      '',
      'Risk: item 3 (every session consumes the contracts)',
    ].join('\n')
    silent(check(repo, e, close))
  })

  test('a rename into odd/tasks reports the deleted source path', () => {
    const repo = makeRepo({ 'src/a.js': 'export const a = 1\n' })
    const e = env()
    silent(run('mark', repo, e))
    mkdirSync(join(repo, 'odd/tasks'), { recursive: true })
    execFileSync('git', ['mv', 'src/a.js', 'odd/tasks/a.js'], { cwd: repo })
    const r = check(repo, e, 'Done.')
    assert.equal(r.json.decision, 'block')
    assert.match(r.json.reason, /src\/a\.js/)
  })

  test('a record marked in another repository is ignored', () => {
    const e = env()
    const a = makeRepo({ 'src/a.js': 'export const a = 1\n' })
    silent(run('mark', a, e))
    const b = makeRepo({ 'src/a.js': 'export const a = 1\n' })
    applyFiles(b, { 'src/a.js': 'export const a = 2\n' })
    silent(check(b, e, 'Done.'))
  })

  test('a record without a root is ignored', () => {
    const { repo, e } = changed()
    const file = join(e.CLAUDE_PLUGIN_DATA, 'risk-line', 's1.json')
    const record = JSON.parse(readFileSync(file, 'utf8'))
    delete record.root
    writeFileSync(file, JSON.stringify(record))
    silent(check(repo, e, 'Done.'))
  })

  test('only odd/tasks changed', () => {
    const { repo, e } = changed({ 'odd/tasks/x.md': '# x\n' })
    silent(check(repo, e, 'Done.'))
  })

  test('no change', () => {
    const repo = makeRepo({ 'src/a.js': 'export const a = 1\n' })
    const e = env()
    silent(run('mark', repo, e))
    silent(check(repo, e, 'Done.'))
  })

  test('blocks once per turn', () => {
    const { repo, e } = changed()
    assert.equal(check(repo, e, 'Done.').json.decision, 'block')
    silent(check(repo, e, 'Done.'))
  })

  test('a new mark re-arms the gate', () => {
    const { repo, e } = changed()
    assert.equal(check(repo, e, 'Done.').json.decision, 'block')
    silent(run('mark', repo, e))
    applyFiles(repo, { 'src/b.js': 'x\n' })
    assert.equal(check(repo, e, 'Done.').json.decision, 'block')
  })

  test('stop_hook_active', () => {
    const { repo, e } = changed()
    silent(check(repo, e, 'Done.', { stop_hook_active: true }))
  })

  test('no record', () => {
    const repo = makeRepo({ 'src/a.js': 'export const a = 1\n' })
    applyFiles(repo, { 'src/a.js': 'export const a = 2\n' })
    silent(check(repo, env(), 'Done.'))
  })

  test('missing or non-string last_assistant_message', () => {
    const { repo, e } = changed()
    silent(run('check', repo, e))
    silent(check(repo, e, 42))
  })

  test('not a repository and bad input', () => {
    const e = env()
    silent(run('mark', scratchDir('odd-risk-plain-'), e))
    silent(check(scratchDir('odd-risk-plain-'), e, 'Done.'))
    silent(run('check', '/', e, { input: 'not json' }))
  })
})

describe('mark', () => {
  test('prints nothing and records the tree', () => {
    const repo = makeRepo({ 'src/a.js': 'x\n' })
    const e = env()
    const r = run('mark', repo, e)
    silent(r)
    assert.match(readFileSync(join(e.CLAUDE_PLUGIN_DATA, 'risk-line', 's1.json'), 'utf8'), /"tree":"[0-9a-f]{40,}"/)
    assert.equal(JSON.parse(readFileSync(join(e.CLAUDE_PLUGIN_DATA, 'risk-line', 's1.json'), 'utf8')).root, realpathSync(repo))
  })
})

// A task-notification repeats UserPromptSubmit within one turn with the same prompt_id
// (observed live, T10); a repeat after the change must not move the turn's baseline.
describe('mark across repeated UserPromptSubmit', () => {
  const mark = (repo, e, prompt_id, prompt = 'x') => run('mark', repo, e, { extra: { prompt_id, prompt } })

  test('a repeat with the same prompt_id keeps the record, so check still blocks', () => {
    const repo = makeRepo({ 'src/a.js': 'export const a = 1\n' })
    const e = env()
    silent(mark(repo, e, 'p1', 'do it'))
    applyFiles(repo, { 'src/a.js': 'export const a = 2\n' })
    silent(mark(repo, e, 'p1', '<task-notification>\nnote\n</task-notification>'))
    assert.equal(check(repo, e, 'Done.').json.decision, 'block')
  })

  test('a new prompt_id re-arms: the new baseline includes the earlier change', () => {
    const repo = makeRepo({ 'src/a.js': 'export const a = 1\n' })
    const e = env()
    silent(mark(repo, e, 'p1'))
    applyFiles(repo, { 'src/a.js': 'export const a = 2\n' })
    silent(mark(repo, e, 'p2'))
    silent(check(repo, e, 'Done.'))
  })

  test('a spent block stays spent when the same prompt_id repeats', () => {
    const repo = makeRepo({ 'src/a.js': 'export const a = 1\n' })
    const e = env()
    silent(mark(repo, e, 'p1'))
    applyFiles(repo, { 'src/a.js': 'export const a = 2\n' })
    assert.equal(check(repo, e, 'Done.').json.decision, 'block')
    silent(mark(repo, e, 'p1'))
    silent(check(repo, e, 'Done.'))
  })

  test('a repeated prompt_id returns before freezing the working tree', () => {
    const repo = makeRepo({ 'src/a.js': 'export const a = 1\n' })
    const e = env()
    silent(mark(repo, e, 'p1'))
    applyFiles(repo, { 'src/new.js': 'export const unique = 123456\n' })
    const objects = () => execFileSync('git', ['count-objects', '-v'], { cwd: repo, encoding: 'utf8' })
    const before = objects()
    silent(mark(repo, e, 'p1'))
    assert.equal(objects(), before)
  })

  test('without a prompt_id every mark re-marks, as before', () => {
    const repo = makeRepo({ 'src/a.js': 'export const a = 1\n' })
    const e = env()
    silent(run('mark', repo, e))
    applyFiles(repo, { 'src/a.js': 'export const a = 2\n' })
    silent(run('mark', repo, e))
    silent(check(repo, e, 'Done.'))
  })
})
