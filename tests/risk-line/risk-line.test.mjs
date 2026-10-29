// The Risk line gate, driven as real hooks: node risk-line.mjs mark|check with the
// hook JSON on stdin and a scratch CLAUDE_PLUGIN_DATA directory.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyFiles, git, makeRepo, scratchDir } from '../helpers/repo.mjs'

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
  })
})

describe('check', () => {
  test('blocks a change outside .vault/tasks without a Risk line', () => {
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
    '+ Risk: none', '1. Risk: none', '2) Risk: item 3 (x)', 'Risk: item 2(x)', 'Risk: none \t',
    'Risk: items 2, 5 (x)', '- **Risk:** items 1, 3', 'Risk: items 2,5']) {
    test(`accepts ${JSON.stringify(line)}`, () => {
      const { repo, e } = changed()
      silent(check(repo, e, line))
    })
  }

  for (const line of ['risk: none', 'Risk: item 7 (x)', 'Risk: maybe', 'The Risk: none holds',
    'Risk: None', 'Risk: item 10', '> Risk: none', '## Risk: none',
    'Risk: none-ish', 'Risk: nonexistent', 'Risk: item 2x', 'Risk: item 2-ish', 'Risk: none.',
    'Risk: items', 'Risk: items 7', 'Risk: item 2,', 'Risk: items 2, 7', 'Risk: items 2,', 'Risk: items 2, 5, 7']) {
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

  test('a rename into .vault/tasks reports the deleted source path', () => {
    const repo = makeRepo({ 'src/a.js': 'export const a = 1\n' })
    const e = env()
    silent(run('mark', repo, e))
    mkdirSync(join(repo, '.vault/tasks'), { recursive: true })
    execFileSync('git', ['mv', 'src/a.js', '.vault/tasks/a.js'], { cwd: repo })
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

  test('only .vault/tasks changed', () => {
    const { repo, e } = changed({ '.vault/tasks/x.md': '# x\n' })
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
  test('prints nothing and records a fingerprint of the listed paths', () => {
    const repo = makeRepo({ 'src/a.js': 'x\n' })
    const e = env()
    const r = run('mark', repo, e)
    silent(r)
    const record = JSON.parse(readFileSync(join(e.CLAUDE_PLUGIN_DATA, 'risk-line', 's1.json'), 'utf8'))
    assert.equal(record.root, realpathSync(repo))
    assert.deepEqual(record.fp, {})
  })

  test('a dirty path is recorded with its status, size and mtime', () => {
    const repo = makeRepo({ 'src/a.js': 'x\n' })
    applyFiles(repo, { 'src/a.js': 'xyz\n' })
    const e = env()
    silent(run('mark', repo, e))
    const record = JSON.parse(readFileSync(join(e.CLAUDE_PLUGIN_DATA, 'risk-line', 's1.json'), 'utf8'))
    assert.match(record.fp['src/a.js'], /^ M 4 \d/)
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

  test('a repeated prompt_id leaves the record untouched', () => {
    const repo = makeRepo({ 'src/a.js': 'export const a = 1\n' })
    const e = env()
    silent(mark(repo, e, 'p1'))
    applyFiles(repo, { 'src/new.js': 'export const unique = 123456\n' })
    const file = join(e.CLAUDE_PLUGIN_DATA, 'risk-line', 's1.json')
    const before = readFileSync(file, 'utf8')
    silent(mark(repo, e, 'p1'))
    assert.equal(readFileSync(file, 'utf8'), before)
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

describe('audit fixes', () => {
  test('mark prunes state older than the prune age and keeps fresh state', () => {
    const repo = makeRepo({ 'src/a.js': 'export const a = 1\n' })
    const e = env()
    const dir = join(e.CLAUDE_PLUGIN_DATA, 'subagent-count')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'old.state'), 'x')
    writeFileSync(join(dir, 'fresh.state'), 'x')
    const old = new Date(Date.now() - 8 * 24 * 3600 * 1000)
    utimesSync(join(dir, 'old.state'), old, old)
    silent(run('mark', repo, e))
    assert.equal(existsSync(join(dir, 'old.state')), false)
    assert.equal(existsSync(join(dir, 'fresh.state')), true)
  })

  test('check with a Risk line fails open when git fails', () => {
    const { repo, e } = changed()
    const shim = scratchDir('odd-git-shim-')
    const log = join(shim, 'calls')
    writeFileSync(join(shim, 'git'), `#!/bin/sh\necho call >> "${log}"\nexit 1\n`, { mode: 0o755 })
    const r = spawnSync('node', [SCRIPT, 'check'], {
      input: JSON.stringify({ session_id: 's1', cwd: repo, stop_hook_active: false, last_assistant_message: 'Done.\nRisk: none' }),
      encoding: 'utf8',
      env: { ...process.env, ...e, PATH: `${shim}:${process.env.PATH}` },
    })
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '')
  })
})

describe('verifier-weakening markers (S2)', () => {
  const marked = (files, message = 'Done.\nRisk: none') => {
    const { repo, e } = changed(files)
    return { repo, e, r: check(repo, e, message) }
  }

  for (const [name, path, line] of [
    ['it.skip', 'src/a.test.js', "it.skip('x', () => {})"],
    ['describe.only', 'src/a.test.js', "describe.only('x', () => {})"],
    ['test.todo', 'src/a.test.js', "test.todo('x')"],
    ['xit', 'src/a.test.js', "xit('x', () => {})"],
    ['pytest skip', 'tests/test_a.py', '@pytest.mark.skip(reason="x")'],
    ['t.Skip', 'a_test.go', '\tt.Skip("x")'],
    ['Not implemented stub', 'src/a.js', "throw new Error('Not implemented')"],
    ['TODO comment', 'src/a.js', '// TODO fix later'],
    ['TODO hash comment', 'src/a.py', '  # TODO fix later'],
    ['trailing // TODO after code', 'src/a.js', 'x = 1 // TODO fix'],
    ['trailing # TODO after code', 'src/a.py', 'y = 2  # TODO later'],
    ['node:test skip option', 'src/a.test.js', "it('x', { skip: true }, () => {})"],
    ['node:test only option', 'src/a.test.js', "describe('x', { only: true }, () => {})"],
    ['t.Skipf', 'a_test.go', '\tt.Skipf("x %d", 1)'],
    ['t.SkipNow', 'a_test.go', '\tt.SkipNow()'],
    ['NotImplementedError', 'src/a.py', '    raise NotImplementedError'],
  ]) {
    test(`${name} blocks even with a Risk line, naming path:line`, () => {
      const { r } = marked({ [path]: `export const ok = 1\n${line}\n` })
      assert.equal(r.json.decision, 'block')
      assert.match(r.json.reason, new RegExp(`${path.replace(/\./g, '\\.')}:2`))
      assert.match(r.json.reason, /Remove the marker/)
    })
  }

  test('a marker inside a quoted string does not block', () => {
    const { r } = marked({ 'src/a.test.js': `const fixture = "it.skip('x')"\nconst t = 'throw new Error("Not implemented")'\n` })
    silent(r)
  })

  test('TODO in a Markdown file or a non-comment does not block', () => {
    const { r } = marked({ 'docs/a.md': 'TODO: write\n', 'src/b.js': "const todo = 'TODO'\n" })
    silent(r)
  })

  test('a Markdown path with a space is still Markdown (git ends its +++ header with a tab)', () => {
    const { r } = marked({ 'docs/my notes.md': '# TODO later\n' })
    silent(r)
  })

  test('anchored TODO and skipif do not false-positive', () => {
    const { r } = marked({
      'src/a.js': "const t = '// TODO'\nconst u = 'https://example.com/TODO'\nconst v = 1 // mentions TODO mid-sentence\n",
      'scripts/a.sh': 'git log --grep TODO\n',
      'tests/test_a.py': '@pytest.mark.skipif(True, reason="x")\n',
    })
    silent(r)
  })

  test('trailing TODO look-alikes do not block', () => {
    const { r } = marked({
      'src/a.js': "fetch('http://x/TODO')\nconst todo = 1 // todo-list\n",
      'src/a.py': 'a#TODO\n',
    })
    silent(r)
  })

  test('every marker in a Markdown file is skipped', () => {
    const { r } = marked({ 'docs/a.md': "it.skip('x')\nraise NotImplementedError\nt.SkipNow()\n" })
    silent(r)
  })

  test('a git mv of a file with an existing marker is not flagged', () => {
    const repo = makeRepo({ 'src/a.test.js': "it.skip('old', () => {})\nexport const a = 1\nexport const b = 2\n" })
    const e = env()
    silent(run('mark', repo, e))
    git(repo, 'mv', 'src/a.test.js', 'src/b.test.js')
    silent(check(repo, e, 'Done.\nRisk: none'))
  })

  test('markers under .vault/tasks are ignored', () => {
    const { r } = marked({ '.vault/tasks/f.md': '// TODO x\nit.skip(1)\n' })
    silent(r)
  })

  test('markers that predate the turn are not reported', () => {
    const repo = makeRepo({ 'src/a.test.js': "it.skip('old', () => {})\n" })
    const e = env()
    silent(run('mark', repo, e))
    applyFiles(repo, { 'src/b.js': 'export const b = 1\n' })
    silent(check(repo, e, 'Done.\nRisk: none'))
  })

  test('at most three hits are named and a second Stop passes', () => {
    const { repo, e, r } = marked({ 'src/a.test.js': ['it.skip(1)', 'it.skip(2)', 'it.skip(3)', 'it.skip(4)'].join('\n') + '\n' })
    assert.equal(r.json.decision, 'block')
    assert.equal((r.json.reason.match(/a\.test\.js:\d/g) ?? []).length, 3)
    silent(check(repo, e, 'Done.\nRisk: none'))
  })

  test('stop_hook_active still wins', () => {
    const { repo, e } = changed({ 'src/a.test.js': 'it.skip(1)\n' })
    silent(check(repo, e, 'Done.\nRisk: none', { stop_hook_active: true }))
  })

  test('a marker and a missing Risk line give one block covering both', () => {
    const { repo, e, r } = marked({ 'src/a.test.js': 'it.skip(1)\n' }, 'Done.')
    assert.equal(r.json.decision, 'block')
    assert.match(r.json.reason, /Risk: none/)
    assert.match(r.json.reason, /a\.test\.js:1/)
    silent(check(repo, e, 'Done.'))
  })
})

describe('fingerprint (S6)', () => {
  const tick = (repo, path) => {
    const t = new Date(Date.now() + 5000)
    utimesSync(join(repo, path), t, t)
  }

  test('a path edited between mark and check is reported', () => {
    const { repo, e } = changed()
    assert.match(check(repo, e, 'Done.').json.reason, /src\/a\.js/)
  })

  test('a path already dirty at mark and edited again (size) is reported', () => {
    const repo = makeRepo({ 'src/a.js': 'export const a = 1\n' })
    applyFiles(repo, { 'src/a.js': 'export const a = 2\n' })
    const e = env()
    silent(run('mark', repo, e))
    applyFiles(repo, { 'src/a.js': 'export const a = 22\n' })
    assert.match(check(repo, e, 'Done.').json.reason, /src\/a\.js/)
  })

  test('a path already dirty at mark and rewritten with the same size and a new mtime is reported', () => {
    const repo = makeRepo({ 'src/a.js': 'export const a = 1\n' })
    applyFiles(repo, { 'src/a.js': 'export const a = 2\n' })
    const e = env()
    silent(run('mark', repo, e))
    applyFiles(repo, { 'src/a.js': 'export const a = 3\n' })
    tick(repo, 'src/a.js')
    assert.match(check(repo, e, 'Done.').json.reason, /src\/a\.js/)
  })

  test('an untouched dirty path is not reported', () => {
    const repo = makeRepo({ 'src/a.js': 'export const a = 1\n' })
    applyFiles(repo, { 'src/a.js': 'export const a = 2\n', 'src/n.js': 'export const n = 1\n' })
    const e = env()
    silent(run('mark', repo, e))
    silent(check(repo, e, 'Done.'))
  })

  test('a new untracked file is reported, and a marker in it is scanned', () => {
    const repo = makeRepo({ 'src/a.js': 'export const a = 1\n' })
    const e = env()
    silent(run('mark', repo, e))
    applyFiles(repo, { 'src/new.test.js': 'it.skip(1)\n' })
    const r = check(repo, e, 'Done.\nRisk: none')
    assert.equal(r.json.decision, 'block')
    assert.match(r.json.reason, /new\.test\.js:1/)
  })

  test('a path deleted after the mark is reported', () => {
    const repo = makeRepo({ 'src/a.js': 'export const a = 1\n' })
    const e = env()
    silent(run('mark', repo, e))
    git(repo, 'rm', '-q', 'src/a.js')
    assert.match(check(repo, e, 'Done.').json.reason, /src\/a\.js/)
  })

  test('an old record with a tree and no fingerprint blocks nothing', () => {
    const { repo, e } = changed()
    const file = join(e.CLAUDE_PLUGIN_DATA, 'risk-line', 's1.json')
    const { root, blocked } = JSON.parse(readFileSync(file, 'utf8'))
    writeFileSync(file, JSON.stringify({ root, tree: 'a'.repeat(40), blocked }))
    silent(check(repo, e, 'Done.'))
  })

  test('a repeated prompt_id re-marks an old record that has no fingerprint', () => {
    const repo = makeRepo({ 'src/a.js': 'export const a = 1\n' })
    const e = env()
    const file = join(e.CLAUDE_PLUGIN_DATA, 'risk-line', 's1.json')
    mkdirSync(join(e.CLAUDE_PLUGIN_DATA, 'risk-line'), { recursive: true })
    writeFileSync(file, JSON.stringify({ root: realpathSync(repo), tree: 'a'.repeat(40), blocked: false, prompt_id: 'p1' }))
    silent(run('mark', repo, e, { extra: { prompt_id: 'p1' } }))
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).fp, {})
  })
})
