// The review store, under the git common dir in construct-review/: pending lens
// records (written by review-context.mjs), one verdict record per subject and
// lens (written only by review-capture.mjs), and the lens result validation.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { atomicWrite, git } from './git-tree.mjs'

const SEVERITIES = ['BLOCKER', 'CRITICAL', 'WARNING', 'SUGGESTION']
const EVIDENCE_CLASSES = ['deterministic', 'inferential', 'insufficient']
const CAUSAL = ['introduced', 'behavior-activated', 'worsened', 'pre-existing', 'base-only', 'unknown']
const LOCATION = /^(.+):(\d+)(?:-(\d+))?$/

export const subjectHash = (baseTree, headTree) => createHash('sha256').update(`${baseTree}\n${headTree}`).digest('hex')

export function storeDir(root) {
  const common = git(root, ['rev-parse', '--git-common-dir']).toString('utf8').trim()
  return join(isAbsolute(common) ? common : join(root, common), 'construct-review')
}

const pendingFile = (root, lens, subject) => join(storeDir(root), 'pending', `${lens}.${subject}.json`)
const verdictFile = (root, subject, lens) => join(storeDir(root), 'verdicts', subject, `${lens}.json`)
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

export const writePending = (root, record) => atomicWrite(pendingFile(root, record.lens, record.subject_hash), `${JSON.stringify(record)}\n`)
export const clearPending = (root, record) => rmSync(pendingFile(root, record.lens, record.subject_hash), { force: true })

// pendingRecords lists the pending records of one lens, oldest first.
export function pendingRecords(root, lens) {
  const dir = join(storeDir(root), 'pending')
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const records = []
  for (const name of names) {
    if (!name.startsWith(`${lens}.`) || !name.endsWith('.json')) continue
    try {
      records.push(readJson(join(dir, name)))
    } catch {
      // Unreadable record: not a candidate.
    }
  }
  return records.sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
}

// A rejection stands: a later verdict for the same subject and lens never replaces it, so only a new
// subject (a new commit) can be approved.
export function writeVerdict(root, record) {
  const file = verdictFile(root, record.subject_hash, record.lens)
  if (existsSync(file) && readJson(file).approved !== true) return
  atomicWrite(file, `${JSON.stringify(record)}\n`)
}

// approvedLinks lists the approved verdicts of a lens that know their trees: [{ base_tree, head_tree }].
export function approvedLinks(root, lens) {
  const links = []
  let subjects = []
  try {
    subjects = readdirSync(join(storeDir(root), 'verdicts'))
  } catch {
    // No verdicts yet.
  }
  for (const subject of subjects) {
    try {
      const record = readJson(verdictFile(root, subject, lens))
      if (record.approved === true && record.base_tree && record.head_tree) links.push({ base_tree: record.base_tree, head_tree: record.head_tree })
    } catch {
      // No record for this lens.
    }
  }
  return links
}

// chainExists: do the approved links form a chain of subjects from tree `from` to tree `to`?
// One link is the one-subject chain; equal trees need no review.
export function chainExists(links, from, to) {
  const reached = new Set([from])
  for (const tree of reached) {
    for (const link of links) if (link.base_tree === tree) reached.add(link.head_tree)
  }
  return reached.has(to)
}

// readVerdicts returns the verdict records of a subject, keyed by lens.
export function readVerdicts(root, subject) {
  const dir = join(storeDir(root), 'verdicts', subject)
  const verdicts = {}
  try {
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.json')) verdicts[name.slice(0, -5)] = readJson(join(dir, name))
    }
  } catch {
    // No verdicts yet.
  }
  return verdicts
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const filled = (value) => typeof value === 'string' && value.trim() !== ''

// checkLensResult validates a lens report against its pending record. It returns
// { code, message } for the first problem, else { approved }: a completed
// inspection with no BLOCKER or CRITICAL finding.
export function checkLensResult(result, { subjectHash: subject, manifest }) {
  const bad = (message) => ({ code: 'invalid_result', message })
  const keys = (value, names, where) => {
    if (!isObject(value)) return bad(`${where} must be a JSON object`)
    for (const key of names) if (!Object.hasOwn(value, key)) return bad(`${where} is missing the field "${key}"`)
    for (const key of Object.keys(value)) if (!names.includes(key)) return bad(`${where} has the unknown field "${key}"`)
    return null
  }
  const stringList = (value, where, min) =>
    Array.isArray(value) && value.length >= min && value.every(filled) ? null : bad(`${where} must be an array of ${min > 0 ? 'at least one ' : ''}non-empty strings`)

  let problem = keys(result, ['subject_hash', 'inspection', 'findings', 'evidence'], 'the result')
  if (problem) return problem
  if (result.subject_hash !== subject) return bad(`subject_hash ${JSON.stringify(result.subject_hash)} does not match the bound subject for this lens`)
  problem = keys(result.inspection, ['status', 'paths'], 'inspection')
  if (problem) return problem
  if (!['completed', 'incomplete'].includes(result.inspection.status)) return bad('inspection.status must be "completed" or "incomplete"')
  const paths = result.inspection.paths
  if (!Array.isArray(paths) || !paths.every((path) => typeof path === 'string')) return bad('inspection.paths must be an array of strings')
  if (!Array.isArray(result.findings)) return bad('findings must be an array')
  problem = stringList(result.evidence, 'evidence', 1)
  if (problem) return problem
  if (result.inspection.status === 'incomplete') {
    return { code: 'incomplete_inspection', message: `the lens reported an incomplete inspection (${result.evidence.join('; ')}); relaunch the lens` }
  }
  if (new Set(paths).size !== paths.length) return bad('inspection.paths lists a path more than once')
  if (paths.length !== manifest.length || !manifest.every((path) => paths.includes(path))) {
    return bad('inspection.paths must equal the changed-path manifest exactly when the status is "completed"')
  }
  for (const [index, finding] of result.findings.entries()) {
    const where = `findings[${index}]`
    problem = keys(finding, ['location', 'severity', 'claim', 'evidence_class', 'causal_disposition', 'proof_refs'], where)
    if (problem) return problem
    const match = typeof finding.location === 'string' ? LOCATION.exec(finding.location) : null
    if (!match) return bad(`${where}.location must be path:line or path:start-end`)
    const [, path, from, to] = match
    const start = Number(from)
    const end = to === undefined ? start : Number(to)
    if (start < 1 || end < 1 || start > end) return bad(`${where}.location lines must be positive and ascending`)
    if (!manifest.includes(path)) return bad(`${where}.location path ${JSON.stringify(path)} is outside the changed paths`)
    if (!SEVERITIES.includes(finding.severity)) return bad(`${where}.severity must be one of ${SEVERITIES.join(', ')}`)
    if (!filled(finding.claim)) return bad(`${where}.claim must be a non-empty string`)
    if (!EVIDENCE_CLASSES.includes(finding.evidence_class)) return bad(`${where}.evidence_class must be one of ${EVIDENCE_CLASSES.join(', ')}`)
    if (!CAUSAL.includes(finding.causal_disposition)) return bad(`${where}.causal_disposition must be one of ${CAUSAL.join(', ')}`)
    problem = stringList(finding.proof_refs, `${where}.proof_refs`, 1)
    if (problem) return problem
  }
  return { approved: !result.findings.some((finding) => finding.severity === 'BLOCKER' || finding.severity === 'CRITICAL') }
}
