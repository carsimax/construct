// The RDD switch, the receipt commit fields, and the review boundary.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { atomicCreate, receiptPath } from '../../plugins/odd-skills/lib/review/store.mjs'
import {
  applyFiles, captureAll, commitAll, git, highRepo, receiptFiles, review, scratchDir, start, storeRoot,
} from './helpers.mjs'

const xdgEnv = () => ({ XDG_CONFIG_HOME: scratchDir('odd-review-mode-xdg-') })
const mode = (repo, env, ...args) => review(repo, ['mode', ...args], { env })

describe('mode switch', () => {
  test('the default is on and status writes nothing', () => {
    const env = xdgEnv()
    const r = mode(highRepo(), env, 'status')
    assert.equal(r.status, 0)
    assert.deepEqual([r.json.mode, r.json.source], ['on', 'default'])
    assert.deepEqual(readdirSync(env.XDG_CONFIG_HOME), [])
  })

  test('disable and enable default to the global scope and write atomically', () => {
    const env = xdgEnv()
    const repo = highRepo()
    const off = mode(repo, env, 'disable')
    assert.equal(off.status, 0)
    assert.deepEqual([off.json.mode, off.json.source, off.json.scope], ['off', 'global', 'global'])
    const file = join(env.XDG_CONFIG_HOME, 'odd-skills', 'rdd.json')
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { mode: 'off' })
    assert.deepEqual(readdirSync(join(env.XDG_CONFIG_HOME, 'odd-skills')), ['rdd.json'])
    assert.equal(mode(repo, env, 'status').json.mode, 'off')
    assert.deepEqual([mode(repo, env, 'enable').json.mode, mode(repo, env, 'status').json.source], ['on', 'global'])
  })

  test('the global file falls back to HOME/.config when XDG_CONFIG_HOME is empty', () => {
    const home = scratchDir('odd-review-home-')
    const repo = highRepo()
    mode(repo, { XDG_CONFIG_HOME: '', HOME: home }, 'disable')
    assert.ok(existsSync(join(home, '.config', 'odd-skills', 'rdd.json')))
  })

  test('the clone scope wins over the global one and lives under the common git directory', () => {
    const env = xdgEnv()
    const repo = highRepo()
    mode(repo, env, 'disable')
    const on = mode(repo, env, 'enable', '--scope', 'clone')
    assert.deepEqual([on.json.mode, on.json.source, on.json.scope], ['on', 'clone', 'clone'])
    assert.ok(existsSync(join(storeRoot(repo), 'mode.json')))
    assert.deepEqual([mode(repo, env, 'status').json.mode, mode(repo, env, 'status').json.source], ['on', 'clone'])
    assert.deepEqual(mode(highRepo(), env, 'status').json.source, 'global')
    mode(repo, env, 'disable', '--scope', 'clone')
    assert.equal(mode(repo, env, 'status').json.mode, 'off')
    assert.ok(!git(repo, 'status', '--porcelain', '-uall').includes('mode.json'))
  })

  test('an unreadable switch file is skipped, not trusted', () => {
    const env = xdgEnv()
    const repo = highRepo()
    mode(repo, env, 'disable')
    atomicCreate(join(storeRoot(repo), 'mode.json'), 'not json')
    assert.deepEqual([mode(repo, env, 'status').json.mode, mode(repo, env, 'status').json.source], ['off', 'global'])
  })

  test('usage errors', () => {
    const env = xdgEnv()
    const repo = highRepo()
    assert.equal(mode(repo, env).status, 2)
    assert.equal(mode(repo, env, 'toggle').status, 2)
    assert.equal(mode(repo, env, 'enable', '--scope', 'user').status, 2)
  })

  test('the global scope works outside a repository, the clone scope does not', () => {
    const env = xdgEnv()
    const dir = scratchDir('odd-review-norepo-')
    assert.equal(mode(dir, env, 'disable').status, 0)
    assert.equal(mode(dir, env, 'status').json.mode, 'off')
    const clone = mode(dir, env, 'enable', '--scope', 'clone')
    assert.equal(clone.status, 1)
    assert.equal(clone.error.code, 'not_a_repository')
  })
})

const reviewed = (repo, args = []) => {
  const txn = start(repo, { args })
  captureAll(repo, txn)
  assert.equal(review(repo, ['acknowledge', '--lineage', txn.lineage]).status, 0)
  return txn
}
const head = (repo) => git(repo, 'rev-parse', 'HEAD').trim()
const receiptOf = (repo) => JSON.parse(readFileSync(join(storeRoot(repo), 'receipts', receiptFiles(repo)[0]), 'utf8'))

describe('receipt commits', () => {
  test('a committed-mode receipt records the candidate and base commits', () => {
    const repo = highRepo()
    const base = head(repo)
    commitAll(repo, 'work')
    reviewed(repo, ['--base-ref', base, '--committed-only'])
    const receipt = receiptOf(repo)
    assert.equal(receipt.candidate_commit, head(repo))
    assert.equal(receipt.base_commit, base)
  })

  test('a working-tree receipt has no commit fields', () => {
    const repo = highRepo()
    reviewed(repo)
    const receipt = receiptOf(repo)
    assert.equal(receipt.candidate_commit, undefined)
    assert.equal(receipt.base_commit, undefined)
  })

  test('a corrected committed review records the commit that was corrected', () => {
    const repo = highRepo()
    const base = head(repo)
    commitAll(repo, 'work')
    const txn = start(repo, { args: ['--base-ref', base, '--committed-only'] })
    captureAll(repo, txn, { 'review-risk': [{ location: 'scripts/build.sh:1', severity: 'CRITICAL', claim: 'x', evidence_class: 'deterministic', causal_disposition: 'introduced', proof_refs: ['y'] }] })
    applyFiles(repo, { 'scripts/build.sh': 'echo safe\n' })
    commitAll(repo, 'fix')
    assert.equal(review(repo, ['correct', '--lineage', txn.lineage, '--base-ref', base]).status, 0)
    const id = JSON.parse(readFileSync(join(storeRoot(repo), 'transactions', `${txn.lineage}.json`), 'utf8')).to_correct[0].id
    const subject = JSON.parse(readFileSync(join(storeRoot(repo), 'transactions', `${txn.lineage}.json`), 'utf8')).correction.subject_hash
    review(repo, ['capture-validation', '--lineage', txn.lineage, '--input', '-'], {
      input: JSON.stringify({ subject_hash: subject, results: [{ finding_id: id, outcome: 'resolved', proof_refs: ['fixed'] }], regressions: [] }),
    })
    assert.equal(review(repo, ['acknowledge', '--lineage', txn.lineage]).status, 0)
    assert.equal(receiptOf(repo).candidate_commit, head(repo))
  })
})

describe('boundary', () => {
  const boundary = (repo) => review(repo, ['boundary'])

  test('with no receipt and no other branch it is the root commit', () => {
    const repo = highRepo()
    const root = head(repo)
    commitAll(repo, 'work')
    const r = boundary(repo)
    assert.equal(r.status, 0)
    assert.deepEqual(r.json, { commit: root, source: 'root' })
  })

  test('it is the merge-base with the default branch on a feature branch', () => {
    const repo = highRepo()
    const mainTip = head(repo)
    commitAll(repo, 'work')
    git(repo, 'checkout', '-q', '-b', 'feature')
    applyFiles(repo, { 'src/more.js': 'x\n' })
    commitAll(repo, 'more')
    assert.deepEqual(boundary(repo).json, { commit: git(repo, 'merge-base', 'HEAD', 'main').trim(), source: 'merge-base' })
    assert.notEqual(boundary(repo).json.commit, mainTip)
  })

  test('master is used when there is no main', () => {
    const repo = highRepo()
    commitAll(repo, 'work')
    git(repo, 'branch', '-m', 'main', 'master')
    git(repo, 'checkout', '-q', '-b', 'feature')
    applyFiles(repo, { 'src/more.js': 'x\n' })
    commitAll(repo, 'more')
    assert.deepEqual(boundary(repo).json, { commit: git(repo, 'merge-base', 'HEAD', 'master').trim(), source: 'merge-base' })
  })

  test('the newest receipt whose candidate commit is an ancestor of HEAD wins', () => {
    const repo = highRepo()
    const base = head(repo)
    commitAll(repo, 'work')
    reviewed(repo, ['--base-ref', base, '--committed-only'])
    const reviewedCommit = head(repo)
    applyFiles(repo, { 'src/more.js': 'x\n' })
    commitAll(repo, 'more')
    assert.deepEqual(boundary(repo).json, { commit: reviewedCommit, source: 'receipt' })
  })

  test('a receipt for a commit that is not an ancestor of HEAD is ignored', () => {
    const repo = highRepo()
    const root = head(repo)
    git(repo, 'checkout', '-q', '-b', 'other')
    applyFiles(repo, { 'src/other.js': 'x\n' })
    commitAll(repo, 'other')
    const stray = head(repo)
    git(repo, 'checkout', '-q', 'main')
    atomicCreate(receiptPath(repo, 'sha256:' + 'a'.repeat(64)), `${JSON.stringify({ lineage: 'review-0123456789abcdef', candidate_commit: stray, acknowledged_at: '2026-01-01T00:00:00Z' })}\n`)
    applyFiles(repo, { 'src/main.js': 'x\n' })
    commitAll(repo, 'main work')
    assert.deepEqual(boundary(repo).json, { commit: root, source: 'root' })
  })

  test('receipts without commit fields (older receipts) are valid and ignored by boundary', () => {
    const repo = highRepo()
    const root = head(repo)
    reviewed(repo)
    commitAll(repo, 'work')
    assert.deepEqual(boundary(repo).json, { commit: root, source: 'root' })
  })

  test('a repository without commits has no boundary', () => {
    const dir = scratchDir('odd-review-empty-')
    git(dir, 'init', '-q', '-b', 'main')
    const r = boundary(dir)
    assert.equal(r.status, 1)
    assert.equal(r.error.code, 'no_commits')
  })
})

