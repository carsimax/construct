// Surface guard (S4): start stores agent_id, the containment matcher, and the write guard hook.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { makeRepo, scratchDir } from '../helpers/repo.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const ADMISSION = join(PLUGIN, 'hooks/scripts/delegation-admission.mjs')
const GUARD = join(PLUGIN, 'hooks/scripts/surface-guard.mjs')
const { surfaceContains } = await import(ADMISSION)

const run = (script, args, input, e, raw) => {
  const r = spawnSync('node', [script, ...args], { input: raw ?? JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ...e } })
  let json = null
  try {
    json = JSON.parse(r.stdout)
  } catch {
    // no output
  }
  return { status: r.status, stdout: r.stdout, json }
}
const WORKER = 'construct:worker'
const prompt = (...paths) => `Do it\n\n## Allowed edit surfaces\n${paths.join('\n')}\n\n## Verification\n- x\n`
// A launched and started worker with agent_id a1.
function started(repo, ...paths) {
  const e = { CLAUDE_PLUGIN_DATA: scratchDir('odd-sg-data-') }
  run(ADMISSION, [], { session_id: 's1', cwd: repo, tool_name: 'Agent', tool_input: { subagent_type: WORKER, prompt: prompt(...paths), description: 'u' } }, e)
  run(ADMISSION, ['start'], { session_id: 's1', agent_id: 'a1', agent_type: WORKER }, e)
  return e
}
const write = (repo, e, path, extra = {}, cwd = repo) => run(GUARD, [], { session_id: 's1', cwd, tool_name: 'Write', tool_input: { file_path: path, content: 'x\n'.repeat(21) }, ...extra }, e)
const isDenied = (r, ...needles) => {
  assert.equal(r.status, 0)
  assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny')
  for (const n of needles) assert.match(r.json.hookSpecificOutput.permissionDecisionReason, n)
}
const isAllowed = (r) => {
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
}

describe('start stores agent_id', () => {
  test('the started record carries the agent_id', () => {
    const e = started(makeRepo({ 'src/a.js': 'a\n' }), 'src/a.js')
    const dir = join(e.CLAUDE_PLUGIN_DATA, 'delegation-admission', 's1')
    const [name] = readdirSync(dir)
    const entry = JSON.parse(readFileSync(join(dir, name), 'utf8'))
    assert.equal(entry.agent_id, 'a1')
    assert.equal(entry.started, true)
  })
})

describe('surfaceContains', () => {
  const cases = [
    ['src/a.js', 'src/a.js', true],
    ['src/a.js', 'src/a.js/x', true],
    ['tests/guard/', 'tests/guard/new.test.mjs', true],
    ['tests/guard', 'tests/guard/new.test.mjs', true],
    ['tests/guard', 'tests/guardx/a.js', false],
    ['tests/*', 'tests/guard/a.js', false],
    ['src/a.js', 'src/b.js', false],
    ['src/*.js', 'src/a.js', true],
    ['src/*.js', 'src/d/a.js', false],
    ['src/**', 'src/a.js', true],
    ['src/**', 'src/d/e/a.js', true],
    ['src/**/a.js', 'src/a.js', true],
    ['src/**/a.js', 'src/d/e/a.js', true],
    ['src/**', 'lib/a.js', false],
    ['./SRC/A.js', 'src/a.JS', true],
    ['tests/admission/*.test.mjs', 'tests/admission/x.test.mjs', true],
  ]
  for (const [surface, path, expected] of cases) test(`${surface} ${expected ? 'contains' : 'excludes'} ${path}`, () => assert.equal(surfaceContains(surface, path), expected))
})

describe('surface-guard', () => {
  test('a worker write inside its surface is allowed', () => {
    const repo = makeRepo({ 'src/a.js': 'a\n' })
    isAllowed(write(repo, started(repo, 'src/**/*.js'), join(repo, 'src/a.js'), { agent_id: 'a1' }))
  })
  test('a worker write outside its surface is denied naming the path and surfaces', () => {
    const repo = makeRepo({ 'src/a.js': 'a\n' })
    isDenied(write(repo, started(repo, 'src/a.js'), join(repo, 'src/b.js'), { agent_id: 'a1' }), /src\/b\.js/, /src\/a\.js/)
  })
  test('a worker with a relative notebook_path is checked too', () => {
    const repo = makeRepo({ 'src/a.js': 'a\n' })
    const r = run(GUARD, [], { session_id: 's1', cwd: repo, agent_id: 'a1', tool_name: 'NotebookEdit', tool_input: { notebook_path: 'n.ipynb' } }, started(repo, 'src/a.js'))
    isDenied(r, /n\.ipynb/)
  })
  for (const surface of ['src/dir/', 'src/dir']) {
    test(`a directory surface ${surface} allows a new file inside and denies a sibling`, () => {
      const repo = makeRepo({ 'src/dir/a.js': 'a\n' })
      const e = started(repo, surface)
      isAllowed(write(repo, e, join(repo, 'src/dir/new.js'), { agent_id: 'a1' }))
      isDenied(write(repo, e, join(repo, 'src/dirx/a.js'), { agent_id: 'a1' }), /src\/dirx\/a\.js/)
    })
  }
  test('a ..hidden file at the root is inside the repository', () => {
    const repo = makeRepo({ 'src/a.js': 'a\n' })
    isDenied(write(repo, {}, join(repo, '..hidden')), /\.\.hidden/)
  })
  test('a case-variant path to the repository root is still inside it', (t) => {
    const repo = realpathSync.native(makeRepo({ 'src/a.js': 'a\n' }))
    const flipped = repo.replace(/[a-z]+/i, (m) => m.toUpperCase() === m ? m.toLowerCase() : m.toUpperCase())
    if (!existsSync(flipped)) return t.skip('case-sensitive filesystem')
    isDenied(write(flipped, {}, join(flipped, 'src/x.js')), /src\/x\.js/)
  })
  test('an unknown agent_id is allowed', () => {
    const repo = makeRepo({ 'src/a.js': 'a\n' })
    isAllowed(write(repo, started(repo, 'src/a.js'), join(repo, 'src/b.js'), { agent_id: 'other' }))
  })
  test('the main thread writing a big file is denied pointing at construct:worker', () => {
    const repo = makeRepo({ 'src/a.js': 'a\n' })
    isDenied(write(repo, {}, join(repo, 'src/x.js'), { tool_input: { file_path: join(repo, 'src/x.js'), content: lines(21) } }), /src\/x\.js/, /21/, /20/, /construct:worker/)
  })
  test('the main thread writing odd/tasks/ is allowed', () => {
    const repo = makeRepo({ 'src/a.js': 'a\n' })
    isAllowed(write(repo, {}, join(repo, 'odd/tasks/f.md')))
  })
  test('a path outside the repository is allowed', () => {
    const repo = makeRepo({ 'src/a.js': 'a\n' })
    isAllowed(write(repo, {}, join(scratchDir('odd-sg-out-'), 'x.js')))
  })
  test('a cwd outside a git repository is allowed', () => {
    const dir = scratchDir('odd-sg-nogit-')
    isAllowed(write(dir, {}, join(dir, 'x.js')))
  })
  test('other tools are ignored', () => {
    const repo = makeRepo({ 'src/a.js': 'a\n' })
    isAllowed(run(GUARD, [], { cwd: repo, tool_name: 'Read', tool_input: { file_path: join(repo, 'src/x.js') } }, {}))
  })
  test('bad JSON prints nothing and exits 0', () => {
    isAllowed(run(GUARD, [], null, {}, '{nope'))
  })
})

// S5: the main thread edits small changes inline, up to inline_edit_max_lines changed lines per call.
const lines = (n, tag = 'l') => Array.from({ length: n }, (_, i) => `${tag}${i}`).join('\n')
const tool = (repo, tool_name, tool_input, env = {}) => run(GUARD, [], { session_id: 's1', cwd: repo, tool_name, tool_input }, env)
const edit = (repo, old_string, new_string, extra = {}, env) => tool(repo, 'Edit', { file_path: join(repo, 'src/a.js'), old_string, new_string, ...extra }, env)

describe('inline edit limit (S5)', () => {
  const repo = makeRepo({ 'src/a.js': 'a\n', 'src/big.js': `${lines(10, 'x')}\n` })
  test('Edit passes at exactly 20 lines and is denied at 21, naming count, limit, and worker', () => {
    isAllowed(edit(repo, lines(20), lines(3, 'n')))
    isAllowed(edit(repo, 'a', lines(20, 'n')))
    isDenied(edit(repo, 'a', lines(21, 'n')), /21/, /20/, /construct:worker/)
    isDenied(edit(repo, lines(21), 'a'), /21/)
  })
  test('Edit with replace_all multiplies by the occurrences in the file', () => {
    const r = makeRepo({ 'src/a.js': `${Array(11).fill('a').join('\n')}\n` })
    isAllowed(edit(r, 'a', 'b\nc', { replace_all: false }))
    isDenied(edit(r, 'a', 'b\nc', { replace_all: true }), /22/)
  })
  test('MultiEdit sums its edits', () => {
    const multi = (...edits) => tool(repo, 'MultiEdit', { file_path: join(repo, 'src/a.js'), edits })
    isAllowed(multi({ old_string: 'a', new_string: lines(10) }, { old_string: 'b', new_string: lines(10) }))
    isDenied(multi({ old_string: 'a', new_string: lines(10) }, { old_string: 'b', new_string: lines(11) }), /21/, /construct:worker/)
  })
  test('Write of a new file counts every line', () => {
    const w = (n) => tool(repo, 'Write', { file_path: join(repo, 'src/new.js'), content: lines(n) })
    isAllowed(w(20))
    isDenied(w(21), /21/)
  })
  test('Write over an existing file counts lines added plus removed', () => {
    const w = (content) => tool(repo, 'Write', { file_path: join(repo, 'src/big.js'), content })
    isAllowed(w(`${lines(10, 'x')}\n`))
    isAllowed(w(`${lines(10, 'x')}\n${lines(10, 'y')}\n`))
    isAllowed(w(`${lines(10, 'y')}\n`))
    isDenied(w(`${lines(11, 'y')}\n`), /21/)
  })
  test('NotebookEdit counts the lines of new_source', () => {
    const nb = (n) => tool(repo, 'NotebookEdit', { notebook_path: join(repo, 'n.ipynb'), new_source: lines(n) })
    isAllowed(nb(20))
    isDenied(nb(21), /21/)
  })
  test('odd/tasks/ is allowed at any size', () => {
    isAllowed(tool(repo, 'Write', { file_path: join(repo, 'odd/tasks/f.md'), content: lines(500) }))
  })
  test('the option sets the limit; 0 restores the odd/tasks/-only rule; invalid values fall back to 20', () => {
    const env = (v) => ({ CLAUDE_PLUGIN_OPTION_INLINE_EDIT_MAX_LINES: v })
    isAllowed(edit(repo, 'a', lines(50, 'n'), {}, env('50')))
    isDenied(edit(repo, 'a', lines(51, 'n'), {}, env('50')), /51/, /50/)
    isDenied(edit(repo, 'a', 'b', {}, env('0')), /construct:worker/)
    isAllowed(tool(repo, 'Write', { file_path: join(repo, 'odd/tasks/f.md'), content: 'x' }, env('0')))
    for (const bad of ['', 'abc', '-3', '2.5']) {
      isAllowed(edit(repo, 'a', lines(20, 'n'), {}, env(bad)))
      isDenied(edit(repo, 'a', lines(21, 'n'), {}, env(bad)), /20/)
    }
  })
  test('a writer subagent keeps its surface rule regardless of size', () => {
    const r = makeRepo({ 'src/a.js': 'a\n' })
    const e = started(r, 'src/a.js')
    const asWriter = (path, content) => run(GUARD, [], { session_id: 's1', cwd: r, agent_id: 'a1', tool_name: 'Write', tool_input: { file_path: join(r, path), content } }, e)
    isAllowed(asWriter('src/a.js', lines(500)))
    isDenied(asWriter('src/b.js', 'x'), /src\/b\.js/)
  })
})

describe('registration (S5)', () => {
  test('hooks.json registers surface-guard on the write tools in exec form, failing open', () => {
    const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks/hooks.json'), 'utf8')).hooks
    const group = hooks.PreToolUse.find((g) => g.hooks.some((h) => h.args?.[0].endsWith('surface-guard.mjs')))
    assert.ok(group)
    assert.equal(group.matcher, 'Write|Edit|MultiEdit|NotebookEdit')
    const entry = group.hooks.find((h) => h.args?.[0].endsWith('surface-guard.mjs'))
    assert.deepEqual(entry, { type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/surface-guard.mjs'], timeout: 10 })
    assert.equal(entry.onFailure, undefined)
  })
})
