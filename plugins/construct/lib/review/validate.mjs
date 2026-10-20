// Strict validation of the three agent result shapes. Each validator returns a
// normalized object or throws a Refusal naming the first problem.
import { goTrimSpace } from '../assess/text.mjs'
import { Refusal } from './errors.mjs'

const SEVERITIES = ['BLOCKER', 'CRITICAL', 'WARNING', 'SUGGESTION']
const EVIDENCE_CLASSES = ['deterministic', 'inferential']
const CAUSAL = ['introduced', 'pre-existing', 'base-only', 'unknown']
const REFUTER_OUTCOMES = ['corroborated', 'refuted', 'inconclusive']
const VALIDATOR_OUTCOMES = ['resolved', 'unresolved', 'inconclusive']
const LOCATION = /^.+:\d+(-\d+)?$/

const invalid = (message) => new Refusal('invalid_result', message)
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const filled = (value) => typeof value === 'string' && goTrimSpace(value) !== ''

// exactKeys requires the object to have precisely the listed fields.
function exactKeys(value, keys, where) {
  if (!isObject(value)) throw invalid(`${where} must be a JSON object`)
  for (const key of keys) if (!Object.hasOwn(value, key)) throw invalid(`${where} is missing the field "${key}"`)
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw invalid(`${where} has the unknown field "${key}"`)
}

function stringList(value, where, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min || !value.every(filled)) {
    throw invalid(`${where} must be an array of ${min > 0 ? 'at least one ' : ''}non-empty string${min > 0 ? '' : 's'}`)
  }
  return value
}

function validateFinding(finding, index) {
  const where = `findings[${index}]`
  exactKeys(finding, ['location', 'severity', 'claim', 'evidence_class', 'causal_disposition', 'proof_refs'], where)
  if (typeof finding.location !== 'string' || !LOCATION.test(finding.location)) {
    throw invalid(`${where}.location must be path:line or path:start-end`)
  }
  if (!SEVERITIES.includes(finding.severity)) throw invalid(`${where}.severity must be one of ${SEVERITIES.join(', ')}`)
  if (!filled(finding.claim)) throw invalid(`${where}.claim must be a non-empty string`)
  if (!EVIDENCE_CLASSES.includes(finding.evidence_class)) throw invalid(`${where}.evidence_class must be one of ${EVIDENCE_CLASSES.join(', ')}`)
  if (!CAUSAL.includes(finding.causal_disposition)) throw invalid(`${where}.causal_disposition must be one of ${CAUSAL.join(', ')}`)
  stringList(finding.proof_refs, `${where}.proof_refs`, { min: 1 })
  return { ...finding }
}

// validateLensResult checks the lens contract of the review agents' Output
// section. A completed inspection must list exactly the manifest paths.
export function validateLensResult(result, { subjectHash, manifest }) {
  exactKeys(result, ['subject_hash', 'inspection', 'findings', 'evidence'], 'the result')
  if (result.subject_hash !== subjectHash) {
    throw invalid(`subject_hash ${JSON.stringify(result.subject_hash)} does not match the bound subject for this lens`)
  }
  exactKeys(result.inspection, ['status', 'paths'], 'inspection')
  if (!['completed', 'incomplete'].includes(result.inspection.status)) {
    throw invalid('inspection.status must be "completed" or "incomplete"')
  }
  if (!Array.isArray(result.inspection.paths) || !result.inspection.paths.every((path) => typeof path === 'string')) {
    throw invalid('inspection.paths must be an array of strings')
  }
  if (!Array.isArray(result.findings)) throw invalid('findings must be an array')
  stringList(result.evidence, 'evidence', { min: 1 })
  if (result.inspection.status === 'incomplete') {
    throw new Refusal(
      'incomplete_inspection',
      `the lens reported an incomplete inspection (${result.evidence.join('; ')}); the slot stays open: run the same context command and relaunch the lens`,
    )
  }
  const paths = result.inspection.paths
  if (new Set(paths).size !== paths.length) throw invalid('inspection.paths lists a path more than once')
  const expected = new Set(manifest)
  if (paths.length !== expected.size || !paths.every((path) => expected.has(path))) {
    throw invalid('inspection.paths must equal the changed-path manifest exactly when the status is "completed"')
  }
  return { ...result, findings: result.findings.map(validateFinding) }
}

// idSet requires one entry per expected id: no missing, extra, or duplicate ids.
function coverage(entries, expectedIds, where) {
  if (!Array.isArray(entries)) throw invalid(`${where} must be an array`)
  const seen = entries.map((entry) => entry?.finding_id)
  if (new Set(seen).size !== seen.length) throw invalid(`${where} repeats a finding_id`)
  const missing = expectedIds.filter((id) => !seen.includes(id))
  const extra = seen.filter((id) => !expectedIds.includes(id))
  if (missing.length > 0 || extra.length > 0) {
    throw invalid(`${where} must cover exactly the findings ${expectedIds.join(', ')} (missing: ${missing.join(', ') || 'none'}; unknown: ${extra.join(', ') || 'none'})`)
  }
}

function outcomes(entries, allowed, where) {
  entries.forEach((entry, index) => {
    exactKeys(entry, ['finding_id', 'outcome', 'proof_refs'], `${where}[${index}]`)
    if (!allowed.includes(entry.outcome)) throw invalid(`${where}[${index}].outcome must be one of ${allowed.join(', ')}`)
    stringList(entry.proof_refs, `${where}[${index}].proof_refs`, { min: 1 })
  })
}

export function validateRefuterResult(result, { subjectHash, expectedIds }) {
  exactKeys(result, ['subject_hash', 'results'], 'the refuter result')
  if (result.subject_hash !== subjectHash) {
    throw new Refusal('subject_mismatch', `subject_hash ${JSON.stringify(result.subject_hash)} does not match the refuter subject of this lineage`)
  }
  coverage(result.results, expectedIds, 'results')
  outcomes(result.results, REFUTER_OUTCOMES, 'results')
  return result
}

export function validateValidatorResult(result, { subjectHash, expectedIds }) {
  exactKeys(result, ['subject_hash', 'results', 'regressions'], 'the validator result')
  if (result.subject_hash !== subjectHash) {
    throw invalid(`subject_hash ${JSON.stringify(result.subject_hash)} does not match the corrected candidate`)
  }
  coverage(result.results, expectedIds, 'results')
  outcomes(result.results, VALIDATOR_OUTCOMES, 'results')
  if (!Array.isArray(result.regressions)) throw invalid('regressions must be an array')
  result.regressions.forEach((entry, index) => {
    exactKeys(entry, ['location', 'claim', 'proof'], `regressions[${index}]`)
    for (const key of ['location', 'claim', 'proof']) {
      if (!filled(entry[key])) throw invalid(`regressions[${index}].${key} must be a non-empty string`)
    }
  })
  return result
}
