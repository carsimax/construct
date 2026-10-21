// The ODD_REVIEW_BINDING line and ODD_REVIEW_CONTEXT block served to an agent.
// Everything comes from the frozen trees through the isolated git runner, so
// neither the live worktree nor user git configuration can change the evidence.
import { readFileSync } from 'node:fs'
import { git } from '../assess/git.mjs'
import { collectDiffStats } from '../assess/stats.mjs'
import { Refusal } from './errors.mjs'

const CHECKLIST_PATH = new URL('../../skills/rdd-review/references/security-checklist.md', import.meta.url)

// Static plugin text for the risk lens only. A missing file refuses, like the
// other missing inputs (manifest_mismatch): the lens never reviews without it.
function securityChecklist() {
  try {
    const text = readFileSync(CHECKLIST_PATH, 'utf8')
    return text.endsWith('\n') ? text : `${text}\n`
  } catch {
    throw new Refusal('checklist_unavailable', 'the security checklist of the risk lens could not be read from the plugin')
  }
}

export const DEFAULT_CONTEXT_BYTES = 400 * 1024

const DIFF_FLAGS = ['--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--ignore-submodules=none']

function nameStatus(root, baseTree, candidateTree, isolation) {
  const records = git(root, ['diff', '--name-status', '-z', ...DIFF_FLAGS, baseTree, candidateTree, '--'], { env: isolation.env })
    .toString('utf8').split('\0')
  const lines = []
  for (let index = 0; index + 1 < records.length; index += 2) lines.push(`${records[index]}\t${records[index + 1]}`)
  return lines
}

const patchOf = (root, baseTree, candidateTree, path, isolation) => {
  const text = git(root, ['diff', ...DIFF_FLAGS, baseTree, candidateTree, '--', `:(literal)${path}`], { env: isolation.env }).toString('utf8')
  return text.endsWith('\n') ? text : `${text}\n`
}

// buildContext returns the complete text for one lens. findings, when given, is
// appended as one ODD_REVIEW_FINDINGS line (refuter and validator inputs).
export function buildContext({ root, isolation, baseTree, candidateTree, manifest, lineage, lens, subjectHash, findings, maxBytes, requestContext }) {
  const stats = collectDiffStats(root, baseTree, candidateTree, isolation)
  const paths = stats.map((stat) => stat.path)
  if (paths.length !== manifest.length || !paths.every((path, index) => path === manifest[index])) {
    throw new Refusal('manifest_mismatch', 'the frozen trees no longer produce the recorded changed-path manifest')
  }
  const binding = {
    lineage,
    lens,
    subject_hash: subjectHash,
    artifact_subject: { subject_hash: subjectHash, base_tree: baseTree, candidate_tree: candidateTree, changed_path_manifest: manifest },
  }
  const lines = [
    `ODD_REVIEW_BINDING ${JSON.stringify(binding)}`,
    'ODD_REVIEW_CONTEXT',
    `base_tree: ${baseTree}`,
    `candidate_tree: ${candidateTree}`,
    'name-status:',
    ...nameStatus(root, baseTree, candidateTree, isolation),
    'numstat:',
    ...stats.map((stat) => (stat.binary ? `-\t-\t${stat.path}` : `${stat.additions}\t${stat.deletions}\t${stat.path}`)),
  ]
  let text = `${lines.join('\n')}\n`
  if (requestContext) text += `ODD_REVIEW_REQUEST_CONTEXT ${JSON.stringify({ sha256: requestContext.sha256 })}\n${requestContext.text}${requestContext.text.endsWith('\n') ? '' : '\n'}ODD_REVIEW_REQUEST_CONTEXT_END\n`
  manifest.forEach((path, index) => {
    text += `ODD_REVIEW_PATH ${JSON.stringify({ index, path })}\n${patchOf(root, baseTree, candidateTree, path, isolation)}ODD_REVIEW_PATH_END ${index}\n`
  })
  if (lens === 'review-risk') text += `ODD_REVIEW_CHECKLIST_BEGIN\n${securityChecklist()}ODD_REVIEW_CHECKLIST_END\n`
  text += 'ODD_REVIEW_CONTEXT_END\n'
  if (findings) text += `ODD_REVIEW_FINDINGS ${JSON.stringify(findings)}\n`
  const bytes = Buffer.byteLength(text)
  if (bytes > maxBytes) {
    throw new Refusal(
      'context_budget_exceeded',
      `the review context is ${bytes} bytes, above the ${maxBytes} byte budget; split the change into smaller slices (commits), then start a new review of each slice`,
      { bytes, max_bytes: maxBytes },
    )
  }
  return text
}
