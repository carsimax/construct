// Stop hook: when a high-risk candidate has no review receipt, block the stop once
// per session and target with a reminder to run the review flow. It fails open:
// any error, and every uncertain state, means no output and exit 0.
// Usage: node review-gate.mjs   (hook JSON on stdin: session_id, cwd, stop_hook_active)
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir, readInput, safeName } from './hook-io.mjs'

const MAX_REASONS = 3

const reminderFile = (session) => {
  const dir = join(dataDir(), 'review-gate')
  return { dir, file: join(dir, `${safeName(session)}.json`) }
}

// readReminders returns the reminded targets; a corrupt file throws (fail open).
function readReminders(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  const parsed = JSON.parse(text)
  if (!Array.isArray(parsed?.targets)) throw new Error('unexpected reminder file')
  return parsed.targets
}

async function main() {
  const input = readInput()
  if (!input || input.stop_hook_active === true || typeof input.cwd !== 'string') return

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
  const reminded = readReminders(file)

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
  const inFlight = candidates.length > 0 ? openLineageTargets(root) : new Set()
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
    if (receiptExists(root, target) || inFlight.has(target) || reminded.includes(target)) continue

    const reasons = publicReasons(assessment.reasons)
      .slice(0, MAX_REASONS)
      .map((reason) => (reason.path ? `${reason.code} (${reason.path})` : reason.code))
    const reason =
      `Review due: ${candidate.label} ${candidate.verb} high risk and ${candidate.verb === 'are' ? 'have' : 'has'} no review receipt. ` +
      `Reasons: ${reasons.join(', ')}. ` +
      'Next step: load the construct:rdd-review skill, ask the user for consent, or skip this review.'
    mkdirSync(dir, { recursive: true })
    atomicWrite(file, `${JSON.stringify({ targets: [...reminded, target] })}\n`)
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
