// gentle-v2-parity T2: S2 refuter inconclusive, S3 vocabulary and reduction,
// S4 finding admission, S5 validator retries. Each runs the real CLI.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { applyFiles, capture, captureAll, finding, highRepo, lensResult, readTransaction, refuterSubject, review, start } from './helpers.mjs'

const refuter = (repo, txn, outcome) => {
  const id = readTransaction(repo, txn.lineage).refutation_batch[0].id
  return review(repo, ['capture-refuter', '--lineage', txn.lineage, '--input', '-'], {
    input: JSON.stringify({ subject_hash: refuterSubject(repo, txn), results: [{ finding_id: id, outcome, proof_refs: ['x'] }] }),
  })
}

describe('S2: refuter inconclusive joins the correction set', () => {
  const inferential = finding({ evidence_class: 'inferential' })
  test('inconclusive goes to correction, not advisory', () => {
    const repo = highRepo()
    const txn = start(repo)
    captureAll(repo, txn, { 'review-risk': [inferential] })
    const { json } = refuter(repo, txn, 'inconclusive')
    assert.equal(json.state, 'correction_required')
    assert.deepEqual(json.to_correct.map((f) => f.id), ['F1'])
    assert.equal(readTransaction(repo, txn.lineage).advisory.length, 0)
  })
  test('refuted stays advisory', () => {
    const repo = highRepo()
    const txn = start(repo)
    captureAll(repo, txn, { 'review-risk': [inferential] })
    const { json } = refuter(repo, txn, 'refuted')
    assert.equal(json.state, 'approved')
    assert.equal(readTransaction(repo, txn.lineage).advisory[0].refuter_outcome, 'refuted')
  })
})

describe('S3: causality and evidence vocabulary', () => {
  for (const causal of ['introduced', 'behavior-activated', 'worsened']) {
    test(`${causal} is candidate-caused`, () => {
      const repo = highRepo()
      const txn = start(repo, { lenses: 'risk' })
      const reduced = captureAll(repo, txn, { 'review-risk': [finding({ causal_disposition: causal })] })
      assert.equal(reduced.state, 'correction_required')
    })
  }
  test('a severe insufficient finding escalates as inconclusive, never confirmed', () => {
    const repo = highRepo()
    const txn = start(repo, { lenses: 'risk' })
    const reduced = captureAll(repo, txn, { 'review-risk': [finding({ evidence_class: 'insufficient' })] })
    assert.equal(reduced.state, 'escalated')
    assert.equal(reduced.reason, 'insufficient_evidence')
    assert.deepEqual(reduced.finding_ids, ['F1'])
  })
  test('mixed unknown and insufficient severe findings keep reason and ids consistent', () => {
    const repo = highRepo()
    const txn = start(repo, { lenses: 'risk' })
    const reduced = captureAll(repo, txn, { 'review-risk': [finding({ causal_disposition: 'unknown' }), finding({ claim: 'a second claim', evidence_class: 'insufficient' })] })
    assert.equal(reduced.state, 'escalated')
    assert.equal(reduced.reason, 'unknown_causality')
    assert.deepEqual(reduced.finding_ids, ['F1'])
    assert.deepEqual(reduced.insufficient_finding_ids, ['F2'])
  })
  test('insufficient wins over pre-existing for a severe finding', () => {
    const repo = highRepo()
    const txn = start(repo, { lenses: 'risk' })
    const reduced = captureAll(repo, txn, { 'review-risk': [finding({ evidence_class: 'insufficient', causal_disposition: 'pre-existing' })] })
    assert.equal(reduced.state, 'escalated')
  })
  test('a non-severe insufficient finding is advisory', () => {
    const repo = highRepo()
    const txn = start(repo, { lenses: 'risk' })
    const reduced = captureAll(repo, txn, { 'review-risk': [finding({ severity: 'WARNING', evidence_class: 'insufficient' })] })
    assert.equal(reduced.state, 'approved')
  })
  test('an unknown value is still refused', () => {
    const repo = highRepo()
    const txn = start(repo, { lenses: 'risk' })
    const r = capture(repo, txn, 'review-risk', lensResult(txn.subjects['review-risk'], txn.manifest, [finding({ causal_disposition: 'caused' })]))
    assert.equal(r.error.code, 'invalid_result')
    assert.match(r.error.message, /behavior-activated, worsened/)
  })
})

describe('S4: finding admission', () => {
  const attempt = (location, overrides = {}) => {
    const repo = highRepo()
    const txn = start(repo, { lenses: 'risk' })
    const r = capture(repo, txn, 'review-risk', lensResult(txn.subjects['review-risk'], txn.manifest, [finding({ location, ...overrides })]))
    return { repo, txn, r }
  }
  for (const [location, rule] of [
    ['scripts/build.sh:0', /positive/],
    ['scripts/build.sh:5-2', /start <= end|ascending/],
    ['/scripts/build.sh:1', /relative/],
    ['../scripts/build.sh:1', /canonical/],
    ['./scripts/build.sh:1', /canonical/],
    ['scripts//build.sh:1', /canonical/],
    ['src/app.js:1', /candidate/],
  ]) {
    test(`refuses ${location}`, () => {
      const { repo, txn, r } = attempt(location)
      assert.equal(r.status, 1)
      assert.equal(r.error.code, 'invalid_result')
      assert.match(r.error.message, rule)
      assert.equal(readTransaction(repo, txn.lineage).state, 'collecting')
    })
  }
  test('accepts a range and a path with spaces', () => {
    assert.equal(attempt('docs/the guide.md:3-5').r.status, 0)
  })
  test('a candidate-caused severe finding off every changed line is downgraded to unknown', () => {
    const { repo, txn, r } = attempt('docs/the guide.md:21-30')
    assert.equal(r.json.state, 'escalated')
    assert.equal(r.json.reason, 'unknown_causality')
    const stored = readTransaction(repo, txn.lineage).findings[0]
    assert.equal(stored.causal_disposition, 'unknown')
    assert.equal(stored.claimed_causal_disposition, 'introduced')
  })
  test('a range overlapping one changed line is kept', () => {
    assert.equal(attempt('docs/the guide.md:20-30').r.json.state, 'correction_required')
  })
  test('a pre-existing finding off the changed lines is not downgraded', () => {
    const { r } = attempt('docs/the guide.md:25', { causal_disposition: 'pre-existing' })
    assert.equal(r.json.state, 'approved')
  })
  test('a non-severe finding is never downgraded', () => {
    const { repo, txn } = attempt('docs/the guide.md:25', { severity: 'WARNING' })
    assert.equal(readTransaction(repo, txn.lineage).findings[0].causal_disposition, 'introduced')
  })
})

describe('S5: validator inconclusive retries', () => {
  const fixed = () => {
    const repo = highRepo()
    const txn = start(repo)
    captureAll(repo, txn, { 'review-risk': [finding()] })
    applyFiles(repo, { 'scripts/build.sh': 'echo safe\n' })
    review(repo, ['correct', '--lineage', txn.lineage])
    const stored = readTransaction(repo, txn.lineage)
    const validate = (outcome) => review(repo, ['capture-validation', '--lineage', txn.lineage, '--input', '-'], {
      input: JSON.stringify({ subject_hash: stored.correction.subject_hash, results: [{ finding_id: stored.to_correct[0].id, outcome, proof_refs: ['x'] }], regressions: [] }),
    })
    return { repo, txn, validate }
  }
  test('inconclusive keeps the lineage validating and counts the attempt', () => {
    const { repo, txn, validate } = fixed()
    const r = validate('inconclusive')
    assert.equal(r.status, 0)
    assert.equal(r.json.state, 'validation_required')
    assert.match(r.json.next.join('\n'), /capture-validation/)
    assert.equal(readTransaction(repo, txn.lineage).validation_attempts, 1)
    assert.equal(validate('resolved').json.state, 'approved')
    assert.equal(readTransaction(repo, txn.lineage).validation_attempts, 2)
  })
  test('the third inconclusive escalates', () => {
    const { validate } = fixed()
    assert.equal(validate('inconclusive').json.state, 'validation_required')
    assert.equal(validate('inconclusive').json.state, 'validation_required')
    assert.equal(validate('inconclusive').json.state, 'escalated')
  })
  test('unresolved escalates at once', () => {
    const { repo, txn, validate } = fixed()
    assert.equal(validate('unresolved').json.state, 'escalated')
    assert.equal(readTransaction(repo, txn.lineage).validation_attempts, 1)
  })
})
