// The integrity hashes of a receipt, recomputed from the transaction. A receipt
// stores them at acknowledge; status recomputes them to tell whether the
// transaction or the receipt changed afterwards.
import { readFileSync } from 'node:fs'
import { manifestDigest, sha256 } from './identity.mjs'
import { receiptPath } from './store.mjs'

export const ONE_SHOT = ['full_reviews', 'refuter_batches', 'fix_batches', 'scoped_fix_validations', 'final_verifications']
export const MAX_CORRECTION_LINES = 200
export const HASH_FIELDS = ['paths_digest', 'policy_hash', 'ledger_hash', 'evidence_hash', 'fix_delta_hash']

export const emptyCounters = () => Object.fromEntries(ONE_SHOT.map((name) => [name, 0]))

// correctionBudget is min(200, ceil(lines/2)); a candidate with any changed line
// gets at least 2, the cost of replacing one line (one addition, one deletion).
export const correctionBudget = (changedLines) =>
  changedLines > 0 ? Math.max(2, Math.min(MAX_CORRECTION_LINES, Math.ceil(changedLines / 2))) : 0

export function receiptHashes(transaction) {
  const fix = transaction.correction
  return {
    paths_digest: fix ? fix.manifest_digest : transaction.manifest_digest ?? manifestDigest(transaction.manifest),
    policy_hash: sha256(JSON.stringify({
      risk: transaction.risk,
      lenses: transaction.lenses,
      one_shot: ONE_SHOT,
      correction_budget: correctionBudget(transaction.changed_lines),
    })),
    ledger_hash: sha256(JSON.stringify(transaction.findings)),
    evidence_hash: sha256(JSON.stringify({
      results: transaction.results,
      refutation: transaction.refutation ?? null,
      validation: transaction.validation ?? null,
    })),
    fix_delta_hash: sha256(fix ? JSON.stringify({ from: transaction.candidate_tree, to: fix.candidate_tree }) : ''),
  }
}

// checkReceipt compares the stored receipt of an acknowledged transaction with
// the hashes the transaction now produces: ok, mismatch (with the field names),
// legacy (a receipt from before the hashes), missing, or unreadable.
export function checkReceipt(root, transaction) {
  const target = transaction.correction ? transaction.correction.target : transaction.target
  const file = receiptPath(root, target)
  let receipt
  try {
    receipt = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    return { status: error.code === 'ENOENT' ? 'missing' : 'unreadable', path: file, mismatched: [] }
  }
  if (receipt === null || typeof receipt !== 'object') return { status: 'unreadable', path: file, mismatched: [] }
  if (HASH_FIELDS.every((field) => receipt[field] === undefined)) return { status: 'legacy', path: file, mismatched: [] }
  const expected = receiptHashes(transaction)
  const mismatched = HASH_FIELDS.filter((field) => receipt[field] !== expected[field])
  return { status: mismatched.length === 0 ? 'ok' : 'mismatch', path: file, mismatched }
}
