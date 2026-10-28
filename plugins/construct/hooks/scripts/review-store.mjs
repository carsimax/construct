// The review store, under the git common dir in construct-review/: pending lens
// records (written by review-context.mjs), one verdict record per subject and
// lens (written only by review-capture.mjs), and the lens result validation.
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { atomicWrite, git } from './git-tree.mjs'

const SEVERITIES = ['BLOCKER', 'CRITICAL', 'WARNING', 'SUGGESTION']
const EVIDENCE_CLASSES = ['deterministic', 'inferential', 'insufficient']
const CAUSAL = ['introduced', 'behavior-activated', 'worsened', 'pre-existing', 'base-only', 'unknown']
const LOCATION = /^(.+):(\d+)(?:-(\d+))?$/

export const subjectHash = (baseTree, headTree) => createHash('sha256').update(`${baseTree}\n${headTree}`).digest('hex')

// storeAt is the store of the git common dir `common`, a path relative to `base` or absolute.
export const storeAt = (common, base) => join(isAbsolute(common) ? common : join(base, common), 'construct-review')

const storeDir = (root) => storeAt(git(root, ['rev-parse', '--git-common-dir']).toString('utf8').trim(), root)

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

// A rejection stands: it always replaces the record, an approval is written with an exclusive
// create and so never replaces anything (a concurrent approval cannot overwrite a rejection), and
// only a new subject (a new commit) can be approved.
export function writeVerdict(root, record) {
  const file = verdictFile(root, record.subject_hash, record.lens)
  if (record.approved !== true) return atomicWrite(file, `${JSON.stringify(record)}\n`)
  mkdirSync(join(file, '..'), { recursive: true })
  try {
    writeFileSync(file, `${JSON.stringify(record)}\n`, { flag: 'wx' })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
}

// Oracle locks (oracle-record.mjs): one record per locked test path, { path, blob, feature, task, at }. oracle-record.mjs
// writes a path only when it has no active lock (activeLocks in publication-gate.mjs), so a record is replaced only once
// its feature is finished; the user's `construct-gate oracle unlock` removes one. Never pruned.
// A blob of UNLOCKABLE marks a path that cannot be hashed as a file (a symlink or directory): the gate always reports it changed.
export const UNLOCKABLE = 'unlockable'
const oracleFile = (root, path) => join(storeDir(root), 'oracles', `${createHash('sha256').update(path).digest('hex')}.json`)
export const writeOracle = (root, record) => atomicWrite(oracleFile(root, record.path), `${JSON.stringify(record)}\n`)

// oracleEntries lists every file of the oracles/ area as { name, record }; record is null when the file is unreadable or not a lock.
export function oracleEntries(root) {
  const dir = join(storeDir(root), 'oracles')
  const entries = []
  let names = []
  try {
    names = readdirSync(dir)
  } catch {
    // No locks yet.
  }
  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    let record = null
    try {
      const parsed = readJson(join(dir, name))
      if (typeof parsed?.path === 'string' && typeof parsed.blob === 'string' && typeof parsed.feature === 'string') record = parsed
    } catch {
      // Unreadable record: not a lock.
    }
    entries.push({ name, record })
  }
  return entries
}

// hasOracleFiles: false only when the store is provably empty without asking git (a plain `.git` directory with no oracles/*.json);
// anything else, a worktree or a linked `.git` file included, says true and leaves the answer to readOracles.
export function hasOracleFiles(root) {
  try {
    if (!statSync(join(root, '.git')).isDirectory()) return true
  } catch {
    return true // no .git entry at the root (GIT_DIR, core.worktree): only git knows where the store is
  }
  try {
    return readdirSync(join(storeAt('.git', root), 'oracles')).some((n) => n.endsWith('.json'))
  } catch (error) {
    return error?.code !== 'ENOENT'
  }
}

// readOracles lists the valid oracle lock records; a corrupt one is skipped (oracleEntries shows it).
export const readOracles = (root) => oracleEntries(root).flatMap((e) => (e.record ? [e.record] : []))

// removeOracle deletes the record of a locked path, or the file named `path` in the oracles/ area (a corrupt record); false when none.
export function removeOracle(root, path) {
  const named = oracleEntries(root).find((e) => e.name === path || e.name === `${path}.json`)
  const file = named ? join(storeDir(root), 'oracles', named.name) : oracleFile(root, path)
  try {
    statSync(file)
  } catch {
    return false
  }
  rmSync(file)
  return true
}

const MAX_AGE_MS = 30 * 24 * 3600 * 1000

// pruneStore removes pending and verdict records not touched for 30 days. One cheap pass; failures are ignored.
export function pruneStore(root) {
  try {
    const store = storeDir(root)
    const cutoff = Date.now() - MAX_AGE_MS
    const dirs = [join(store, 'pending'), ...readdirSync(join(store, 'verdicts')).map((subject) => join(store, 'verdicts', subject))]
    for (const dir of dirs) {
      try {
        // Read before the files go (removing one touches the directory); a directory another capture just made is new, so it stays.
        const stale = statSync(dir).mtimeMs < cutoff
        for (const name of readdirSync(dir)) if (statSync(join(dir, name)).mtimeMs < cutoff) rmSync(join(dir, name), { force: true })
        if (dir !== dirs[0] && stale) rmdirSync(dir)
      } catch {
        // A directory that is gone or not empty stays.
      }
    }
  } catch {
    // No store yet.
  }
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
