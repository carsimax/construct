// Stop hook: when a high-risk candidate has no review receipt, block the stop once
// per session and target with a reminder to run the review flow. With the `baseline`
// argument (SessionStart) it records the candidates that already exist and prints
// nothing; the Stop check stays silent for those. It fails open:
// any error, and every uncertain state, means no output and exit 0.
// Usage: node review-gate.mjs [baseline]   (hook JSON on stdin: session_id, cwd, stop_hook_active)
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir, hasOpenSubagents, readInput, safeName } from './hook-io.mjs'

const MAX_REASONS = 3

const reminderFile = (session) => {
  const dir = join(dataDir(), 'review-gate')
  return { dir, file: join(dir, `${safeName(session)}.json`) }
}

// readReminders returns the record ({targets, baseline}); a corrupt file throws (fail open).
function readReminders(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return { targets: [], baseline: [] }
    throw error
  }
  const parsed = JSON.parse(text)
  if (!Array.isArray(parsed?.targets) || (parsed.baseline !== undefined && !Array.isArray(parsed.baseline))) throw new Error('unexpected reminder file')
  return { targets: parsed.targets, baseline: parsed.baseline ?? [] }
}

async function main() {
  const mode = process.argv[2]
  const input = readInput()
  if (!input || typeof input.cwd !== 'string' || (mode !== undefined && mode !== 'baseline')) return
  if (mode === undefined) {
    if (input.stop_hook_active === true) return
    // Subagents may still be writing: every byte they change is a new target, so
    // wait and let the first Stop after they finish run the check.
    if (hasOpenSubagents(input.session_id)) return
  }

  const [{ repositoryRoot, createIsolation, freezeWorkingTree, resolveTree }, { assessSnapshotRisk }, { publicReasons, publicRisk },
    { targetOf }, { receiptExists, atomicWrite, openLineageTargets }, { readMode }, { headCommit, reviewBoundary }] = await Promise.all([
    import('../../lib/assess/git.mjs'),
    import('../../lib/assess/classify.mjs'),
    import('../../lib/assess/output.mjs'),
    import('../../lib/review/identity.mjs'),
    import('../../lib/review/store.mjs'),
    import('../../lib/review/mode.mjs'),
    import('../../lib/review/boundary.mjs'),
  ])

  let root
  try {
    root = repositoryRoot(input.cwd)
  } catch {
    return
  }
  const head = headCommit(root)
  if (!head) return
  if (readMode(root).mode === 'off') return

  const { dir, file } = reminderFile(input.session_id)
  const record = readReminders(file)

  const boundary = reviewBoundary(root)
  const candidates = []
  // A root boundary means no receipt and no default branch to diff against
  // (for example, the default branch of an existing repository): reviewing
  // its whole history at every Stop would be slow and always nag, so only
  // receipt and merge-base boundaries open a committed range.
  if (boundary.source !== 'root' && boundary.commit !== head) {
    candidates.push({
      label: `the committed range ${boundary.commit.slice(0, 12)}..${head.slice(0, 12)}`,
      verb: 'is',
      baseTree: resolveTree(root, boundary.commit),
      candidateTree: resolveTree(root, 'HEAD'),
    })
  }
  const working = freezeWorkingTree(root)
  if (working.baseTree !== working.candidateTree) candidates.push({ label: 'the uncommitted changes', verb: 'are', ...working })

  // A target with a review already in flight is not reminded: the consented
  // lineage will end in a receipt or an escalation.
  const inFlight = candidates.length > 0 && mode === undefined ? openLineageTargets(root) : new Set()
  const due = []
  for (const candidate of candidates) {
    const isolation = createIsolation(root)
    let assessment
    try {
      assessment = assessSnapshotRisk({ root, baseTree: candidate.baseTree, candidateTree: candidate.candidateTree, isolation })
    } finally {
      isolation.cleanup()
    }
    if (assessment.changedPaths === 0 || publicRisk(assessment.level) !== 'high') continue
    const target = targetOf(candidate.baseTree, candidate.candidateTree, assessment.manifest)
    if (receiptExists(root, target)) continue
    due.push({ candidate, target, assessment })
  }

  const write = (next) => {
    mkdirSync(dir, { recursive: true })
    atomicWrite(file, `${JSON.stringify(next)}\n`)
  }

  // SessionStart: the candidates that already exist predate this session, so the
  // Stop gate never reminds about them. A new baseline replaces the old one.
  if (mode === 'baseline') {
    write({ targets: record.targets, baseline: due.map(({ target }) => target) })
    return
  }

  for (const { candidate, target, assessment } of due) {
    if (inFlight.has(target) || record.targets.includes(target) || record.baseline.includes(target)) continue

    const reasons = publicReasons(assessment.reasons)
      .slice(0, MAX_REASONS)
      .map((reason) => (reason.path ? `${reason.code} (${reason.path})` : reason.code))
    const reason =
      `Review due: ${candidate.label} ${candidate.verb} high risk and ${candidate.verb === 'are' ? 'have' : 'has'} no review receipt. ` +
      `Reasons: ${reasons.join(', ')}. ` +
      'Next step: load the construct:rdd-review skill, ask the user for consent, or skip this review.'
    write({ targets: [...record.targets, target], baseline: record.baseline })
    process.stdout.write(`${JSON.stringify({ decision: 'block', reason })}\n`)
    return
  }
}

try {
  await main()
} catch {
  // Fail open: no output, exit 0.
}
process.exitCode = 0
