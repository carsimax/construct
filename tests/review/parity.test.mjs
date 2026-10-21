// S5 of gentle-parity: one-shot counters, the correction budget floor, receipt
// hashes and their check in status, the abandon, invalidate, and
// capture-unachievable verbs, and the focus lens of a medium candidate.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { openLineageTargets } from '../../plugins/construct/lib/review/store.mjs'
import {
  applyFiles, assessJson, captureAll, finding, highRepo, makeRepo, readTransaction, receiptFiles, refuterSubject, review, start,
  storeRoot, transactionFile,
} from './helpers.mjs'

const ack = (repo, txn) => review(repo, ['acknowledge', '--lineage', txn.lineage])
const SHA = /^sha256:[0-9a-f]{64}$/
const EMPTY = `sha256:${createHash('sha256').update('').digest('hex')}`
const receiptOf = (repo) => {
  const file = join(storeRoot(repo), 'receipts', receiptFiles(repo)[0])
  return { file, receipt: JSON.parse(readFileSync(file, 'utf8')) }
}
const validate = (repo, txn, id) =>
  review(repo, ['capture-validation', '--lineage', txn.lineage, '--input', '-'], {
    input: JSON.stringify({
      subject_hash: readTransaction(repo, txn.lineage).correction.subject_hash,
      results: [{ finding_id: id, outcome: 'resolved', proof_refs: ['fixed'] }],
      regressions: [],
    }),
  })

// corrected walks one lineage through correction and an approved validation.
function corrected() {
  const repo = highRepo()
  const txn = start(repo)
  captureAll(repo, txn, { 'review-risk': [finding()] })
  const id = readTransaction(repo, txn.lineage).to_correct[0].id
  applyFiles(repo, { 'scripts/build.sh': 'echo safe\n' })
  assert.equal(review(repo, ['correct', '--lineage', txn.lineage]).status, 0)
  assert.equal(validate(repo, txn, id).json.state, 'approved')
  return { repo, txn }
}

describe('one-shot counters', () => {
  test('a new transaction starts every counter at zero', () => {
    const txn = start(highRepo())
    assert.deepEqual(txn.counters, { full_reviews: 0, refuter_batches: 0, fix_batches: 0, scoped_fix_validations: 0, final_verifications: 0 })
  })

  test('each command spends its own counter once; final_verifications has no analogue and stays 0', () => {
    const repo = highRepo()
    const txn = start(repo, { lenses: 'risk' })
    const f2 = finding({ evidence_class: 'inferential', location: 'docs/the guide.md:2' })
    const reduced = captureAll(repo, txn, { 'review-risk': [finding(), f2] })
    assert.equal(reduced.counters.full_reviews, 1)
    assert.equal(reduced.state, 'refutation_required')
    const refuted = review(repo, ['capture-refuter', '--lineage', txn.lineage, '--input', '-'], {
      input: JSON.stringify({
        subject_hash: refuterSubject(repo, txn),
        results: [{ finding_id: 'F2', outcome: 'refuted', proof_refs: ['not reachable'] }],
      }),
    })
    assert.equal(refuted.status, 0, refuted.stderr)
    assert.equal(refuted.json.counters.refuter_batches, 1)
    applyFiles(repo, { 'scripts/build.sh': 'echo safe\n' })
    const fixed = review(repo, ['correct', '--lineage', txn.lineage])
    assert.equal(fixed.json.counters.fix_batches, 1)
    const done = validate(repo, txn, 'F1')
    assert.deepEqual(done.json.counters, { full_reviews: 1, refuter_batches: 1, fix_batches: 1, scoped_fix_validations: 1, final_verifications: 0 })
    assert.deepEqual(readTransaction(repo, txn.lineage).counters, done.json.counters)
    assert.deepEqual(review(repo, ['status', '--lineage', txn.lineage]).json.counters, done.json.counters)
  })

  test('a second fix batch makes the transaction terminal escalated and records which counter', () => {
    const repo = highRepo()
    const txn = start(repo)
    captureAll(repo, txn, { 'review-risk': [finding()] })
    applyFiles(repo, { 'scripts/build.sh': 'echo safe\n' })
    assert.equal(review(repo, ['correct', '--lineage', txn.lineage]).status, 0)
    applyFiles(repo, { 'scripts/build.sh': 'echo safer\n' })
    const second = review(repo, ['correct', '--lineage', txn.lineage])
    assert.equal(second.status, 0, second.stderr)
    assert.equal(second.json.state, 'escalated')
    assert.equal(second.json.reason, 'budget_exhausted')
    assert.equal(second.json.counter, 'fix_batches')
    assert.deepEqual(second.json.next, [])
    assert.equal(second.json.counters.fix_batches, 1)
    assert.equal(readTransaction(repo, txn.lineage).state, 'escalated')
    assert.equal(ack(repo, txn).error.code, 'not_approved')
    assert.equal(review(repo, ['correct', '--lineage', txn.lineage]).error.code, 'wrong_state')
  })

  test('a refused correction (over budget) does not spend the fix counter', () => {
    const repo = highRepo()
    const txn = start(repo)
    captureAll(repo, txn, { 'review-risk': [finding()] })
    applyFiles(repo, { 'src/big.js': Array.from({ length: 400 }, (_, i) => `x${i}\n`).join('') })
    assert.equal(review(repo, ['correct', '--lineage', txn.lineage]).error.code, 'correction_budget_exceeded')
    assert.equal(readTransaction(repo, txn.lineage).counters.fix_batches, 0)
  })

  test('a transaction written before the counters existed reads as zeros', () => {
    const repo = highRepo()
    const txn = start(repo)
    const file = transactionFile(repo, txn.lineage)
    const stored = JSON.parse(readFileSync(file, 'utf8'))
    delete stored.counters
    writeFileSync(file, JSON.stringify(stored))
    assert.equal(review(repo, ['status', '--lineage', txn.lineage]).json.counters.full_reviews, 0)
    assert.equal(captureAll(repo, txn).counters.full_reviews, 1)
  })
})

describe('correction budget floor', () => {
  test('a one-line candidate has a budget of 2, enough for one line replacement', () => {
    const repo = makeRepo({ 'src/app.js': 'export const a = 1\n' })
    applyFiles(repo, { 'src/one.js': 'export const b = 1\n' })
    const txn = start(repo, { lenses: 'risk' })
    assert.equal(txn.changed_lines, 1)
    const reduced = captureAll(repo, txn, { 'review-risk': [finding({ location: 'src/one.js:1' })] })
    assert.deepEqual(reduced.correction_budget, { max_changed_lines: 2 })
    applyFiles(repo, { 'src/one.js': 'export const b = 2\n' })
    const fixed = review(repo, ['correct', '--lineage', txn.lineage])
    assert.equal(fixed.status, 0, fixed.stderr)
    assert.deepEqual(fixed.json.correction_budget, { max_changed_lines: 2 })
  })

  test('larger candidates keep min(200, ceil(lines/2))', () => {
    const repo = highRepo()
    const txn = start(repo)
    assert.equal(txn.changed_lines, 21)
    assert.equal(captureAll(repo, txn, { 'review-risk': [finding()] }).correction_budget.max_changed_lines, 11)
  })
})

describe('receipt hashes', () => {
  test('the receipt carries a paths digest and policy, ledger, evidence, and fix delta hashes', () => {
    const { repo, txn } = corrected()
    assert.equal(ack(repo, txn).status, 0)
    const { receipt } = receiptOf(repo)
    for (const key of ['paths_digest', 'policy_hash', 'ledger_hash', 'evidence_hash', 'fix_delta_hash']) assert.match(receipt[key], SHA, key)
    assert.notEqual(receipt.fix_delta_hash, EMPTY)
    assert.equal(receipt.schema, 'construct.review-receipt/v1')
    assert.deepEqual(receipt.counters.fix_batches, 1)
  })

  test('a review without a correction records the empty fix delta hash', () => {
    const repo = highRepo()
    const txn = start(repo)
    captureAll(repo, txn)
    ack(repo, txn)
    assert.equal(receiptOf(repo).receipt.fix_delta_hash, EMPTY)
  })

  test('status reports an intact receipt as ok', () => {
    const { repo, txn } = corrected()
    ack(repo, txn)
    const out = review(repo, ['status', '--lineage', txn.lineage])
    assert.equal(out.status, 0)
    assert.equal(out.json.receipt_check.status, 'ok')
    assert.deepEqual(out.json.receipt_check.mismatched, [])
  })

  test('status reports every hash that no longer matches', () => {
    const { repo, txn } = corrected()
    ack(repo, txn)
    const { file, receipt } = receiptOf(repo)
    receipt.ledger_hash = `sha256:${'0'.repeat(64)}`
    receipt.paths_digest = `sha256:${'1'.repeat(64)}`
    writeFileSync(file, JSON.stringify(receipt))
    const out = review(repo, ['status', '--lineage', txn.lineage])
    assert.equal(out.status, 0)
    assert.equal(out.json.receipt_check.status, 'mismatch')
    assert.deepEqual(out.json.receipt_check.mismatched, ['paths_digest', 'ledger_hash'])
  })

  test('status notices a transaction ledger edited after the receipt', () => {
    const { repo, txn } = corrected()
    ack(repo, txn)
    const file = transactionFile(repo, txn.lineage)
    const stored = JSON.parse(readFileSync(file, 'utf8'))
    stored.findings[0].claim = 'edited afterwards'
    writeFileSync(file, JSON.stringify(stored))
    assert.deepEqual(review(repo, ['status', '--lineage', txn.lineage]).json.receipt_check.mismatched, ['ledger_hash'])
  })

  test('status reports a missing receipt and a receipt without hashes', () => {
    const { repo, txn } = corrected()
    ack(repo, txn)
    const { file, receipt } = receiptOf(repo)
    for (const key of ['paths_digest', 'policy_hash', 'ledger_hash', 'evidence_hash', 'fix_delta_hash']) delete receipt[key]
    writeFileSync(file, JSON.stringify(receipt))
    assert.equal(review(repo, ['status', '--lineage', txn.lineage]).json.receipt_check.status, 'legacy')
    writeFileSync(file, '{')
    assert.equal(review(repo, ['status', '--lineage', txn.lineage]).json.receipt_check.status, 'unreadable')
  })

  test('status of an unfinished transaction has no receipt_check', () => {
    const repo = highRepo()
    const txn = start(repo)
    assert.equal('receipt_check' in review(repo, ['status', '--lineage', txn.lineage]).json, false)
  })
})

describe('abandon', () => {
  test('an open transaction becomes terminal abandoned and no longer counts as open', () => {
    const repo = highRepo()
    const txn = start(repo)
    assert.ok(openLineageTargets(repo).has(txn.target))
    const out = review(repo, ['abandon', '--lineage', txn.lineage, '--reason', 'the user dropped the change'])
    assert.equal(out.status, 0, out.stderr)
    assert.equal(out.json.state, 'abandoned')
    assert.equal(out.json.reason, 'the user dropped the change')
    assert.deepEqual(out.json.next, [])
    assert.equal(readTransaction(repo, txn.lineage).state, 'abandoned')
    assert.ok(!openLineageTargets(repo).has(txn.target))
    assert.equal(ack(repo, txn).error.code, 'not_approved')
    assert.equal(receiptFiles(repo).length, 0)
  })

  test('abandon works mid-review, and the reason is optional', () => {
    const repo = highRepo()
    const txn = start(repo)
    captureAll(repo, txn, { 'review-risk': [finding()] })
    assert.equal(review(repo, ['abandon', '--lineage', txn.lineage]).json.state, 'abandoned')
  })

  test('a terminal transaction cannot be abandoned', () => {
    const repo = highRepo()
    const txn = start(repo)
    captureAll(repo, txn)
    ack(repo, txn)
    assert.equal(review(repo, ['abandon', '--lineage', txn.lineage]).error.code, 'wrong_state')
  })
})

describe('invalidate', () => {
  test('a pristine transaction becomes terminal invalidated; --reason is required', () => {
    const repo = highRepo()
    const txn = start(repo)
    const usage = review(repo, ['invalidate', '--lineage', txn.lineage])
    assert.equal(usage.status, 2)
    const out = review(repo, ['invalidate', '--lineage', txn.lineage, '--reason', 'the candidate changed before any lens ran'])
    assert.equal(out.status, 0, out.stderr)
    assert.equal(out.json.state, 'invalidated')
    assert.deepEqual(out.json.next, [])
    assert.ok(!openLineageTargets(repo).has(txn.target))
    assert.equal(review(repo, ['invalidate', '--lineage', txn.lineage, '--reason', 'again']).error.code, 'wrong_state')
  })

  test('a transaction with a captured lens is not pristine; use abandon', () => {
    const repo = highRepo()
    const txn = start(repo)
    captureAll(repo, { ...txn, lenses: [txn.lenses[0]] })
    const out = review(repo, ['invalidate', '--lineage', txn.lineage, '--reason', 'too late'])
    assert.equal(out.status, 1)
    assert.equal(out.error.code, 'not_pristine')
    assert.equal(readTransaction(repo, txn.lineage).state, 'collecting')
  })
})

describe('capture-unachievable', () => {
  const run = (repo, txn, lens, reason = 'the lens agent could not be launched') =>
    review(repo, ['capture-unachievable', '--lineage', txn.lineage, '--lens', lens, ...(reason === null ? [] : ['--reason', reason])])

  test('a selected lens that cannot run escalates the transaction to a human decision', () => {
    const repo = highRepo()
    const txn = start(repo, { lenses: 'risk,resilience' })
    const out = run(repo, txn, 'resilience')
    assert.equal(out.status, 0, out.stderr)
    assert.equal(out.json.state, 'escalated')
    assert.equal(out.json.reason, 'lens_unachievable')
    assert.deepEqual(out.json.unachievable_lenses, ['review-resilience'])
    assert.deepEqual(out.json.next, [])
    assert.equal(readTransaction(repo, txn.lineage).unachievable['review-resilience'].reason, 'the lens agent could not be launched')
    assert.equal(ack(repo, txn).error.code, 'not_approved')
  })

  test('requires --lens and --reason; refuses an unselected or captured lens and a wrong state', () => {
    const repo = highRepo()
    const txn = start(repo, { lenses: 'risk,reliability' })
    assert.equal(run(repo, txn, 'risk', null).status, 2)
    assert.equal(run(repo, txn, 'resilience').error.code, 'lens_not_selected')
    captureAll(repo, { ...txn, lenses: ['review-risk'] })
    assert.equal(run(repo, txn, 'risk').error.code, 'lens_already_captured')
    assert.equal(run(repo, txn, 'reliability').json.state, 'escalated')
    assert.equal(run(repo, txn, 'reliability').error.code, 'wrong_state')
  })
})

describe('focus lens of a medium candidate', () => {
  const mediumRepo = () => {
    const repo = makeRepo({ 'src/app.js': 'export const a = 1\n' })
    applyFiles(repo, { 'src/app.js': 'export const a = 2\n' })
    return repo
  }

  test('start --focus gives a medium candidate exactly that one lens', () => {
    const repo = mediumRepo()
    assert.equal(assessJson(repo).json.risk, 'medium')
    const out = review(repo, ['start', '--focus', 'resilience'])
    assert.equal(out.status, 0, out.stderr)
    assert.equal(out.json.risk, 'medium')
    assert.deepEqual(out.json.lenses, ['review-resilience'])
    assert.match(out.json.lenses_reason, /^odd-assess: medium risk, focus resilience$/)
    assert.deepEqual(Object.keys(out.json.subjects), ['review-resilience'])
  })

  test('the canonical name works; an unknown focus, --focus with --lenses are usage errors', () => {
    const repo = mediumRepo()
    assert.deepEqual(review(repo, ['start', '--focus', 'review-risk']).json.lenses, ['review-risk'])
    assert.equal(review(repo, ['start', '--focus', 'speed']).status, 2)
    assert.equal(review(repo, ['start', '--focus', 'risk', '--lenses', 'risk', '--lenses-reason', 'x']).status, 2)
  })

  test('without --focus a medium candidate still refuses with lenses_required and names --focus', () => {
    const out = review(mediumRepo(), ['start'])
    assert.equal(out.error.code, 'lenses_required')
    assert.match(out.error.message, /--focus/)
    assert.match(out.error.message, /--lenses/)
  })

  test('a high candidate ignores --focus and keeps all four lenses; explicit --lenses is unchanged', () => {
    const repo = highRepo()
    assert.equal(review(repo, ['start', '--focus', 'risk']).json.lenses.length, 4)
    assert.deepEqual(start(repo, { lenses: 'risk,reliability' }).lenses, ['review-risk', 'review-reliability'])
  })
})
