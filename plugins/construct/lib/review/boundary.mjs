// The last reviewed boundary of a repository: where the next committed range
// starts. Newest sound receipt whose candidate_commit is an ancestor of (or equal to)
// HEAD, else the merge-base with the default branch, else the root commit.
import { spawnSync } from 'node:child_process'
import { git } from '../assess/git.mjs'
import { Refusal } from './errors.mjs'
import { isSound, readReceipts, receiptState } from './receipt.mjs'

const text = (buffer) => buffer.toString('utf8').trim()

export function headCommit(root) {
  const out = text(git(root, ['rev-parse', '--verify', '-q', 'HEAD^{commit}'], { okStatuses: [0, 1] }))
  return out === '' ? null : out
}

const resolveCommit = (root, ref) => {
  const out = text(git(root, ['rev-parse', '--verify', '-q', `${ref}^{commit}`], { okStatuses: [0, 1, 128] }))
  return out === '' ? null : out
}

// merge-base --is-ancestor reports through its exit status only.
export function isAncestor(root, commit, descendant) {
  const result = spawnSync('git', ['--no-replace-objects', '-C', root, 'merge-base', '--is-ancestor', commit, descendant], { stdio: 'ignore' })
  return result.status === 0
}

// Only a sound receipt (the gate's rule) can set a boundary.
const receiptCandidates = (root) =>
  readReceipts(root)
    .filter((receipt) => typeof receipt.candidate_commit === 'string' && isSound(receiptState(root, receipt)))
    .sort((a, b) => String(b.acknowledged_at).localeCompare(String(a.acknowledged_at)))

// closestReceipt picks, among receipts whose commit is an ancestor of (or equal to)
// HEAD, the one every other candidate is an ancestor of, so a review of an older
// commit acknowledged later never moves the boundary backward. Receipts arrive
// newest-acknowledged first, which breaks ties (the same commit, or commits that
// are not ordered by ancestry).
function closestReceipt(root, head) {
  let best = null
  for (const receipt of receiptCandidates(root)) {
    const commit = resolveCommit(root, receipt.candidate_commit)
    if (!commit || !isAncestor(root, commit, head)) continue
    if (best === null || (commit !== best && isAncestor(root, best, commit))) best = commit
  }
  return best
}

const DEFAULT_BRANCH_REFS = ['origin/HEAD', 'main', 'master', 'origin/main', 'origin/master']

// The fixed names plus the configured init.defaultBranch (local and origin/), so a
// repository whose default is e.g. develop still has a base.
export function defaultBranchRefs(root) {
  const name = text(git(root, ['config', '--get', 'init.defaultBranch'], { okStatuses: [0, 1] }))
  return name === '' || name.startsWith('-') ? DEFAULT_BRANCH_REFS : [...DEFAULT_BRANCH_REFS, name, `origin/${name}`]
}

export function reviewBoundary(root) {
  const head = headCommit(root)
  if (!head) throw new Refusal('no_commits', 'the repository has no commits')
  const receipt = closestReceipt(root, head)
  if (receipt) return { commit: receipt, source: 'receipt' }
  for (const ref of defaultBranchRefs(root)) {
    const tip = resolveCommit(root, ref)
    if (!tip || tip === head) continue
    const base = text(git(root, ['merge-base', head, tip], { okStatuses: [0, 1] }))
    if (base && base !== head) return { commit: base, source: 'merge-base' }
  }
  const roots = text(git(root, ['rev-list', '--max-parents=0', head])).split('\n').filter(Boolean)
  return { commit: roots.at(-1), source: 'root' }
}
