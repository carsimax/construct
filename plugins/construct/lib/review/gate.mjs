// validate --gate: the publication gate. Port of gentle-ai receipt.go `validate --gate`
// (pre-push, pre-pr, release; there is no pre-commit gate because Construct reviews
// committed work units) and the range logic of gentle-shell review-publication-gate.ts.
//
// The range being published is committed work only: BASE..HEAD (or --head-ref), where
// BASE is the merge-base of the published head with
//   --base-ref, else
//   pre-push: the upstream branch (@{upstream}), when the head is HEAD;
//   release:  the nearest tag reachable from the head, skipping --tag;
//   then (all gates): the first default-branch ref that is not the head
//   (origin/HEAD, main, master, origin/main, origin/master).
// No base at all is `no_base`: nothing to compare, so the gate allows. A sound receipt
// whose commit lies inside the range moves the base up to that commit, so reviewed
// work units are not judged again. The rest of the range is covered when an approved
// receipt has the published tree as its candidate tree and its integrity hashes still
// match its transaction (receipt_check ok); a due range without one fails.
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assessSnapshotRisk } from '../assess/classify.mjs'
import { createIsolation, git } from '../assess/git.mjs'
import { publicRisk } from '../assess/output.mjs'
import { Refusal } from './errors.mjs'
import { targetOf } from './identity.mjs'
import { readMode } from './mode.mjs'
import { checkReceipt } from './receipt.mjs'
import { readTransaction, storeDir } from './store.mjs'

export const GATES = ['pre-push', 'pre-pr', 'release']
const DEFAULT_BRANCH_REFS = ['origin/HEAD', 'main', 'master', 'origin/main', 'origin/master']
const text = (buffer) => buffer.toString('utf8').trim()

function commitOf(root, ref) {
  if (ref.startsWith('-')) return null
  const out = text(git(root, ['rev-parse', '--verify', '-q', `${ref}^{commit}`], { okStatuses: [0, 1, 128] }))
  return out === '' ? null : out
}

const treeOf = (root, commit) => text(git(root, ['rev-parse', `${commit}^{tree}`]))

const isAncestor = (root, ancestor, descendant) =>
  spawnSync('git', ['--no-replace-objects', '-C', root, 'merge-base', '--is-ancestor', ancestor, descendant], { stdio: 'ignore' }).status === 0

const mergeBase = (root, a, b) => {
  const out = text(git(root, ['merge-base', a, b], { okStatuses: [0, 1, 128] }))
  return out === '' ? null : out
}

function derivedBase(root, gate, head, headIsHead, tag) {
  const candidates = []
  if (gate === 'pre-push' && headIsHead) candidates.push(commitOf(root, '@{upstream}'))
  if (gate === 'release') {
    const args = ['describe', '--tags', '--abbrev=0', ...(tag ? ['--exclude', tag] : []), head]
    candidates.push(commitOf(root, text(git(root, args, { okStatuses: [0, 128] }))))
  }
  for (const ref of DEFAULT_BRANCH_REFS) {
    const tip = commitOf(root, ref)
    if (tip && tip !== head) candidates.push(tip)
  }
  for (const candidate of candidates) {
    if (!candidate) continue
    const base = mergeBase(root, candidate, head)
    if (base) return base
  }
  return null
}

// receiptState reads one receipt and says whether it is sound: approved, with a
// readable transaction whose recomputed hashes match (a legacy receipt is reported, not sound).
function receiptState(root, receipt) {
  if (receipt.outcome !== 'approved') return { status: 'not_approved', mismatched: [] }
  try {
    const { status, mismatched } = checkReceipt(root, readTransaction(root, receipt.lineage))
    return { status, mismatched }
  } catch {
    return { status: 'unreadable', mismatched: [] }
  }
}

// A legacy receipt (no hash fields) cannot prove its transaction is unchanged, so it is not sound.
const SOUND = new Set(['ok'])

function readReceipts(root) {
  const dir = join(storeDir(root), 'receipts')
  let names
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.json'))
  } catch {
    return []
  }
  const receipts = []
  for (const name of names) {
    try {
      const receipt = JSON.parse(readFileSync(join(dir, name), 'utf8'))
      if (receipt && typeof receipt === 'object') receipts.push(receipt)
    } catch {
      // An unreadable receipt covers nothing.
    }
  }
  return receipts
}

export function validateGate({ root, gate, baseRef, headRef, tag }) {
  const mode = readMode(root)
  const done = (reason, extra = {}) => ({ ok: true, result: 'ok', gate, reason, ...extra })
  if (mode.mode === 'off') return done('rdd_off')

  const head = commitOf(root, headRef ?? 'HEAD')
  if (!head) {
    if (headRef !== undefined) throw new Refusal('bad_ref', `--head-ref ${JSON.stringify(headRef)} does not name a commit`)
    return done('no_commits')
  }
  let base
  if (baseRef !== undefined) {
    base = commitOf(root, baseRef)
    if (!base) throw new Refusal('bad_ref', `--base-ref ${JSON.stringify(baseRef)} does not name a commit`)
    base = mergeBase(root, base, head)
  } else {
    base = derivedBase(root, gate, head, headRef === undefined || headRef === 'HEAD', tag)
  }
  if (!base) return done('no_base', { head })

  const receipts = readReceipts(root).map((receipt) => ({ receipt, ...receiptState(root, receipt) }))
  // A sound receipt inside the range moves its start up: that work was reviewed. It moves the
  // start only when the receipt's base_commit is the start or an ancestor of it, so the receipt
  // covers everything from the start to its candidate; a receipt without base_commit, or one
  // that began later, is ignored. Repeat until nothing moves: receipts are read in any order.
  let start = base
  for (let moved = true; moved; ) {
    moved = false
    for (const { receipt, status } of receipts) {
      if (!SOUND.has(status) || typeof receipt.candidate_commit !== 'string' || typeof receipt.base_commit !== 'string') continue
      const commit = commitOf(root, receipt.candidate_commit)
      const from = commitOf(root, receipt.base_commit)
      if (commit && from && commit !== start && isAncestor(root, from, start) && isAncestor(root, start, commit) && isAncestor(root, commit, head)) {
        start = commit
        moved = true
      }
    }
  }
  const headTree = treeOf(root, head)
  const baseTree = treeOf(root, start)
  const range = { base: start, head }
  if (baseTree === headTree) return start === head && start !== base ? done('covered', { ...range, receipt: 'ok' }) : done('empty', range)

  const isolation = createIsolation(root)
  let assessment
  try {
    assessment = assessSnapshotRisk({ root, baseTree, candidateTree: headTree, isolation })
  } finally {
    isolation.cleanup()
  }
  if (assessment.changedPaths === 0 || publicRisk(assessment.level) !== 'high') return done('not_due', range)

  // A receipt that records its base_commit covers the range only when that base is the start
  // or an ancestor of it; one reviewing a later part (A..B) of an unreviewed range does not.
  // A receipt without base_commit (a working-tree review) is judged by its tree alone.
  const reachesStart = (receipt) => {
    if (typeof receipt.base_commit !== 'string') return true
    const from = commitOf(root, receipt.base_commit)
    return from !== null && isAncestor(root, from, start)
  }
  const sameTree = receipts.filter(({ receipt }) => receipt.candidate_tree === headTree && reachesStart(receipt))
  const sound = sameTree.find(({ status }) => SOUND.has(status))
  if (sound) return done('covered', { ...range, receipt: sound.status, lineage: sound.receipt.lineage })

  const worst = sameTree[0]
  const receiptStatus = worst ? worst.status : 'none'
  const why = worst
    ? `a receipt exists for this tree but is not sound (${receiptStatus}${worst.mismatched.length ? `: ${worst.mismatched.join(', ')}` : ''})`
    : 'no approved receipt covers this tree'
  throw new Refusal(
    'review_required',
    `${gate}: ${start.slice(0, 12)}..${head.slice(0, 12)} changes ${assessment.changedPaths} path(s) at high risk and ${why}. ` +
      `Next step: load the construct:rdd-review skill and run \`odd-review start --base-ref ${start.slice(0, 12)} --committed-only\`, ` +
      'then acknowledge the approved review; or ask the user to skip the review (`odd-review mode disable`).',
    { gate, base: start, head, tree: headTree, target: targetOf(baseTree, headTree, assessment.manifest), risk: 'high', receipt: receiptStatus, ...(worst?.mismatched.length ? { mismatched: worst.mismatched } : {}) },
  )
}
