// Drives the real feature-state SessionStart hook with stdin JSON.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { makeRepo, scratchDir, write } from '../helpers/repo.mjs'

const SCRIPT = new URL('../../plugins/construct/hooks/scripts/feature-state.mjs', import.meta.url).pathname
const HOOKS = new URL('../../plugins/construct/hooks/hooks.json', import.meta.url).pathname

function run(cwd, input = { source: 'compact' }) {
  const stdin = typeof input === 'string' ? input : JSON.stringify({ cwd, ...input })
  const r = spawnSync('node', [SCRIPT], { input: stdin, encoding: 'utf8', cwd: scratchDir('fs-run-') })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

function context(result) {
  assert.equal(result.status, 0)
  const out = JSON.parse(result.stdout)
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart')
  return out.hookSpecificOutput.additionalContext
}

function doc({ title = 'Feature X', branch = 'Tracker branch: `feat/x`', rows = [], log = '' } = {}) {
  const body = rows.map(([id, task, status]) => `| ${id} | S1 | ${task} | inline | none | ${status} | — |`).join('\n')
  return `# ${title}\n\nObjective: do the thing.\n${branch}\n\n## Specs\n\n- **S1 — Same.**\n\n## Tasks\n\n| ID | Specs | Task | Route | Risk | Status | Commit |\n|---|---|---|---|---|---|---|\n${body}\n\n## Log\n${log}\n`
}

function setMtime(repo, name, seconds) {
  const t = new Date(Date.now() + seconds * 1000)
  utimesSync(join(repo, 'odd/tasks', name), t, t)
}

test('one active document lists path, title, branch, unfinished rows, and the last Next step', () => {
  const repo = makeRepo()
  write(repo, 'odd/tasks/alpha.md', doc({
    title: 'Alpha plan',
    rows: [['T1', 'First thing', 'done'], ['T2', 'Second thing', 'in progress'], ['T3', 'Third thing', 'pending']],
    log: '- L1 Next step: old\n- L2 notes\n  - Next step: do T2 now\n',
  }))
  const text = context(run(repo))
  assert.match(text, /odd\/tasks\/alpha\.md/)
  assert.match(text, /Alpha plan/)
  assert.match(text, /Tracker branch: `feat\/x`/)
  assert.match(text, /T2 — Second thing/)
  assert.match(text, /T3 — Third thing/)
  assert.doesNotMatch(text, /First thing/)
  assert.match(text, /Next step: do T2 now/)
  assert.doesNotMatch(text, /Next step: old/)
  assert.ok(text.trimEnd().endsWith('Read the full document before continuing.'))
  assert.doesNotMatch(text, /mirror|engram/)
})

test('runs on a Node without require(esm) detection (S18)', () => {
  const repo = makeRepo()
  write(repo, 'odd/tasks/a.md', doc({ rows: [['T1', 'x', 'pending']] }))
  const r = spawnSync('node', ['--no-experimental-detect-module', SCRIPT], { input: JSON.stringify({ cwd: repo, source: 'compact' }), encoding: 'utf8', cwd: scratchDir('fs-run-') })
  assert.equal(r.status, 0)
  assert.match(context(r), /T1 — x/)
})

test('a Branch: header line is also reported', () => {
  const repo = makeRepo()
  write(repo, 'odd/tasks/b.md', doc({ branch: 'Branch: `odd/b`', rows: [['T1', 'x', 'pending']] }))
  assert.match(context(run(repo)), /Branch: `odd\/b`/)
})

test('all tasks done: no output, exit 0', () => {
  const repo = makeRepo()
  write(repo, 'odd/tasks/a.md', doc({ rows: [['T1', 'x', 'done'], ['T2', 'y', 'done']] }))
  const r = run(repo)
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
})

test('dropped counts as finished', () => {
  const repo = makeRepo()
  write(repo, 'odd/tasks/a.md', doc({ rows: [['T1', 'x', 'done'], ['T2', 'y', 'dropped']] }))
  assert.equal(run(repo).stdout, '')
})

test('statuses compare case-insensitively', () => {
  const repo = makeRepo()
  write(repo, 'odd/tasks/a.md', doc({ rows: [['T1', 'x', 'DONE'], ['T2', 'y', 'Dropped']] }))
  assert.equal(run(repo).stdout, '')
  write(repo, 'odd/tasks/b.md', doc({ rows: [['T1', 'open one', 'Pending'], ['T2', 'z', 'Done']] }))
  const text = context(run(repo))
  assert.match(text, /open one/)
  assert.doesNotMatch(text, /odd\/tasks\/a\.md/)
})

test('at most three documents, newest mtime first', () => {
  const repo = makeRepo()
  const names = ['d1', 'd2', 'd3', 'd4']
  names.forEach((n, i) => {
    write(repo, `odd/tasks/${n}.md`, doc({ title: `Title ${n}`, rows: [['T1', `task ${n}`, 'pending']] }))
    setMtime(repo, `${n}.md`, i * 10) // d4 newest, d1 oldest
  })
  const text = context(run(repo))
  assert.doesNotMatch(text, /d1\.md/)
  const order = ['d4', 'd3', 'd2'].map((n) => text.indexOf(`odd/tasks/${n}.md`))
  assert.ok(order.every((i) => i >= 0))
  assert.deepEqual([...order].sort((a, b) => a - b), order)
})

test('additionalContext stays within 2500 characters and keeps every header', () => {
  const repo = makeRepo()
  for (const n of ['p', 'q', 'r']) {
    const rows = Array.from({ length: 40 }, (_, i) => [`T${i}`, `${'long task text '.repeat(20)}${n}`, 'pending'])
    write(repo, `odd/tasks/${n}.md`, doc({ title: `Title ${n}`, rows, log: 'Next step: go\n' }))
  }
  const text = context(run(repo))
  assert.ok(text.length <= 2500, `length ${text.length}`)
  for (const n of ['p', 'q', 'r']) assert.match(text, new RegExp(`odd/tasks/${n}\\.md`))
  assert.match(text, /Read the full document before continuing\./)
  assert.match(text, /Read the full document before continuing/)
})

test('task cells are truncated to 160 characters', () => {
  const repo = makeRepo()
  write(repo, 'odd/tasks/a.md', doc({ rows: [['T1', 'x'.repeat(400), 'pending']] }))
  const text = context(run(repo))
  assert.match(text, /x{100}/)
  assert.doesNotMatch(text, /x{161}/)
})

test('a malformed table yields no output and exit 0', () => {
  const repo = makeRepo()
  write(repo, 'odd/tasks/a.md', '# Broken\n\n## Tasks\n\n| ID | Task |\n| T1 | only |\n| T2\n\n## Log\n')
  const r = run(repo)
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
  write(repo, 'odd/tasks/b.md', '# No table\n\n## Tasks\n\nnothing here\n')
  assert.equal(run(repo).stdout, '')
})

test('an odd/tasks directory without markdown files yields no output', () => {
  const repo = makeRepo()
  mkdirSync(join(repo, 'odd/tasks'), { recursive: true })
  write(repo, 'odd/tasks/notes.txt', 'x')
  const r = run(repo)
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
})

test('no repository and no odd/tasks yields no output', () => {
  const dir = scratchDir('fs-norepo-')
  const r = run(dir)
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
})

test('no repository but an odd/tasks directory under cwd still works', () => {
  const dir = scratchDir('fs-plain-')
  write(dir, 'odd/tasks/a.md', doc({ rows: [['T1', 'plain task', 'pending']] }))
  assert.match(context(run(dir)), /plain task/)
})

test('a nested cwd inside the repository resolves to the root', () => {
  const repo = makeRepo()
  write(repo, 'odd/tasks/a.md', doc({ rows: [['T1', 'nested task', 'pending']] }))
  write(repo, 'src/deep/file.txt', 'x')
  const text = context(run(join(repo, 'src/deep')))
  assert.match(text, /odd\/tasks\/a\.md/)
  assert.match(text, /nested task/)
})

test('unparseable or empty input yields no output and exit 0', () => {
  for (const input of ['not json', '', '[]', 'null']) {
    const r = run(null, input)
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '')
  }
})

test('hooks.json registers the script on compact|resume in exec form', () => {
  const hooks = JSON.parse(readFileSync(HOOKS, 'utf8'))
  assert.deepEqual(hooks.modules, ['./register.js'])
  const entry = hooks.hooks.SessionStart.find((e) => e.hooks[0].args?.[0]?.endsWith('feature-state.mjs'))
  assert.ok(entry)
  assert.equal(entry.matcher, 'compact|resume')
  assert.equal(entry.hooks[0].type, 'command')
  assert.equal(entry.hooks[0].command, 'node')
  assert.deepEqual(entry.hooks[0].args, ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/feature-state.mjs'])
  assert.equal(entry.hooks[0].timeout, 10)
})

test('the script writes nothing: the tree and mtimes stay the same', () => {
  const repo = makeRepo()
  write(repo, 'odd/tasks/a.md', doc({ rows: [['T1', 'x', 'pending']] }))
  const snapshot = () => {
    const out = []
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.name === '.git') continue
        const p = join(d, e.name)
        if (e.isDirectory()) walk(p)
        else out.push(`${p}:${readFileSync(p, 'utf8').length}`)
      }
    }
    walk(repo)
    return out.sort()
  }
  const before = snapshot()
  const r = run(repo)
  assert.equal(r.stderr, '')
  assert.deepEqual(snapshot(), before)
  assert.equal(readFileSync(SCRIPT, 'utf8').includes('writeFile'), false)
})

test('an unescaped pipe in the task cell does not shift the status column', () => {
  const repo = makeRepo()
  write(repo, 'odd/tasks/pipe.md', doc({ rows: [['T1', 'use a|b', 'done'], ['T2', 'plain', 'pending']] }))
  const text = context(run(repo))
  assert.match(text, /T2 — plain/)
  assert.doesNotMatch(text, /T1/)
})
