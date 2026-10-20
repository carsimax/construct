// End-to-end lifecycle through the real CLI: start, context, capture, refutation,
// correction, validation, acknowledgement, and the assess integration.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { atomicCreate, receiptPath as storeReceiptPath } from '../../plugins/odd-skills/lib/review/store.mjs'
import { join } from 'node:path'
import {
  LENSES, applyFiles, assessJson, capture, captureAll, commitAll, finding, git, highRepo, lensResult, readTransaction,
  receiptFiles, refuterSubject, review, start, storeRoot,
} from './helpers.mjs'

const ack = (repo, txn) => review(repo, ['acknowledge', '--lineage', txn.lineage])

describe('happy path', () => {
  test('start, context, capture every lens, approved, acknowledge, receipt', () => {
    const repo = highRepo()
    const txn = start(repo, { lenses: 'readability,risk,reliability,resilience' })
    assert.match(txn.lineage, /^review-[0-9a-f]{16}$/)
    assert.match(txn.target, /^sha256:[0-9a-f]{64}$/)
    assert.equal(txn.state, 'collecting')
    assert.equal(txn.risk, 'high')
    assert.deepEqual(txn.lenses, LENSES)
    assert.deepEqual(txn.manifest, ['docs/the guide.md', 'scripts/build.sh'])
    assert.deepEqual(Object.keys(txn.subjects), LENSES)
    for (const lens of LENSES) assert.match(txn.subjects[lens], /^sha256:[0-9a-f]{64}$/)
    assert.equal(new Set(Object.values(txn.subjects)).size, 4)
    assert.ok(txn.next.length > 0 && txn.next.every((cmd) => cmd.startsWith('odd-review ')))

    for (const lens of LENSES) assert.equal(review(repo, ['context', '--lineage', txn.lineage, '--lens', lens]).status, 0)
    const reduced = captureAll(repo, txn)
    assert.equal(reduced.state, 'approved')
    assert.ok(reduced.next[0].startsWith(`odd-review acknowledge --lineage ${txn.lineage}`))

    const done = ack(repo, txn)
    assert.equal(done.status, 0)
    assert.equal(done.json.state, 'acknowledged')
    assert.deepEqual(done.json.next, [])
    assert.equal(receiptFiles(repo).length, 1)
    const receipt = JSON.parse(readFileSync(join(storeRoot(repo), 'receipts', receiptFiles(repo)[0]), 'utf8'))
    assert.equal(receipt.lineage, txn.lineage)
    assert.equal(receipt.target, txn.target)
    assert.equal(receipt.outcome, 'approved')
    assert.deepEqual(receipt.lenses, LENSES)
    assert.equal(readTransaction(repo, txn.lineage).state, 'acknowledged')
  })

  test('short and canonical lens names are accepted and kept in canonical order', () => {
    const txn = start(highRepo(), { lenses: 'review-reliability,risk' })
    assert.deepEqual(txn.lenses, ['review-risk', 'review-reliability'])
  })

  test('status prints the state and the exact next command', () => {
    const repo = highRepo()
    const txn = start(repo)
    const { status, json } = review(repo, ['status', '--lineage', txn.lineage])
    assert.equal(status, 0)
    assert.equal(json.state, 'collecting')
    assert.deepEqual(json.pending, ['review-risk', 'review-reliability'])
    assert.deepEqual(json.captured, [])
    assert.ok(json.next.length > 0)
  })

  test('next commands carry --cwd when the caller passed one', () => {
    const repo = highRepo()
    const txn = start(repo)
    assert.ok(txn.next.every((cmd) => cmd.includes('--cwd ')))
  })
})

describe('refutation path', () => {
  const inferential = finding({ evidence_class: 'inferential', claim: 'might expose a secret' })

  test('an inferential severe finding requires refutation and serves the batch', () => {
    const repo = highRepo()
    const txn = start(repo)
    const reduced = captureAll(repo, txn, { 'review-risk': [inferential] })
    assert.equal(reduced.state, 'refutation_required')
    assert.equal(reduced.refutation_batch.length, 1)
    const id = reduced.refutation_batch[0].id
    assert.equal(reduced.refutation_batch[0].claim, 'might expose a secret')
    assert.match(reduced.next.join('\n'), /capture-refuter/)

    const ctx = review(repo, ['context', '--lineage', txn.lineage, '--lens', 'review-refuter'])
    assert.equal(ctx.status, 0)
    assert.match(ctx.stdout, /ODD_REVIEW_FINDINGS /)
    assert.ok(ctx.stdout.includes(id))

    const refuted = review(repo, ['capture-refuter', '--lineage', txn.lineage, '--input', '-'], {
      input: JSON.stringify({ subject_hash: refuterSubject(repo, txn), results: [{ finding_id: id, outcome: 'refuted', proof_refs: ['the command is constant'] }] }),
    })
    assert.equal(refuted.status, 0)
    assert.equal(refuted.json.state, 'approved')
    assert.equal(ack(repo, txn).json.state, 'acknowledged')
    const receipt = JSON.parse(readFileSync(join(storeRoot(repo), 'receipts', receiptFiles(repo)[0]), 'utf8'))
    assert.equal(receipt.advisory_findings.length, 1)
  })

  test('a corroborated finding moves to correction_required', () => {
    const repo = highRepo()
    const txn = start(repo)
    const id = captureAll(repo, txn, { 'review-risk': [inferential] }).refutation_batch[0].id
    const { json } = review(repo, ['capture-refuter', '--lineage', txn.lineage, '--input', '-'], {
      input: JSON.stringify({ subject_hash: refuterSubject(repo, txn), results: [{ finding_id: id, outcome: 'corroborated', proof_refs: ['reachable'] }] }),
    })
    assert.equal(json.state, 'correction_required')
    assert.equal(json.to_correct.length, 1)
  })

  test('an inconclusive outcome never corroborates', () => {
    const repo = highRepo()
    const txn = start(repo)
    const id = captureAll(repo, txn, { 'review-risk': [inferential] }).refutation_batch[0].id
    const { json } = review(repo, ['capture-refuter', '--lineage', txn.lineage, '--input', '-'], {
      input: JSON.stringify({ subject_hash: refuterSubject(repo, txn), results: [{ finding_id: id, outcome: 'inconclusive', proof_refs: ['no evidence'] }] }),
    })
    assert.equal(json.state, 'approved')
  })

  test('the refuter result must cover the batch exactly', () => {
    const repo = highRepo()
    const txn = start(repo)
    const id = captureAll(repo, txn, { 'review-risk': [inferential] }).refutation_batch[0].id
    for (const results of [[], [{ finding_id: 'F99', outcome: 'refuted', proof_refs: ['x'] }], [{ finding_id: id, outcome: 'maybe', proof_refs: ['x'] }]]) {
      const r = review(repo, ['capture-refuter', '--lineage', txn.lineage, '--input', '-'], { input: JSON.stringify({ subject_hash: refuterSubject(repo, txn), results }) })
      assert.equal(r.status, 1)
      assert.equal(r.error.code, 'invalid_result')
    }
    assert.equal(readTransaction(repo, txn.lineage).state, 'refutation_required')
  })
})

describe('reduction', () => {
  test('only candidate-caused BLOCKER or CRITICAL findings block', () => {
    const repo = highRepo()
    const txn = start(repo)
    const reduced = captureAll(repo, txn, {
      'review-risk': [finding({ causal_disposition: 'pre-existing' }), finding({ severity: 'WARNING' }), finding({ severity: 'WARNING', causal_disposition: 'unknown' }), finding({ causal_disposition: 'base-only' })],
    })
    assert.equal(reduced.state, 'approved')
  })

  test('a deterministic severe finding requires correction', () => {
    const repo = highRepo()
    const txn = start(repo)
    const reduced = captureAll(repo, txn, { 'review-reliability': [finding({ severity: 'BLOCKER' })] })
    assert.equal(reduced.state, 'correction_required')
    assert.equal(reduced.to_correct.length, 1)
    assert.ok(reduced.correction_budget.max_changed_lines > 0)
    assert.match(reduced.next.join('\n'), /correct --lineage/)
  })

  test('the state stays collecting until every selected lens is captured', () => {
    const repo = highRepo()
    const txn = start(repo)
    const first = capture(repo, txn, 'review-risk', lensResult(txn.subjects['review-risk'], txn.manifest))
    assert.equal(first.json.state, 'collecting')
    assert.deepEqual(first.json.pending, ['review-reliability'])
    assert.ok(first.json.next.length > 0)
  })
})

describe('refuter binding', () => {
  const inferential = finding({ evidence_class: 'inferential', claim: 'might expose a secret' })
  const setup = () => {
    const repo = highRepo()
    const txn = start(repo)
    captureAll(repo, txn, { 'review-risk': [inferential] })
    return { repo, txn }
  }
  const send = (repo, txn, subject_hash) =>
    review(repo, ['capture-refuter', '--lineage', txn.lineage, '--input', '-'], {
      input: JSON.stringify({ subject_hash, results: [{ finding_id: 'F1', outcome: 'refuted', proof_refs: ['checked'] }] }),
    })

  test('the context binding carries the lineage-bound refuter subject', () => {
    const { repo, txn } = setup()
    const line = review(repo, ['context', '--lineage', txn.lineage, '--lens', 'review-refuter']).stdout.split('\n')[0]
    const binding = JSON.parse(line.slice('ODD_REVIEW_BINDING '.length))
    assert.equal(binding.subject_hash, refuterSubject(repo, txn))
    assert.match(binding.subject_hash, /^sha256:[0-9a-f]{64}$/)
    assert.notEqual(binding.subject_hash, txn.subjects['review-risk'])
  })

  test('a wrong subject is refused and leaves the transaction unchanged', () => {
    const { repo, txn } = setup()
    const before = readTransaction(repo, txn.lineage)
    const refused = send(repo, txn, 'sha256:wrong')
    assert.equal(refused.status, 1)
    assert.equal(refused.error.code, 'subject_mismatch')
    const after = readTransaction(repo, txn.lineage)
    assert.equal(after.state, 'refutation_required')
    assert.deepEqual(after.refutation_batch, before.refutation_batch)
  })

  test('a result without a subject is refused as invalid', () => {
    const { repo, txn } = setup()
    const r = review(repo, ['capture-refuter', '--lineage', txn.lineage, '--input', '-'], {
      input: JSON.stringify({ results: [{ finding_id: 'F1', outcome: 'refuted', proof_refs: ['x'] }] }),
    })
    assert.equal(r.error.code, 'invalid_result')
  })

  test('the subject of another lineage over the same candidate is refused', () => {
    const { repo, txn } = setup()
    const other = start(repo)
    captureAll(repo, other, { 'review-risk': [inferential] })
    assert.equal(other.target, txn.target)
    assert.notEqual(refuterSubject(repo, other), refuterSubject(repo, txn))
    assert.equal(send(repo, txn, refuterSubject(repo, other)).error.code, 'subject_mismatch')
  })

  test('the correct subject is accepted', () => {
    const { repo, txn } = setup()
    const ok = send(repo, txn, refuterSubject(repo, txn))
    assert.equal(ok.status, 0)
    assert.equal(ok.json.state, 'approved')
  })
})

describe('mixed and unknown severe findings', () => {
  const f1 = finding({ location: 'a.txt:1', severity: 'BLOCKER' })
  const f2 = finding({ location: 'a.txt:5', evidence_class: 'inferential', claim: 'inferred exposure' })
  const refute = (repo, txn, outcome) =>
    review(repo, ['capture-refuter', '--lineage', txn.lineage, '--input', '-'], {
      input: JSON.stringify({ subject_hash: refuterSubject(repo, txn), results: [{ finding_id: 'F2', outcome, proof_refs: ['checked'] }] }),
    })

  test('deterministic and inferential severe findings share one refuter batch', () => {
    const repo = highRepo()
    const txn = start(repo, { lenses: 'risk' })
    const reduced = captureAll(repo, txn, { 'review-risk': [f1, f2] })
    assert.equal(reduced.state, 'refutation_required')
    assert.deepEqual(reduced.refutation_batch.map((f) => f.id), ['F2'])
  })

  test('a corroborated inferential finding joins the confirmed deterministic one', () => {
    const repo = highRepo()
    const txn = start(repo, { lenses: 'risk' })
    captureAll(repo, txn, { 'review-risk': [f1, f2] })
    const { json } = refute(repo, txn, 'corroborated')
    assert.equal(json.state, 'correction_required')
    assert.deepEqual(json.to_correct.map((f) => f.id), ['F1', 'F2'])
    applyFiles(repo, { 'scripts/build.sh': 'echo safe\n' })
    assert.equal(review(repo, ['correct', '--lineage', txn.lineage]).status, 0)
    const ctx = review(repo, ['context', '--lineage', txn.lineage, '--lens', 'review-validator']).stdout
    const listed = JSON.parse(ctx.split('\n').find((l) => l.startsWith('ODD_REVIEW_FINDINGS ')).slice('ODD_REVIEW_FINDINGS '.length))
    assert.deepEqual(listed.map((f) => f.id), ['F1', 'F2'])
    const subject = readTransaction(repo, txn.lineage).correction.subject_hash
    const partial = review(repo, ['capture-validation', '--lineage', txn.lineage, '--input', '-'], {
      input: JSON.stringify({ subject_hash: subject, results: [{ finding_id: 'F1', outcome: 'resolved', proof_refs: ['x'] }], regressions: [] }),
    })
    assert.equal(partial.error.code, 'invalid_result')
  })

  test('a refuted inferential finding leaves only the deterministic one to correct', () => {
    const repo = highRepo()
    const txn = start(repo, { lenses: 'risk' })
    captureAll(repo, txn, { 'review-risk': [f1, f2] })
    const { json } = refute(repo, txn, 'refuted')
    assert.equal(json.state, 'correction_required')
    assert.deepEqual(json.to_correct.map((f) => f.id), ['F1'])
  })

  test('a severe finding with unknown causality escalates before refutation or correction', () => {
    const repo = highRepo()
    const txn = start(repo, { lenses: 'risk' })
    const reduced = captureAll(repo, txn, { 'review-risk': [finding({ causal_disposition: 'unknown' }), f2] })
    assert.equal(reduced.state, 'escalated')
    assert.deepEqual(reduced.next, [])
    assert.equal(reduced.reason, 'unknown_causality')
    assert.deepEqual(reduced.finding_ids, ['F1'])
    const refused = ack(repo, txn)
    assert.equal(refused.status, 1)
    assert.equal(refused.error.code, 'not_approved')
    assert.deepEqual(receiptFiles(repo), [])
  })
})

describe('correction path', () => {
  const blocked = () => {
    const repo = highRepo()
    const txn = start(repo)
    captureAll(repo, txn, { 'review-risk': [finding()] })
    return { repo, txn }
  }

  const validate = (repo, txn, results, regressions = [], hash) => {
    const subject = hash ?? readTransaction(repo, txn.lineage).correction.subject_hash
    return review(repo, ['capture-validation', '--lineage', txn.lineage, '--input', '-'], {
      input: JSON.stringify({ subject_hash: subject, results, regressions }),
    })
  }

  test('a resolved correction is approved and its receipt consumes the corrected candidate', () => {
    const { repo, txn } = blocked()
    const id = readTransaction(repo, txn.lineage).to_correct[0].id
    applyFiles(repo, { 'scripts/build.sh': 'echo safe\n' })
    const fixed = review(repo, ['correct', '--lineage', txn.lineage])
    assert.equal(fixed.status, 0)
    assert.equal(fixed.json.state, 'validation_required')
    assert.notEqual(fixed.json.corrected_target, txn.target)
    assert.match(fixed.json.next.join('\n'), /capture-validation/)

    const ctx = review(repo, ['context', '--lineage', txn.lineage, '--lens', 'review-validator'])
    assert.equal(ctx.status, 0)
    assert.ok(ctx.stdout.includes('+echo safe'))
    assert.match(ctx.stdout, /ODD_REVIEW_FINDINGS /)

    const result = validate(repo, txn, [{ finding_id: id, outcome: 'resolved', proof_refs: ['the command is now constant'] }])
    assert.equal(result.json.state, 'approved')
    assert.equal(ack(repo, txn).json.state, 'acknowledged')

    const assessed = assessJson(repo)
    assert.equal(assessed.json.candidate.consumed, true)
    assert.equal(assessed.json.review_due_reason, 'already_reviewed')
  })

  test('an unresolved finding escalates to a human decision', () => {
    const { repo, txn } = blocked()
    const id = readTransaction(repo, txn.lineage).to_correct[0].id
    applyFiles(repo, { 'scripts/build.sh': 'echo still unsafe\n' })
    review(repo, ['correct', '--lineage', txn.lineage])
    const result = validate(repo, txn, [{ finding_id: id, outcome: 'unresolved', proof_refs: ['still reachable'] }])
    assert.equal(result.json.state, 'escalated')
    assert.deepEqual(result.json.next, [])
    const refused = ack(repo, txn)
    assert.equal(refused.status, 1)
    assert.equal(refused.error.code, 'not_approved')
  })

  test('a regression escalates even when every finding is resolved', () => {
    const { repo, txn } = blocked()
    const id = readTransaction(repo, txn.lineage).to_correct[0].id
    applyFiles(repo, { 'scripts/build.sh': 'echo safe\n' })
    review(repo, ['correct', '--lineage', txn.lineage])
    const result = validate(
      repo, txn, [{ finding_id: id, outcome: 'resolved', proof_refs: ['fixed'] }],
      [{ location: 'scripts/build.sh:1', claim: 'new defect', proof: 'the added line' }],
    )
    assert.equal(result.json.state, 'escalated')
  })

  test('validation rejects a wrong subject hash and an incomplete result list', () => {
    const { repo, txn } = blocked()
    const id = readTransaction(repo, txn.lineage).to_correct[0].id
    applyFiles(repo, { 'scripts/build.sh': 'echo safe\n' })
    review(repo, ['correct', '--lineage', txn.lineage])
    const bad = validate(repo, txn, [{ finding_id: id, outcome: 'resolved', proof_refs: ['x'] }], [], 'sha256:wrong')
    assert.equal(bad.error.code, 'invalid_result')
    const missing = validate(repo, txn, [])
    assert.equal(missing.error.code, 'invalid_result')
    assert.equal(readTransaction(repo, txn.lineage).state, 'validation_required')
  })

  test('the correction budget is enforced and does not consume the one correction', () => {
    const { repo, txn } = blocked()
    applyFiles(repo, { 'scripts/build.sh': 'echo hi\n', 'src/big.js': Array.from({ length: 400 }, (_, i) => `x${i}\n`).join('') })
    const over = review(repo, ['correct', '--lineage', txn.lineage])
    assert.equal(over.status, 1)
    assert.equal(over.error.code, 'correction_budget_exceeded')
    assert.equal(readTransaction(repo, txn.lineage).state, 'correction_required')

    applyFiles(repo, { 'src/big.js': null, 'scripts/build.sh': 'echo safe\n' })
    assert.equal(review(repo, ['correct', '--lineage', txn.lineage]).status, 0)
  })

  test('an unchanged candidate is not a correction', () => {
    const { repo, txn } = blocked()
    const refused = review(repo, ['correct', '--lineage', txn.lineage])
    assert.equal(refused.status, 1)
    assert.equal(refused.error.code, 'no_correction')
  })

  test('only one correction is allowed per lineage', () => {
    const { repo, txn } = blocked()
    applyFiles(repo, { 'scripts/build.sh': 'echo safe\n' })
    assert.equal(review(repo, ['correct', '--lineage', txn.lineage]).status, 0)
    applyFiles(repo, { 'scripts/build.sh': 'echo safer\n' })
    const second = review(repo, ['correct', '--lineage', txn.lineage])
    assert.equal(second.status, 1)
    assert.equal(second.error.code, 'wrong_state')
  })

  test('correct is refused outside correction_required', () => {
    const repo = highRepo()
    const txn = start(repo)
    assert.equal(review(repo, ['correct', '--lineage', txn.lineage]).error.code, 'wrong_state')
  })

  test('a committed correction against the same base is accepted with --base-ref', () => {
    const repo = highRepo()
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'work')
    const txn = start(repo, { args: ['--base-ref', 'HEAD~1', '--committed-only'] })
    captureAll(repo, txn, { 'review-risk': [finding()] })
    applyFiles(repo, { 'scripts/build.sh': 'echo safe\n' })
    commitAll(repo, 'fix')
    const fixed = review(repo, ['correct', '--lineage', txn.lineage, '--base-ref', 'HEAD~2'])
    assert.equal(fixed.status, 0)
    assert.equal(fixed.json.state, 'validation_required')
  })

  test('a different base ref is refused', () => {
    const repo = highRepo()
    commitAll(repo, 'work')
    const txn = start(repo, { args: ['--base-ref', 'HEAD~1', '--committed-only'] })
    captureAll(repo, txn, { 'review-risk': [finding()] })
    applyFiles(repo, { 'scripts/build.sh': 'echo safe\n' })
    commitAll(repo, 'fix')
    const refused = review(repo, ['correct', '--lineage', txn.lineage, '--base-ref', 'HEAD'])
    assert.equal(refused.error.code, 'base_mismatch')
  })
})

describe('idempotent acknowledge', () => {
  const crashed = (lineage) => {
    const repo = highRepo()
    const txn = start(repo)
    captureAll(repo, txn)
    atomicCreate(storeReceiptPath(repo, txn.target), `${JSON.stringify({ lineage, target: txn.target })}\n`)
    return { repo, txn }
  }

  test('a receipt of the same lineage on an approved transaction completes it', () => {
    const repo = highRepo()
    const txn = start(repo)
    captureAll(repo, txn)
    atomicCreate(storeReceiptPath(repo, txn.target), `${JSON.stringify({ lineage: txn.lineage, target: txn.target })}\n`)
    const done = ack(repo, txn)
    assert.equal(done.status, 0)
    assert.equal(done.json.state, 'acknowledged')
    assert.equal(done.json.recovered, true)
    assert.deepEqual(done.json.next, [])
    assert.equal(readTransaction(repo, txn.lineage).state, 'acknowledged')
    assert.equal(ack(repo, txn).error.code, 'already_acknowledged')
  })

  test('a normal acknowledge is not marked recovered', () => {
    const repo = highRepo()
    const txn = start(repo)
    captureAll(repo, txn)
    assert.equal(ack(repo, txn).json.recovered, undefined)
  })

  test('a receipt naming a different lineage still refuses', () => {
    const { repo, txn } = crashed('review-0123456789abcdef')
    const refused = ack(repo, txn)
    assert.equal(refused.status, 1)
    assert.equal(refused.error.code, 'target_already_acknowledged')
    assert.equal(readTransaction(repo, txn.lineage).state, 'approved')
  })
})

describe('acknowledge and receipts', () => {
  test('acknowledge refuses anything but approved', () => {
    const repo = highRepo()
    const txn = start(repo)
    const refused = ack(repo, txn)
    assert.equal(refused.status, 1)
    assert.equal(refused.error.code, 'not_approved')
    assert.deepEqual(receiptFiles(repo), [])
  })

  test('acknowledge refuses a replay and writes one receipt', () => {
    const repo = highRepo()
    const txn = start(repo)
    captureAll(repo, txn)
    assert.equal(ack(repo, txn).status, 0)
    const replay = ack(repo, txn)
    assert.equal(replay.status, 1)
    assert.equal(replay.error.code, 'already_acknowledged')
    assert.equal(receiptFiles(repo).length, 1)
  })

  test('start refuses a target that already has a receipt', () => {
    const repo = highRepo()
    const txn = start(repo)
    captureAll(repo, txn)
    ack(repo, txn)
    const again = review(repo, ['start', '--lenses', 'risk', '--lenses-reason', 'again'])
    assert.equal(again.status, 1)
    assert.equal(again.error.code, 'target_already_acknowledged')
  })

  test('a changed candidate is a new target', () => {
    const repo = highRepo()
    const txn = start(repo)
    captureAll(repo, txn)
    ack(repo, txn)
    applyFiles(repo, { 'scripts/other.sh': 'echo other\n' })
    assert.equal(review(repo, ['start', '--lenses', 'risk', '--lenses-reason', 'new']).status, 0)
  })

  test('the same candidate always has the same target', () => {
    const repo = highRepo()
    assert.equal(start(repo).target, start(repo).target)
  })

  test('odd-assess reports the candidate as consumed only after acknowledgement', () => {
    const repo = highRepo()
    const before = assessJson(repo).json
    assert.equal(before.candidate.consumed, false)
    assert.equal(before.review_due, true)
    const txn = start(repo)
    captureAll(repo, txn)
    assert.equal(assessJson(repo).json.candidate.consumed, false)
    ack(repo, txn)
    const after = assessJson(repo).json
    assert.equal(after.candidate.consumed, true)
    assert.equal(after.review_due, false)
    assert.equal(after.review_due_reason, 'already_reviewed')
    assert.equal(after.risk, 'high')
  })

  test('a committed range is consumed the same way', () => {
    const repo = highRepo()
    commitAll(repo, 'work')
    const args = ['--base-ref', 'HEAD~1', '--committed-only']
    const txn = start(repo, { args })
    captureAll(repo, txn)
    ack(repo, txn)
    const after = assessJson(repo, args).json
    assert.deepEqual(after.candidate, { kind: 'base-diff', base_ref: 'HEAD~1', consumed: true })
    assert.equal(after.review_due_reason, 'already_reviewed')
  })

  test('an acknowledged receipt exists under the common git directory only', () => {
    const repo = highRepo()
    const txn = start(repo)
    captureAll(repo, txn)
    ack(repo, txn)
    assert.ok(existsSync(join(storeRoot(repo), 'receipts')))
    assert.ok(!existsSync(join(repo, 'odd-review')))
  })
})
