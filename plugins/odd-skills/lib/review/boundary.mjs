// The last reviewed boundary of a repository: where the next committed range
// starts. Newest receipt whose candidate_commit is an ancestor of (or equal to)
// HEAD, else the merge-base with the default branch, else the root commit.
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { git } from '../assess/git.mjs'
import { Refusal } from './errors.mjs'
import { storeDir } from './store.mjs'

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
function spawnStatus(root, commit, descendant) {
  const result = spawnSync('git', ['--no-replace-objects', '-C', root, 'merge-base', '--is-ancestor', commit, descendant], { stdio: 'ignore' })
  return result.status === 0
}

function receiptCandidates(root) {
  const dir = join(storeDir(root), 'receipts')
  let names
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.json'))
  } catch {
    return []
  }
  const found = []
  for (const name of names) {
    try {
      const receipt = JSON.parse(readFileSync(join(dir, name), 'utf8'))
      if (typeof receipt.candidate_commit === 'string') found.push(receipt)
    } catch {
      // An unreadable receipt cannot set a boundary.
    }
  }
  return found.sort((a, b) => String(b.acknowledged_at).localeCompare(String(a.acknowledged_at)))
}

// closestReceipt picks, among receipts whose commit is an ancestor of (or equal to)
// HEAD, the one every other candidate is an ancestor of, so a review of an older
// commit acknowledged later never moves the boundary backward. Receipts arrive
// newest-acknowledged first, which breaks ties (the same commit, or commits that
// are not ordered by ancestry).
function closestReceipt(root, head) {
  let best = null
  for (const receipt of receiptCandidates(root)) {
    const commit = resolveCommit(root, receipt.candidate_commit)
    if (!commit || !spawnStatus(root, commit, head)) continue
    if (best === null || (commit !== best && spawnStatus(root, best, commit))) best = commit
  }
  return best
}

const DEFAULT_BRANCH_REFS = ['origin/HEAD', 'main', 'master', 'origin/main', 'origin/master']

export function reviewBoundary(root) {
  const head = headCommit(root)
  if (!head) throw new Refusal('no_commits', 'the repository has no commits')
  const receipt = closestReceipt(root, head)
  if (receipt) return { commit: receipt, source: 'receipt' }
  for (const ref of DEFAULT_BRANCH_REFS) {
    const tip = resolveCommit(root, ref)
    if (!tip || tip === head) continue
    const base = text(git(root, ['merge-base', head, tip], { okStatuses: [0, 1] }))
    if (base && base !== head) return { commit: base, source: 'merge-base' }
  }
  const roots = text(git(root, ['rev-list', '--max-parents=0', head])).split('\n').filter(Boolean)
  return { commit: roots.at(-1), source: 'root' }
}
