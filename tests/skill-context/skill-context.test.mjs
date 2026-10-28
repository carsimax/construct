// S2 (T4): skill-context.mjs prints the real repository state a skill injects at load time.
// It always exits 0, prints at most 1,500 characters, and writes nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { commitAll, git, makeRepo, scratchDir, write } from '../helpers/repo.mjs'
import { subjectHash, writeOracle, writeVerdict } from '../../plugins/construct/hooks/scripts/review-store.mjs'

const SCRIPT = new URL('../../plugins/construct/hooks/scripts/skill-context.mjs', import.meta.url).pathname

const run = (cwd, ...args) => spawnSync('node', [SCRIPT, ...args], { cwd, encoding: 'utf8' })

const DOC = `# Feature

Branch: feat/x

## Tasks

| ID | Specs | Task | Risk | Status |
|---|---|---|---|---|
| T1 | S1 | Finished work | none | done |
| T2 | S1 | Open work | 2, 3 | pending |
`

// A feature branch with one commit adding the feature document and a 3-line file.
function featureRepo() {
  const repo = makeRepo()
  git(repo, 'checkout', '-q', '-b', 'feat/x')
  write(repo, '.vault/tasks/x.md', DOC)
  write(repo, 'src/a.txt', 'one\ntwo\nthree\n')
  commitAll(repo, 'feature')
  return repo
}

const tree = (repo, ref) => git(repo, 'rev-parse', `${ref}^{tree}`).trim()
const approve = (repo, lens) => {
  const base = tree(repo, 'main')
  const head = tree(repo, 'HEAD')
  writeVerdict(repo, { lens, subject_hash: subjectHash(base, head), base_tree: base, head_tree: head, approved: true, at: Date.now(), result: {} })
}

function listing(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true }).sort().map((name) => `${name}:${statSync(join(dir, name)).mtimeMs}:${statSync(join(dir, name)).isFile() ? readFileSync(join(dir, name), 'utf8') : ''}`)
}

test('workflow lists the short status and the unfinished tasks', () => {
  const repo = featureRepo()
  write(repo, 'src/dirty.txt', 'x\n')
  const r = run(repo, 'workflow')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /\?\? src\/dirty\.txt/)
  assert.match(r.stdout, /\.vault\/tasks\/x\.md/)
  assert.match(r.stdout, /T2 — Open work/)
  assert.doesNotMatch(r.stdout, /T1/)
})

test('workflow on a clean tree with no feature documents says so on both counts', () => {
  const r = run(makeRepo(), 'workflow')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /clean/i)
  assert.match(r.stdout, /no unfinished (tasks|feature)/i)
})

test('workflow bounds a long status and reports how many lines were cut', () => {
  const repo = makeRepo()
  for (let n = 0; n < 60; n++) write(repo, `f${n}.txt`, 'x\n')
  const r = run(repo, 'workflow')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /\(\+\d+ more\)/)
  assert.ok(r.stdout.length <= 1500)
})

test('review names the required lenses and which already approved HEAD', () => {
  const repo = featureRepo()
  approve(repo, 'review-risk')
  const r = run(repo, 'review')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /feat\/x/)
  assert.match(r.stdout, /review-risk: approved/)
  assert.match(r.stdout, /review-reliability: missing/)
  assert.doesNotMatch(r.stdout, /review-resilience/)
})

test('review reports a rejected lens and no requirement when the Risk cells are none', () => {
  const repo = featureRepo()
  const base = tree(repo, 'main')
  const head = tree(repo, 'HEAD')
  writeVerdict(repo, { lens: 'review-risk', subject_hash: subjectHash(base, head), approved: false, at: Date.now(), result: {} })
  assert.match(run(repo, 'review').stdout, /review-risk: rejected/)
  write(repo, '.vault/tasks/x.md', DOC.replace('2, 3', 'none'))
  commitAll(repo, 'lower risk')
  assert.match(run(repo, 'review').stdout, /no review required/i)
})

test('review shows the risk floor on a branch with no feature document', () => {
  const repo = makeRepo()
  git(repo, 'checkout', '-q', '-b', 'feat/x')
  write(repo, 'install.sh', '#!/bin/sh\n')
  commitAll(repo, 'installer')
  const out = run(repo, 'review').stdout
  assert.match(out, /Risk items 5 \(floor: item 5 from install\.sh\)/)
  assert.match(out, /review-resilience: missing/)
  assert.match(out, /review-risk: missing/)
})

// The skill reads the gate's own reviewState, so a range expands and a malformed cell fails as the gate would.
test('review shares the gate parser: ranges expand, a malformed Risk cell is unavailable', () => {
  const repo = featureRepo()
  write(repo, '.vault/tasks/x.md', DOC.replace('2, 3', '3-5'))
  commitAll(repo, 'range')
  const r = run(repo, 'review')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /Risk items 3, 4, 5;/)
  write(repo, '.vault/tasks/x.md', DOC.replace('2, 3', 'maybe'))
  commitAll(repo, 'malformed')
  const bad = run(repo, 'review')
  assert.equal(bad.status, 0)
  assert.match(bad.stdout, /^\(state unavailable: \.vault\/tasks\/x\.md has a Risk cell that is neither "none" nor names an item 1-6: "maybe"\)\n$/)
})

test('review leaves the review store byte-for-byte unchanged', () => {
  const repo = featureRepo()
  approve(repo, 'review-risk')
  const store = join(repo, '.git', 'construct-review')
  const before = listing(store)
  assert.ok(before.length > 0)
  run(repo, 'review')
  assert.deepEqual(listing(store), before)
  const bare = featureRepo()
  run(bare, 'review')
  assert.equal(existsSync(join(bare, '.git', 'construct-review')), false)
})

// A feature branch feat/x with sub-branches: t1 merged into it, t2 one commit ahead of it.
function subBranchRepo() {
  const repo = featureRepo()
  for (const n of [1, 2]) {
    git(repo, 'checkout', '-q', '-b', `feat/x-t${n}`, 'feat/x')
    write(repo, `src/t${n}.txt`, 'x\n')
    commitAll(repo, `t${n}`)
  }
  git(repo, 'checkout', '-q', 'feat/x')
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge t1', 'feat/x-t1')
  return repo
}

test('delivery on a feature branch prints it, no current sub-branch, and no sub-branches', () => {
  const r = run(featureRepo(), 'delivery')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /^Feature branch: feat\/x$/m)
  assert.match(r.stdout, /^Current sub-branch: none$/m)
  assert.match(r.stdout, /^Sub-branches \(feat\/x-t\*\): none$/m)
  assert.doesNotMatch(r.stdout, /Commit slice/)
})

test('delivery lists the sub-branches as merged or unmerged into the feature branch', () => {
  const r = run(subBranchRepo(), 'delivery')
  assert.match(r.stdout, /^Feature branch: feat\/x$/m)
  assert.match(r.stdout, /^- feat\/x-t1: merged$/m)
  assert.match(r.stdout, /^- feat\/x-t2: unmerged$/m)
})

test('delivery on a sub-branch names its feature branch and itself as current', () => {
  const repo = subBranchRepo()
  git(repo, 'checkout', '-q', 'feat/x-t2')
  const r = run(repo, 'delivery')
  assert.match(r.stdout, /^Feature branch: feat\/x$/m)
  assert.match(r.stdout, /^Current sub-branch: feat\/x-t2$/m)
  assert.match(r.stdout, /^- feat\/x-t1: merged$/m)
  assert.match(r.stdout, /^- feat\/x-t2: unmerged$/m)
})

test('delivery on the default branch says there is no feature branch', () => {
  const r = run(makeRepo(), 'delivery')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /default branch main.*no feature branch/i)
})

test('outside a repository every kind exits 0 with one unavailable line', () => {
  const dir = scratchDir('skill-context-')
  for (const kind of ['workflow', 'review', 'delivery']) {
    const r = run(dir, kind)
    assert.equal(r.status, 0, kind)
    assert.match(r.stdout, /^\(state unavailable: .+\)\n?$/, kind)
  }
})

test('an unknown or missing kind exits 0 with one unavailable line', () => {
  for (const args of [['bogus'], []]) {
    const r = run(makeRepo(), ...args)
    assert.equal(r.status, 0)
    assert.match(r.stdout, /^\(state unavailable: .+\)\n?$/)
  }
})

test('the output never exceeds 1,500 characters', () => {
  const repo = makeRepo()
  const rows = Array.from({ length: 80 }, (_, n) => `| T${n} | S1 | ${'long task text '.repeat(8)} | none | pending |`).join('\n')
  write(repo, '.vault/tasks/big.md', `# Big\n\n## Tasks\n\n| ID | Specs | Task | Risk | Status |\n|---|---|---|---|---|\n${rows}\n`)
  for (let n = 0; n < 200; n++) write(repo, `dir/${'n'.repeat(30)}${n}.txt`, 'x\n')
  for (let n = 0; n < 60; n++) git(repo, 'branch', `feat/x-t${'9'.repeat(40)}${n}`)
  git(repo, 'checkout', '-q', '-b', 'feat/x')
  for (const kind of ['workflow', 'review', 'delivery']) assert.ok(run(repo, kind).stdout.length <= 1500, kind)
})

// Judge B (8.2.0) W2-W4: the clip includes the newline, tasks come first and survive a long status,
// and a failed git status still prints the tasks.
const longDocs = (repo) => {
  for (const name of ['a', 'b', 'c']) {
    const rows = Array.from({ length: 12 }, (_, n) => `| T${n} | S1 | ${name} ${'long task text '.repeat(8)} | none | pending |`).join('\n')
    write(repo, `.vault/tasks/${name}.md`, `# ${name}\n\n## Tasks\n\n| ID | Specs | Task | Risk | Status |\n|---|---|---|---|---|\n${rows}\n`)
  }
}

test('a clipped output is at most 1,500 characters with its newline and says it was truncated', () => {
  const repo = makeRepo()
  longDocs(repo)
  const r = run(repo, 'workflow')
  assert.equal(r.status, 0)
  assert.ok(r.stdout.length <= 1500, String(r.stdout.length))
  assert.match(r.stdout, /\(truncated\)\n$/)
})

test('unfinished tasks come before the working tree, so a long status cannot push them out', () => {
  const repo = featureRepo()
  for (let n = 0; n < 60; n++) write(repo, `${'d'.repeat(90)}${n}.txt`, 'x\n')
  const r = run(repo, 'workflow')
  assert.equal(r.status, 0)
  assert.ok(r.stdout.indexOf('Unfinished tasks:') < r.stdout.indexOf('Working tree:'), r.stdout)
  assert.match(r.stdout, /T2 — Open work/)
})

test('a failed git status still prints the unfinished tasks', () => {
  const repo = featureRepo()
  writeFileSync(join(repo, '.git', 'index'), 'not an index')
  const r = run(repo, 'workflow')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /T2 — Open work/)
  assert.match(r.stdout, /Working tree: unavailable \(git status failed\)/)
})

// Judge A (8.2.0) A-002, A-003, A-006.
test('importing delivery-signals never runs its hook: a post or batch argument writes nothing', () => {
  const repo = featureRepo()
  const data = scratchDir('odd-skc-data-')
  const t = join(scratchDir('odd-skc-tr-'), 't.jsonl')
  writeFileSync(t, `${JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5-5', usage: { input_tokens: 200000, output_tokens: 1 } } })}\n`)
  for (const kind of ['batch', 'post']) {
    const r = spawnSync('node', [SCRIPT, kind], { cwd: repo, encoding: 'utf8', input: JSON.stringify({ hook_event_name: 'PostToolBatch', session_id: 'x', transcript_path: t }), env: { ...process.env, CLAUDE_PLUGIN_DATA: data } })
    assert.equal(r.status, 0)
    assert.equal(r.stdout, `(state unavailable: unknown kind "${kind}" (expected workflow, review, or delivery))\n`)
    assert.deepEqual(listing(data), [], kind)
  }
})

test('workflow takes no optional index lock: a stale index is left as it was', () => {
  const repo = featureRepo()
  const index = join(repo, '.git', 'index')
  const before = readFileSync(index)
  // Same content, newer mtime: a locking git status would refresh the stat cache and rewrite the index.
  write(repo, 'src/a.txt', 'one\ntwo\nthree\n')
  spawnSync('touch', ['-t', '203001010000', join(repo, 'src/a.txt')])
  assert.equal(run(repo, 'workflow').status, 0)
  assert.deepEqual(readFileSync(index), before)
})

test('review on the default branch with no remote-tracking branch says the state cannot be checked, as the gate does', () => {
  const repo = makeRepo()
  write(repo, '.vault/tasks/x.md', DOC)
  commitAll(repo, 'on main')
  const r = run(repo, 'review')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /main is the default branch and no remote-tracking default branch exists/)
  assert.doesNotMatch(r.stdout, /no review required/)
})

test('review lists the active oracle locks with up to three paths, and omits the line with none', () => {
  const repo = featureRepo()
  assert.doesNotMatch(run(repo, 'review').stdout, /Oracle locks/)
  for (const n of [1, 2, 3, 4]) writeOracle(repo, { path: `tests/t${n}.test.mjs`, blob: 'a'.repeat(40), feature: '.vault/tasks/x.md', task: 'T1', at: Date.now() })
  const r = run(repo, 'review')
  assert.equal(r.status, 0)
  // The store lists locks by hash of the path, so which three show is not fixed.
  assert.match(r.stdout, /^Oracle locks: 4 active \((tests\/t\d\.test\.mjs, ){3}\.\.\.\)$/m)
  assert.ok(r.stdout.length <= 1500)
})
