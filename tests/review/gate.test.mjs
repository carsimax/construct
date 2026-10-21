// S6: odd-review validate --gate pre-push|pre-pr|release against real repositories.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { applyFiles, captureAll, commitAll, git, highRepo, makeRepo, receiptFiles, review, scratchDir, start, transactionFile } from './helpers.mjs'

const env = () => ({ XDG_CONFIG_HOME: scratchDir('odd-gate-xdg-') })

// featureRepo: main holds the base commit; branch feat adds one committed high-risk unit.
function featureRepo() {
  const repo = highRepo()
  git(repo, 'checkout', '-q', '-b', 'feat')
  commitAll(repo, 'high-risk unit')
  return repo
}

function approve(repo) {
  const txn = start(repo, { args: ['--base-ref', 'main', '--committed-only'] })
  captureAll(repo, txn)
  assert.equal(review(repo, ['acknowledge', '--lineage', txn.lineage]).status, 0)
  return txn
}

const gate = (repo, name, extra = [], e = env()) => review(repo, ['validate', '--gate', name, ...extra], { env: e })

describe('validate --gate: a review-due range without a receipt', () => {
  for (const name of ['pre-push', 'pre-pr', 'release']) {
    test(`${name} fails with a JSON reason`, () => {
      const repo = featureRepo()
      const r = gate(repo, name)
      assert.equal(r.status, 1)
      assert.equal(r.error.code, 'review_required')
      assert.match(r.error.message, new RegExp(name))
      assert.equal(r.error.gate, name)
      assert.equal(r.error.receipt, 'none')
      assert.match(r.error.target, /^sha256:/)
      assert.match(r.error.message, /odd-review start/)
    })
  }

  test('uncommitted changes are not part of the published range', () => {
    const repo = makeRepo({ 'src/app.js': 'export const a = 1\n' })
    git(repo, 'checkout', '-q', '-b', 'feat')
    applyFiles(repo, { 'scripts/build.sh': 'echo hi\n' })
    const r = gate(repo, 'pre-push', ['--base-ref', 'main'])
    assert.equal(r.status, 0)
    assert.equal(r.json.reason, 'empty')
  })
})

describe('validate --gate: exits 0 with ok', () => {
  test('RDD off', () => {
    const repo = featureRepo()
    const e = env()
    review(repo, ['mode', 'disable'], { env: e })
    const r = gate(repo, 'pre-push', [], e)
    assert.equal(r.status, 0)
    assert.equal(r.json.result, 'ok')
    assert.equal(r.json.reason, 'rdd_off')
  })

  test('nothing is due: a passive change', () => {
    const repo = makeRepo({ 'src/app.js': 'export const a = 1\n' })
    git(repo, 'checkout', '-q', '-b', 'feat')
    applyFiles(repo, { 'docs/note.md': 'a note\n' })
    commitAll(repo, 'docs')
    const r = gate(repo, 'pre-pr')
    assert.equal(r.status, 0)
    assert.equal(r.json.ok, true)
    assert.equal(r.json.reason, 'not_due')
  })

  test('a receipt for the published tree covers it', () => {
    const repo = featureRepo()
    approve(repo)
    const r = gate(repo, 'pre-push')
    assert.equal(r.status, 0)
    assert.equal(r.json.reason, 'covered')
    assert.equal(r.json.receipt, 'ok')
  })

  test('work after the receipt is judged on its own range, so a passive commit passes', () => {
    const repo = featureRepo()
    approve(repo)
    applyFiles(repo, { 'docs/after.md': 'after\n' })
    commitAll(repo, 'docs after review')
    assert.equal(gate(repo, 'pre-push').json.reason, 'not_due')
  })

  test('the default branch itself has no base to publish against', () => {
    const repo = makeRepo({ 'src/app.js': 'export const a = 1\n' })
    applyFiles(repo, { 'scripts/build.sh': 'echo hi\n' })
    commitAll(repo, 'on main')
    const r = gate(repo, 'pre-push')
    assert.equal(r.status, 0)
    assert.equal(r.json.reason, 'no_base')
  })
})

describe('validate --gate: a receipt that does not cover the tree', () => {
  test('a commit after the receipt that is high risk again is not covered', () => {
    const repo = featureRepo()
    approve(repo)
    applyFiles(repo, { 'scripts/deploy.sh': 'echo deploy\n' })
    commitAll(repo, 'second unit')
    const r = gate(repo, 'pre-push')
    assert.equal(r.status, 1)
    assert.equal(r.error.code, 'review_required')
  })

  test('a transaction changed after the receipt makes it stale', () => {
    const repo = featureRepo()
    const txn = approve(repo)
    const file = transactionFile(repo, txn.lineage)
    const data = JSON.parse(readFileSync(file, 'utf8'))
    data.findings = [{ id: 'F9', tampered: true }]
    writeFileSync(file, JSON.stringify(data))
    const r = gate(repo, 'pre-push')
    assert.equal(r.status, 1)
    assert.equal(r.error.receipt, 'mismatch')
    assert.match(r.error.message, /ledger_hash/)
  })

  test('a receipt whose transaction is gone is stale', () => {
    const repo = featureRepo()
    const txn = approve(repo)
    git(repo, 'rev-parse', 'HEAD')
    writeFileSync(transactionFile(repo, txn.lineage), 'not json')
    const r = gate(repo, 'pre-push')
    assert.equal(r.status, 1)
    assert.equal(r.error.receipt, 'unreadable')
  })

  test('an abandoned review leaves no receipt, so the gate still fails', () => {
    const repo = featureRepo()
    const txn = start(repo, { args: ['--base-ref', 'main', '--committed-only'] })
    review(repo, ['abandon', '--lineage', txn.lineage])
    assert.deepEqual(receiptFiles(repo), [])
    assert.equal(gate(repo, 'pre-push').status, 1)
  })
})

describe('validate --gate: how the published range is derived', () => {
  test('pre-push uses the upstream branch as the base', () => {
    const repo = makeRepo({ 'src/app.js': 'export const a = 1\n' })
    const remote = scratchDir('odd-gate-remote-')
    git(remote, 'init', '-q', '--bare', '-b', 'main')
    git(repo, 'remote', 'add', 'origin', remote)
    git(repo, 'push', '-q', '-u', 'origin', 'main')
    applyFiles(repo, { 'scripts/build.sh': 'echo hi\n' })
    commitAll(repo, 'unpublished high-risk unit')
    const r = gate(repo, 'pre-push')
    assert.equal(r.status, 1)
    assert.equal(r.error.base, git(repo, 'rev-parse', 'origin/main').trim())
  })

  test('--base-ref and --head-ref choose the range', () => {
    const repo = featureRepo()
    git(repo, 'branch', 'other')
    const r = gate(repo, 'pre-push', ['--base-ref', 'main', '--head-ref', 'other'])
    assert.equal(r.status, 1)
    assert.equal(r.error.head, git(repo, 'rev-parse', 'other').trim())
  })

  test('release starts at the nearest earlier tag and skips the tag being created', () => {
    const repo = makeRepo({ 'src/app.js': 'export const a = 1\n' })
    git(repo, 'tag', 'v1.0.0')
    applyFiles(repo, { 'docs/note.md': 'a note\n' })
    commitAll(repo, 'docs only')
    git(repo, 'tag', 'v1.1.0')
    const r = gate(repo, 'release', ['--tag', 'v1.1.0'])
    assert.equal(r.status, 0)
    assert.equal(r.json.reason, 'not_due')
    assert.equal(r.json.base, git(repo, 'rev-parse', 'v1.0.0').trim())
  })

  test('an unresolvable --base-ref is an error, never an allow', () => {
    const repo = featureRepo()
    const r = gate(repo, 'pre-push', ['--base-ref', 'no-such-ref'])
    assert.equal(r.status, 1)
    assert.equal(r.error.code, 'bad_ref')
  })

  test('outside a repository the gate refuses with not_a_repository', () => {
    const r = review(scratchDir('odd-gate-norepo-'), ['validate', '--gate', 'pre-push'], { env: env() })
    assert.equal(r.status, 1)
    assert.equal(r.error.code, 'not_a_repository')
  })
})

describe('validate --gate: usage', () => {
  test('--gate is required and must be a publication gate', () => {
    const repo = featureRepo()
    for (const args of [['validate'], ['validate', '--gate', 'pre-commit'], ['validate', '--gate', 'post-apply']]) {
      const r = review(repo, args)
      assert.equal(r.status, 2, args.join(' '))
      assert.match(r.stderr, /pre-push|--gate/)
    }
  })

  test('--gate does not apply to other commands, and the help names validate', () => {
    const repo = featureRepo()
    assert.equal(review(repo, ['status', '--lineage', 'review-0000000000000000', '--gate', 'pre-push']).status, 2)
    assert.match(review(repo, ['--help']).stdout, /validate --gate pre-push\|pre-pr\|release/)
  })
})

describe('regression: earlier commands behave as before', () => {
  test('mode and boundary still work', () => {
    const repo = featureRepo()
    assert.equal(review(repo, ['mode', 'status'], { env: env() }).json.mode, 'on')
    assert.equal(review(repo, ['boundary']).status, 0)
  })
})
