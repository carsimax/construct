// S2 (T4): skill-context.mjs prints the real repository state a skill injects at load time.
// It always exits 0, prints at most 1,500 characters, and writes nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { commitAll, git, makeRepo, scratchDir, write } from '../helpers/repo.mjs'
import { subjectHash, writeVerdict } from '../../plugins/construct/hooks/scripts/review-store.mjs'

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
  write(repo, 'odd/tasks/x.md', DOC)
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
  assert.match(r.stdout, /odd\/tasks\/x\.md/)
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
  write(repo, 'odd/tasks/x.md', DOC.replace('2, 3', 'none'))
  commitAll(repo, 'lower risk')
  assert.match(run(repo, 'review').stdout, /no review required/i)
})

// The skill reads the gate's own reviewState, so a range expands and a malformed cell fails as the gate would.
test('review shares the gate parser: ranges expand, a malformed Risk cell is unavailable', () => {
  const repo = featureRepo()
  write(repo, 'odd/tasks/x.md', DOC.replace('2, 3', '3-5'))
  commitAll(repo, 'range')
  const r = run(repo, 'review')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /Risk items 3, 4, 5;/)
  write(repo, 'odd/tasks/x.md', DOC.replace('2, 3', 'maybe'))
  commitAll(repo, 'malformed')
  const bad = run(repo, 'review')
  assert.equal(bad.status, 0)
  assert.match(bad.stdout, /^\(state unavailable: odd\/tasks\/x\.md has a Risk cell that is neither "none" nor names an item 1-6: "maybe"\)\n$/)
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

test('delivery reports the authored changed lines against the default branch', () => {
  const r = run(featureRepo(), 'delivery')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /Commit slice: \d+ authored changed lines in 1 commit on feat\/x since main/)
})

test('delivery on the default branch says there is no slice', () => {
  const r = run(makeRepo(), 'delivery')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /no commits ahead of the default branch/i)
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
  write(repo, 'odd/tasks/big.md', `# Big\n\n## Tasks\n\n| ID | Specs | Task | Risk | Status |\n|---|---|---|---|---|\n${rows}\n`)
  for (let n = 0; n < 200; n++) write(repo, `dir/${'n'.repeat(30)}${n}.txt`, 'x\n')
  for (const kind of ['workflow', 'review', 'delivery']) assert.ok(run(repo, kind).stdout.length <= 1500, kind)
})
