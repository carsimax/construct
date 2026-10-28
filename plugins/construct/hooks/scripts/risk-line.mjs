// Risk line gate. `mark` (UserPromptSubmit) records the working-state tree at the
// start of a turn (kept across repeated events of the same prompt_id) and prints nothing, because stdout would enter the model's
// context. `check` (Stop) blocks the stop once per turn when paths outside
// odd/tasks/ changed and the final message has no Risk line. It fails open: any
// error, and every uncertain state, means no output and exit 0. When the full hash of a repository
// runs out of its time budget, the record remembers it (`slow`) so later calls skip the full hash, and
// the user gets one `systemMessage` per session (`noticed`).
// The marker scan flags weakened-verifier markers and TODO comments, whole-line or trailing after code.
// Usage: node risk-line.mjs mark|check   (hook JSON on stdin)
import { mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataDir, hasOpenSubagents, pruneState, readInput, safeName } from './hook-io.mjs'

const MAX_PATHS = 3
// Code-shaped markers of a weakened verifier, matched on one added line. The test markers and a
// whole-line TODO are anchored to the line start, so a string literal in a fixture does not match them;
// a trailing TODO is not anchored, so a string literal containing ` // TODO` can match (see the TODO shortcut).
// shortcut: a template-literal fixture whose line starts with a marker still matches, upgrade with a real parser if it bites.
const MARKERS = [
  /^\s*(?:it|test|describe|context)\.(?:skip|only|todo)\(/,
  /^\s*x(?:it|describe)\(/,
  /^\s*(?:it|test|describe)\(.*\{\s*[^}]*\b(?:skip|only|todo)\s*:\s*true/,
  /^\s*@pytest\.mark\.skip(?!if)/,
  /^\s*t\.(?:Skip\(|Skipf\(|SkipNow\()/,
  /^\s*raise NotImplementedError/,
  /^\s*throw new Error\(['"`]Not implemented/,
]
// A comment-line TODO, or a trailing one: code, whitespace, `//` or `#`, then TODO (so `http://x`, `a#TODO` stay silent).
// shortcut: a string literal containing ` // TODO` may match, upgrade with a real parser if it bites.
const TODO = /^\s*(?:\/\/|#|\/\*|\*|--)\s*TODO\b|\S\s+(?:\/\/|#)\s*TODO\b/
// Optional list marker (-, *, +, 1., 1)) and emphasis around the label and the
// value, then `none`, `item 1-6`, or `items 2, 5` that ends the line or is followed by
// whitespace or `(`; the space after the colon is optional.
const RISK_LINE = /^[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)?[*_`]*Risk[*_`]*:[*_`]*[ \t]*[*_`]*(?:none|items? [1-6](?:,[ \t]*[1-6])*)[*_`]*(?=$|\s|\()/m

const NOTICE =
  'Construct: this repository is too large to hash fully within the time budget, so the Risk-line gate now trusts the git index stat cache and can miss a same-size rewrite whose mtime was restored.'

// A repository marked slow skips the full hash for this long, then the next snapshot tries it again.
const SLOW_RETRY_MS = 60 * 60 * 1000

// snapshot freezes the working tree, going straight to the index-seeded one for a repository the record
// marked slow until SLOW_RETRY_MS passed (a record without slow_at, from 12.0.2, is due), and returns the
// record fields to keep, the notice to show (once per session) and whether a retry ran.
function snapshot(freezeWorkingTree, root, record, now = Date.now()) {
  const slow = record?.slow === root
  const retry = slow && !(now - record.slow_at < SLOW_RETRY_MS)
  const frozen = freezeWorkingTree(root, { indexSeeded: slow && !retry })
  const noticed = record?.noticed === true
  const other = record?.slow && !slow ? { slow: record.slow, ...(record.slow_at ? { slow_at: record.slow_at } : {}) } : {}
  const slowKeep = frozen.degraded ? { slow: root, slow_at: retry || !slow ? now : record.slow_at } : other
  const keep = { ...slowKeep, ...(frozen.degraded || noticed ? { noticed: true } : {}) }
  return { frozen, keep, notice: frozen.degraded && !noticed ? NOTICE : null, retried: retry }
}

const recordFile = (session) => {
  const dir = join(dataDir(), 'risk-line')
  return { dir, file: join(dir, `${safeName(session)}.json`) }
}

// readRecord returns the turn's record or null when none exists; a corrupt file throws (fail open).
function readRecord(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  const parsed = JSON.parse(text)
  if (typeof parsed?.tree !== 'string') throw new Error('unexpected record file')
  return parsed
}

// markerHits returns `path:line` for each added line of a -U0 diff that carries a marker,
// skipping odd/tasks/ and Markdown.
function markerHits(diff) {
  const hits = []
  let path = null
  let line = 0
  for (const text of diff.split('\n')) {
    if (text.startsWith('+++ ')) {
      // git ends the header of a path with a space with a tab
      path = text.startsWith('+++ b/') ? text.slice(6).replace(/\t$/, '') : null
    } else if (text.startsWith('@@')) {
      line = Number(/\+(\d+)/.exec(text)?.[1] ?? 0)
    } else if (text.startsWith('+') && path !== null) {
      const code = text.slice(1)
      if (!path.startsWith('odd/tasks/') && !path.endsWith('.md') && (MARKERS.some((m) => m.test(code)) || TODO.test(code))) {
        hits.push(`${path}:${line}`)
      }
      line++
    }
  }
  return hits
}

async function main() {
  const mode = process.argv[2]
  const input = readInput()
  if (!input || typeof input.cwd !== 'string' || (mode !== 'mark' && mode !== 'check')) return
  if (mode === 'check' && (input.stop_hook_active === true || typeof input.last_assistant_message !== 'string')) return
  // Subagents may still be writing; the first Stop after they finish runs the check.
  if (mode === 'check' && hasOpenSubagents(input.session_id)) return

  const { dir, file } = recordFile(input.session_id)
  // Cheap exit first: a spent block needs no git. A Risk line no longer does, because markers
  // are blocked whatever the reply says.
  let record = null
  if (mode === 'check') {
    record = readRecord(file)
    if (!record || record.blocked === true) return
  }

  const { repositoryRoot, freezeWorkingTree, git, headCommit, atomicWrite } = await import('./git-tree.mjs')

  let root
  try {
    root = repositoryRoot(input.cwd)
  } catch {
    return
  }
  if (!headCommit(root)) return

  const write = (record) => {
    mkdirSync(dir, { recursive: true })
    atomicWrite(file, `${JSON.stringify(record)}\n`)
  }

  if (mode === 'mark') {
    try {
      pruneState()
    } catch {
      // Best effort.
    }
    // A task notification repeats UserPromptSubmit within one turn with the same prompt_id; the
    // turn's baseline (and its spent block) must survive it. Without a prompt_id every mark re-marks.
    const promptId = typeof input.prompt_id === 'string' && input.prompt_id !== '' ? input.prompt_id : null
    let previous = null
    try {
      previous = readRecord(file)
    } catch {
      // A corrupt record is replaced.
    }
    if (promptId && previous && previous.root === root && previous.prompt_id === promptId) return
    const { frozen, keep, notice } = snapshot(freezeWorkingTree, root, previous)
    write({ root, tree: frozen.candidateTree, blocked: false, ...keep, ...(promptId ? { prompt_id: promptId } : {}) })
    if (notice) process.stdout.write(`${JSON.stringify({ systemMessage: notice })}\n`)
    return
  }

  const { frozen, keep, notice, retried } = snapshot(freezeWorkingTree, root, record)
  const { candidateTree } = frozen
  const notify = () => {
    if (notice) process.stdout.write(`${JSON.stringify({ systemMessage: notice })}\n`)
  }
  // A record from another repository, or an old one without a root, is not this turn's.
  if (record.root !== root) return
  // slow and slow_at come only from keep, so a successful retry clears them in every later write.
  const { slow: _slow, slow_at: _slowAt, ...rest } = record
  const current = { ...rest, ...keep }
  if (notice || retried) write(current)
  if (record.tree === candidateTree) return notify()
  const paths = git(root, ['diff', '--no-renames', '--name-only', '-z', record.tree, candidateTree])
    .toString('utf8')
    .split('\0')
    .filter((path) => path !== '' && !path.startsWith('odd/tasks/'))
  if (paths.length === 0) return notify()
  const riskMissing = !RISK_LINE.test(input.last_assistant_message)
  let hits = []
  try {
    hits = markerHits(git(root, ['-c', 'core.quotepath=off', 'diff', '-U0', record.tree, candidateTree]).toString('utf8'))
  } catch {
    // Fail open on the marker scan.
  }
  if (!riskMissing && hits.length === 0) return notify()

  // One block per turn: the next Stop of this turn finds the record spent.
  write({ ...current, blocked: true })
  const list = (items) => items.slice(0, MAX_PATHS).join(', ') + (items.length > MAX_PATHS ? `, and ${items.length - MAX_PATHS} more` : '')
  const reasons = []
  if (riskMissing) {
    reasons.push(
      `Risk line missing: this turn changed ${list(paths)}. ` +
        'End the final message with one line, `Risk: item N (reason)` (or `Risk: items 2, 5 (reason)`) for high-risk items 1-6, or `Risk: none`.',
    )
  }
  if (hits.length > 0) {
    reasons.push(`Verifier-weakening marker added: ${list(hits)}. Remove the marker, or explain in the final message why it must stay.`)
  }
  const reason = reasons.join(' ')
  process.stdout.write(`${JSON.stringify({ decision: 'block', reason, ...(notice ? { systemMessage: notice } : {}) })}\n`)
}

// Run only as a script.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  try {
    await main()
  } catch {
    // Fail open: no output, exit 0.
  }
  process.exitCode = 0
}
