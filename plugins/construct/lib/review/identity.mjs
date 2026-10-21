// Identities of a review: target, lineage, and per-lens subject hashes. All are
// derived from frozen tree ids and the sorted changed-path manifest, so the same
// candidate always has the same target.
import { createHash, randomBytes } from 'node:crypto'
import { CANONICAL_LENSES } from '../assess/output.mjs'
import { Refusal } from './errors.mjs'

export { CANONICAL_LENSES }
export const REFUTER = 'review-refuter'
export const VALIDATOR = 'review-validator'

export const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`

export const manifestDigest = (manifest) => sha256(JSON.stringify(manifest))

// targetOf binds base tree, candidate tree, and the sorted changed-path manifest.
export const targetOf = (baseTree, candidateTree, manifest) =>
  sha256(JSON.stringify({ base_tree: baseTree, candidate_tree: candidateTree, manifest }))

export const subjectHashOf = ({ lineage, target, lens, manifest }) =>
  sha256(JSON.stringify({ lineage, target, lens, manifest_digest: manifestDigest(manifest) }))

// The refuter judges a batch of findings whose ids (F1, F2...) repeat across
// lineages, so its subject binds the lineage, target, and sorted batch ids.
export const refuterSubjectHashOf = ({ lineage, target, batchIds }) =>
  sha256(JSON.stringify({ lineage, target, lens: REFUTER, batch_ids: [...batchIds].sort() }))

export const newLineage = () => `review-${randomBytes(8).toString('hex')}`

export const LINEAGE = /^review-[0-9a-f]{16}$/

// assertLineage keeps an untrusted value from ever reaching a file path.
export function assertLineage(value) {
  if (typeof value !== 'string' || !LINEAGE.test(value)) {
    throw new Refusal('invalid_lineage', `lineage ${JSON.stringify(value)} is not of the form review-<16 hex characters>`)
  }
  return value
}

// canonicalLens accepts the short name (risk) or the canonical one (review-risk).
export function canonicalLens(name, extra = []) {
  const full = name.startsWith('review-') ? name : `review-${name}`
  if (![...CANONICAL_LENSES, ...extra].includes(full)) return null
  return full
}

// canonicalLenses parses a comma list into unique canonical lenses in canonical order.
export function canonicalLenses(list) {
  const parts = list.split(',').map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) return { error: '--lenses must name at least one lens' }
  const chosen = new Set()
  for (const part of parts) {
    const lens = canonicalLens(part)
    if (!lens) return { error: `unknown lens ${JSON.stringify(part)}; use ${CANONICAL_LENSES.join(', ')} or the short names` }
    chosen.add(lens)
  }
  return { lenses: CANONICAL_LENSES.filter((lens) => chosen.has(lens)) }
}
