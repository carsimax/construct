// The odd-review state machine:
//   collecting -> approved | refutation_required | correction_required
//   refutation_required -> approved | correction_required
//   correction_required -> validation_required (one correction per lineage)
//   validation_required -> approved | escalated (terminal)
//   approved -> acknowledged (terminal; writes the receipt)
// Every function returns the JSON to print; a refusal throws a Refusal.
import { readFileSync } from 'node:fs'
import { resolveCandidate } from '../assess/cli.mjs'
import { createIsolation, freezeWorkingTree, git, resolveTree } from '../assess/git.mjs'
import { assessSnapshotRisk } from '../assess/classify.mjs'
import { publicRisk } from '../assess/output.mjs'
import { collectDiffStats, countChangedLines } from '../assess/stats.mjs'
import { headCommit } from './boundary.mjs'
import { buildContext, DEFAULT_CONTEXT_BYTES } from './evidence.mjs'
import { Refusal } from './errors.mjs'
import { REFUTER, VALIDATOR, newLineage, refuterSubjectHashOf, subjectHashOf, targetOf, manifestDigest, canonicalLens } from './identity.mjs'
import { reduceLenses } from './reduce.mjs'
import { atomicCreate, readTransaction, receiptExists, receiptPath, withLock, writeTransaction } from './store.mjs'
import { validateLensResult, validateRefuterResult, validateValidatorResult } from './validate.mjs'

export const SCHEMA = 'odd-skills.review-transaction/v1'
export const RECEIPT_SCHEMA = 'odd-skills.review-receipt/v1'
const MAX_CORRECTION_LINES = 200

const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`

// nextCommands lists the exact commands that continue the transaction. The
// repository is named with --cwd only when the caller named it.
export function nextCommands(transaction, cwd) {
  const tail = cwd ? ` --cwd ${quote(cwd)}` : ''
  const cmd = (text) => `odd-review ${text}${tail}`
  const id = `--lineage ${transaction.lineage}`
  switch (transaction.state) {
    case 'collecting':
      return pending(transaction).flatMap((lens) => [cmd(`context ${id} --lens ${lens}`), cmd(`capture ${id} --lens ${lens} --input -`)])
    case 'refutation_required':
      return [cmd(`context ${id} --lens ${REFUTER}`), cmd(`capture-refuter ${id} --input -`)]
    case 'correction_required':
      return [cmd(`correct ${id}`)]
    case 'validation_required':
      return [cmd(`context ${id} --lens ${VALIDATOR}`), cmd(`capture-validation ${id} --input -`)]
    case 'approved':
      return [cmd(`acknowledge ${id}`)]
    default:
      return []
  }
}

const pending = (transaction) => transaction.lenses.filter((lens) => !Object.hasOwn(transaction.results, lens))

const correctionBudget = (transaction) => Math.min(MAX_CORRECTION_LINES, Math.ceil(transaction.changed_lines / 2))

const neutral = (finding) => ({ id: finding.id, location: finding.location, severity: finding.severity, claim: finding.claim, proof_refs: finding.proof_refs })

// view is the JSON every transition prints.
function view(transaction, cwd, extra = {}) {
  const out = {
    schema: SCHEMA,
    lineage: transaction.lineage,
    state: transaction.state,
    target: transaction.target,
    lenses: transaction.lenses,
    captured: transaction.lenses.filter((lens) => Object.hasOwn(transaction.results, lens)),
    pending: pending(transaction),
    ...extra,
  }
  if (transaction.state === 'refutation_required') out.refutation_batch = transaction.refutation_batch
  if (transaction.state === 'correction_required') {
    out.to_correct = transaction.to_correct
    out.correction_budget = { max_changed_lines: correctionBudget(transaction) }
  }
  if (transaction.state === 'escalated') {
    if (transaction.escalation) {
      out.reason = transaction.escalation.reason
      out.finding_ids = transaction.escalation.finding_ids
      out.message = 'a BLOCKER or CRITICAL finding has unknown causality: a human decision is required'
    } else {
      out.message = 'the correction did not resolve every finding: a human decision is required'
    }
  }
  out.next = nextCommands(transaction, cwd)
  return out
}

function transition(transaction, state) {
  transaction.state = state
  transaction.history.push({ state, at: new Date().toISOString() })
}

function requireState(transaction, ...states) {
  if (!states.includes(transaction.state)) {
    throw new Refusal('wrong_state', `the transaction is ${transaction.state}; this command needs ${states.join(' or ')}`, { state: transaction.state })
  }
}

// commitFields records the commits of a committed-mode review: the HEAD it ran
// on and, when --base-ref names a commit, that commit. Working-tree reviews have
// neither, and older transactions and receipts without them stay valid.
function commitFields(root, candidate) {
  if (candidate.kind !== 'base-diff') return {}
  const fields = { candidate_commit: headCommit(root) }
  try {
    fields.base_commit = git(root, ['rev-parse', '--verify', '-q', `${candidate.baseRef}^{commit}`]).toString('utf8').trim()
  } catch {
    // The base ref names a tree, not a commit.
  }
  return fields
}

// start freezes the candidate and opens a transaction in state collecting.
export function start({ root, cwd, baseRef, committedOnly, lenses, lensesReason }) {
  let isolation = null
  try {
    let candidate
    try {
      candidate = resolveCandidate({ cwd: root, baseRef, committedOnly })
    } catch (error) {
      throw new Refusal('start_refused', error.message)
    }
    isolation = createIsolation(root)
    const assessment = assessSnapshotRisk({ root, baseTree: candidate.baseTree, candidateTree: candidate.candidateTree, isolation })
    if (assessment.changedPaths === 0) throw new Refusal('start_refused', 'the candidate has no pending changes; review committed work with --base-ref <commit>')
    const target = targetOf(candidate.baseTree, candidate.candidateTree, assessment.manifest)
    if (receiptExists(root, target)) {
      throw new Refusal('target_already_acknowledged', 'this exact candidate already has a receipt; change the candidate to review it again', { target })
    }
    const lineage = newLineage()
    const now = new Date().toISOString()
    const transaction = {
      schema: SCHEMA,
      lineage,
      state: 'collecting',
      target,
      mode: candidate.kind === 'base-diff' ? { kind: 'committed', base_ref: candidate.baseRef } : { kind: 'working' },
      ...commitFields(root, candidate),
      base_tree: candidate.baseTree,
      candidate_tree: candidate.candidateTree,
      manifest: assessment.manifest,
      manifest_digest: manifestDigest(assessment.manifest),
      changed_paths: assessment.changedPaths,
      changed_lines: assessment.changedLines,
      risk: publicRisk(assessment.level),
      lenses,
      lenses_reason: lensesReason,
      subjects: Object.fromEntries(lenses.map((lens) => [lens, subjectHashOf({ lineage, target, lens, manifest: assessment.manifest })])),
      results: {},
      findings: [],
      refutation_batch: [],
      to_correct: [],
      advisory: [],
      correction: null,
      validation: null,
      created_at: now,
      history: [{ state: 'collecting', at: now }],
    }
    writeTransaction(root, transaction)
    return view(transaction, cwd, {
      risk: transaction.risk,
      lenses_reason: lensesReason,
      base_tree: transaction.base_tree,
      candidate_tree: transaction.candidate_tree,
      changed_paths: transaction.changed_paths,
      changed_lines: transaction.changed_lines,
      manifest: transaction.manifest,
      manifest_digest: transaction.manifest_digest,
      subjects: transaction.subjects,
    })
  } finally {
    isolation?.cleanup()
  }
}

// context serves the immutable evidence for one lens.
export function context({ root, lineage, lens: lensName, maxBytes = DEFAULT_CONTEXT_BYTES }) {
  const transaction = readTransaction(root, lineage)
  const lens = canonicalLens(lensName, [REFUTER, VALIDATOR])
  if (!lens) throw new Refusal('lens_not_selected', `unknown lens ${JSON.stringify(lensName)}`)
  let served
  if (lens === REFUTER) {
    requireState(transaction, 'refutation_required')
    served = { ...original(transaction), subjectHash: transaction.refutation_subject, findings: transaction.refutation_batch }
  } else if (lens === VALIDATOR) {
    requireState(transaction, 'validation_required')
    const fix = transaction.correction
    served = { baseTree: transaction.base_tree, candidateTree: fix.candidate_tree, manifest: fix.manifest, subjectHash: fix.subject_hash, findings: transaction.to_correct.map(neutral) }
  } else {
    if (!transaction.lenses.includes(lens)) throw new Refusal('lens_not_selected', `${lens} was not selected when the review started (${transaction.lenses.join(', ')})`)
    requireState(transaction, 'collecting')
    served = { ...original(transaction), subjectHash: transaction.subjects[lens] }
  }
  const isolation = createIsolation(root)
  try {
    return buildContext({ root, isolation, lineage, lens, maxBytes, ...served })
  } finally {
    isolation.cleanup()
  }
}

const original = (transaction) => ({ baseTree: transaction.base_tree, candidateTree: transaction.candidate_tree, manifest: transaction.manifest })

// settle applies a reduction outcome to the transaction.
function settle(transaction, outcome) {
  transaction.refutation_batch = outcome.refutation_batch
  transaction.confirmed = outcome.confirmed
  transaction.to_correct = outcome.to_correct
  if (outcome.escalation) transaction.escalation = outcome.escalation
  transaction.advisory = outcome.advisory
  if (outcome.state === 'refutation_required') {
    transaction.refutation_subject = refuterSubjectHashOf({
      lineage: transaction.lineage,
      target: transaction.target,
      batchIds: outcome.refutation_batch.map((finding) => finding.id),
    })
  }
  transition(transaction, outcome.state)
}

function modify(root, lineage, fn) {
  return withLock(root, lineage, () => {
    const transaction = readTransaction(root, lineage)
    const result = fn(transaction)
    writeTransaction(root, transaction)
    return result
  })
}

export function readInput(input) {
  let text
  try {
    text = readFileSync(input === '-' ? 0 : input, 'utf8')
  } catch (error) {
    throw new Refusal('malformed_result', `cannot read the result from ${input === '-' ? 'standard input' : input}: ${error.message}`)
  }
  try {
    return JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    throw new Refusal('malformed_result', 'the result is not valid JSON')
  }
}

export function capture({ root, cwd, lineage, lens: lensName, input }) {
  const result = readInput(input)
  return modify(root, lineage, (transaction) => {
    requireState(transaction, 'collecting')
    const lens = canonicalLens(lensName)
    if (!lens || !transaction.lenses.includes(lens)) {
      throw new Refusal('lens_not_selected', `${lensName} was not selected when the review started (${transaction.lenses.join(', ')})`)
    }
    if (Object.hasOwn(transaction.results, lens)) throw new Refusal('lens_already_captured', `${lens} was already captured; a lens is captured once`)
    const valid = validateLensResult(result, { subjectHash: transaction.subjects[lens], manifest: transaction.manifest })
    transaction.results[lens] = valid
    for (const found of valid.findings) {
      transaction.findings.push({ id: `F${transaction.findings.length + 1}`, lens, ...found })
    }
    if (pending(transaction).length === 0) settle(transaction, reduceLenses(transaction.findings))
    return view(transaction, cwd, { lens })
  })
}

export function captureRefuter({ root, cwd, lineage, input }) {
  const result = readInput(input)
  return modify(root, lineage, (transaction) => {
    requireState(transaction, 'refutation_required')
    const valid = validateRefuterResult(result, {
      subjectHash: transaction.refutation_subject,
      expectedIds: transaction.refutation_batch.map((finding) => finding.id),
    })
    const byId = new Map(valid.results.map((entry) => [entry.finding_id, entry]))
    const corroborated = []
    const advisory = [...transaction.advisory]
    for (const finding of transaction.refutation_batch) {
      const verdict = byId.get(finding.id)
      const full = transaction.findings.find((entry) => entry.id === finding.id)
      if (verdict.outcome === 'corroborated') corroborated.push(full)
      else advisory.push({ ...full, refuter_outcome: verdict.outcome })
    }
    transaction.refutation = valid.results
    transaction.advisory = advisory
    transaction.refutation_batch = []
    const toCorrect = [...(transaction.confirmed ?? []), ...corroborated].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))
    if (toCorrect.length > 0) {
      transaction.to_correct = toCorrect
      transition(transaction, 'correction_required')
    } else {
      transition(transaction, 'approved')
    }
    return view(transaction, cwd)
  })
}

// correctedCandidate freezes the candidate after the correction. The base tree
// never changes; the corrected tree is HEAD (committed mode) or the working state.
function correctedTree(root, transaction, baseRef) {
  const committed = transaction.mode.kind === 'committed' || (baseRef ?? '').trim() !== ''
  if (!committed) return freezeWorkingTree(root).candidateTree
  if ((baseRef ?? '').trim() !== '' && resolveTree(root, baseRef) !== transaction.base_tree) {
    throw new Refusal('base_mismatch', `--base-ref ${baseRef} is not the base this review was started against`)
  }
  return resolveTree(root, 'HEAD')
}

export function correct({ root, cwd, lineage, baseRef }) {
  return modify(root, lineage, (transaction) => {
    if (transaction.correction) throw new Refusal('wrong_state', 'this lineage already used its one correction', { state: transaction.state })
    requireState(transaction, 'correction_required')
    const candidateTree = correctedTree(root, transaction, baseRef)
    if (candidateTree === transaction.candidate_tree) {
      throw new Refusal('no_correction', 'the candidate is unchanged since the review started; correct the findings first, then run correct again')
    }
    const isolation = createIsolation(root)
    try {
      const fixStats = collectDiffStats(root, transaction.candidate_tree, candidateTree, isolation)
      const changedLines = countChangedLines(fixStats)
      const budget = correctionBudget(transaction)
      if (changedLines > budget) {
        throw new Refusal(
          'correction_budget_exceeded',
          `the correction changes ${changedLines} lines; the budget is ${budget} (the smaller of ${MAX_CORRECTION_LINES} and half of the ${transaction.changed_lines} reviewed lines). Reduce it and run correct again`,
          { changed_lines: changedLines, max_changed_lines: budget },
        )
      }
      const manifest = collectDiffStats(root, transaction.base_tree, candidateTree, isolation).map((stat) => stat.path)
      if (manifest.length === 0) throw new Refusal('no_correction', 'the corrected candidate has no changes against the base')
      const target = targetOf(transaction.base_tree, candidateTree, manifest)
      transaction.correction = {
        candidate_tree: candidateTree,
        ...(transaction.mode.kind === 'committed' || (baseRef ?? '').trim() !== '' ? { candidate_commit: headCommit(root) } : {}),
        target,
        manifest,
        manifest_digest: manifestDigest(manifest),
        subject_hash: subjectHashOf({ lineage, target, lens: VALIDATOR, manifest }),
        changed_lines: changedLines,
        budget,
        at: new Date().toISOString(),
      }
      transition(transaction, 'validation_required')
      return view(transaction, cwd, {
        corrected_target: target,
        corrected_candidate_tree: candidateTree,
        manifest,
        subjects: { [VALIDATOR]: transaction.correction.subject_hash },
        correction_changed_lines: changedLines,
        correction_budget: { max_changed_lines: budget },
      })
    } finally {
      isolation.cleanup()
    }
  })
}

export function captureValidation({ root, cwd, lineage, input }) {
  const result = readInput(input)
  return modify(root, lineage, (transaction) => {
    requireState(transaction, 'validation_required')
    const valid = validateValidatorResult(result, {
      subjectHash: transaction.correction.subject_hash,
      expectedIds: transaction.to_correct.map((finding) => finding.id),
    })
    transaction.validation = valid
    const resolved = valid.results.every((entry) => entry.outcome === 'resolved') && valid.regressions.length === 0
    transition(transaction, resolved ? 'approved' : 'escalated')
    return view(transaction, cwd)
  })
}

export function status({ root, cwd, lineage }) {
  return view(readTransaction(root, lineage), cwd)
}

// acknowledge consumes an approved review: it writes the receipt for the final
// reviewed candidate (the corrected one after a correction) exactly once.
function commitsOfReceipt(transaction, fix) {
  const out = {}
  const candidate = fix ? fix.candidate_commit : transaction.candidate_commit
  if (candidate) out.candidate_commit = candidate
  if (transaction.base_commit) out.base_commit = transaction.base_commit
  return out
}

function readReceiptLineage(root, target) {
  try {
    return JSON.parse(readFileSync(receiptPath(root, target), 'utf8')).lineage
  } catch {
    return null
  }
}

export function acknowledge({ root, cwd, lineage }) {
  return withLock(root, lineage, () => {
    const transaction = readTransaction(root, lineage)
    if (transaction.state === 'acknowledged') throw new Refusal('already_acknowledged', 'this review was already acknowledged', { state: transaction.state })
    if (transaction.state !== 'approved') {
      throw new Refusal('not_approved', `only an approved review can be acknowledged; this one is ${transaction.state}`, { state: transaction.state })
    }
    const fix = transaction.correction
    const target = fix ? fix.target : transaction.target
    const now = new Date().toISOString()
    const receipt = {
      schema: RECEIPT_SCHEMA,
      lineage,
      target,
      original_target: transaction.target,
      corrected: Boolean(fix),
      base_tree: transaction.base_tree,
      candidate_tree: fix ? fix.candidate_tree : transaction.candidate_tree,
      ...commitsOfReceipt(transaction, fix),
      lenses: transaction.lenses,
      lenses_reason: transaction.lenses_reason,
      outcome: 'approved',
      advisory_findings: transaction.advisory,
      started_at: transaction.created_at,
      acknowledged_at: now,
    }
    let recovered = false
    if (!atomicCreate(receiptPath(root, target), `${JSON.stringify(receipt, null, 2)}\n`)) {
      // A crash after the receipt and before the transaction update leaves an
      // approved transaction with its own receipt: complete it. A receipt of
      // another lineage is a different review of the same candidate.
      if (readReceiptLineage(root, target) !== lineage) {
        throw new Refusal('target_already_acknowledged', 'this exact candidate already has a receipt', { target })
      }
      recovered = true
    }
    transition(transaction, 'acknowledged')
    transaction.acknowledged_at = now
    writeTransaction(root, transaction)
    return view(transaction, cwd, { receipt: receiptPath(root, target), outcome: 'approved', ...(recovered ? { recovered: true } : {}) })
  })
}
