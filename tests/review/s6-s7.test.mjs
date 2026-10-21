// gentle-v2-parity T3: S6 the RDD switch freezes lineage mutations, S7 frozen request context.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { captureAll, finding, highRepo, readTransaction, review, scratchDir, start } from './helpers.mjs'

const xdg = () => ({ XDG_CONFIG_HOME: scratchDir('odd-review-s6-xdg-') })
const off = (repo, env) => assert.equal(review(repo, ['mode', 'disable', '--scope', 'clone'], { env }).status, 0)

describe('S6: rdd_disabled', () => {
  const verbs = [
    ['capture', (l) => ['capture', '--lineage', l, '--lens', 'risk', '--input', '-']],
    ['capture-refuter', (l) => ['capture-refuter', '--lineage', l, '--input', '-']],
    ['capture-validation', (l) => ['capture-validation', '--lineage', l, '--input', '-']],
    ['capture-unachievable', (l) => ['capture-unachievable', '--lineage', l, '--lens', 'risk', '--reason', 'x']],
    ['correct', (l) => ['correct', '--lineage', l]],
    ['acknowledge', (l) => ['acknowledge', '--lineage', l]],
    ['abandon', (l) => ['abandon', '--lineage', l]],
    ['invalidate', (l) => ['invalidate', '--lineage', l, '--reason', 'x']],
  ]
  for (const [name, args] of verbs) {
    test(`${name} refuses and leaves the lineage untouched`, () => {
      const env = xdg()
      const repo = highRepo()
      const txn = start(repo)
      const before = JSON.stringify(readTransaction(repo, txn.lineage))
      off(repo, env)
      const r = review(repo, args(txn.lineage), { env, input: '{}' })
      assert.equal(r.status, 1)
      assert.equal(r.error.code, 'rdd_disabled')
      assert.equal(JSON.stringify(readTransaction(repo, txn.lineage)), before)
    })
  }

  test('start refuses and writes nothing; reads still work', () => {
    const env = xdg()
    const repo = highRepo()
    const txn = start(repo)
    off(repo, env)
    const r = review(repo, ['start', '--lenses', 'risk', '--lenses-reason', 'x'], { env })
    assert.equal([r.status, r.error.code].join(), '1,rdd_disabled')
    assert.equal(review(repo, ['status', '--lineage', txn.lineage], { env }).status, 0)
    assert.equal(review(repo, ['context', '--lineage', txn.lineage, '--lens', 'risk'], { env }).status, 0)
    assert.equal(review(repo, ['boundary'], { env }).status, 0)
    assert.equal(review(repo, ['validate', '--gate', 'pre-push'], { env }).status, 0)
    assert.equal(review(repo, ['mode', 'status'], { env }).json.mode, 'off')
  })

  test('enabling again lifts the freeze', () => {
    const env = xdg()
    const repo = highRepo()
    const txn = start(repo)
    off(repo, env)
    review(repo, ['mode', 'enable', '--scope', 'clone'], { env })
    assert.equal(review(repo, ['abandon', '--lineage', txn.lineage], { env }).status, 0)
  })
})

describe('S7: --request-context', () => {
  const specFile = (text) => {
    const file = join(scratchDir('odd-review-s7-'), 'spec.md')
    writeFileSync(file, text)
    return file
  }
  const text = 'S1 - login must reject empty passwords.\n'

  test('freezes text and sha256; context shows it to every lens before the patches', () => {
    const repo = highRepo()
    const txn = start(repo, { args: ['--request-context', specFile(text)] })
    const frozen = readTransaction(repo, txn.lineage).request_context
    assert.deepEqual(frozen, { text, sha256: createHash('sha256').update(text).digest('hex') })
    for (const lens of ['risk', 'reliability']) {
      const out = review(repo, ['context', '--lineage', txn.lineage, '--lens', lens]).stdout
      const at = out.indexOf('ODD_REVIEW_REQUEST_CONTEXT ')
      assert.ok(at > 0 && out.includes(`${text}ODD_REVIEW_REQUEST_CONTEXT_END`))
      assert.ok(at < out.indexOf('ODD_REVIEW_PATH '))
      assert.ok(out.includes(frozen.sha256))
    }
  })

  test('the frozen text also reaches the refuter context', () => {
    const repo = highRepo()
    const txn = start(repo, { args: ['--request-context', specFile(text)] })
    captureAll(repo, txn, { 'review-risk': [finding({ evidence_class: 'inferential' })] })
    assert.equal(readTransaction(repo, txn.lineage).state, 'refutation_required')
    assert.ok(review(repo, ['context', '--lineage', txn.lineage, '--lens', 'refuter']).stdout.includes(text))
  })

  test('over the cap, blank, and missing files are refused and start nothing', () => {
    const repo = highRepo()
    const big = review(repo, ['start', '--lenses', 'risk', '--lenses-reason', 'x', '--request-context', specFile('a'.repeat(32 * 1024 + 1))])
    assert.equal([big.status, big.error.code].join(), '1,request_context_too_large')
    const blank = review(repo, ['start', '--lenses', 'risk', '--lenses-reason', 'x', '--request-context', specFile('  \n')])
    assert.equal(blank.error.code, 'request_context_empty')
    const missing = review(repo, ['start', '--lenses', 'risk', '--lenses-reason', 'x', '--request-context', '/nonexistent/spec.md'])
    assert.equal(missing.error.code, 'request_context_unreadable')
    assert.equal(review(repo, ['start', '--lenses', 'risk', '--lenses-reason', 'x', '--request-context', specFile('a'.repeat(32 * 1024))]).status, 0)
  })

  test('without the flag the context has no request block and the transaction no field', () => {
    const repo = highRepo()
    const txn = start(repo)
    assert.equal('request_context' in readTransaction(repo, txn.lineage), false)
    assert.ok(!review(repo, ['context', '--lineage', txn.lineage, '--lens', 'risk']).stdout.includes('ODD_REVIEW_REQUEST_CONTEXT'))
  })
})
