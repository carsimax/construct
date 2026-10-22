// Risk line gate. `mark` (UserPromptSubmit) records the working-state tree at the
// start of a turn (kept across repeated events of the same prompt_id) and prints nothing, because stdout would enter the model's
// context. `check` (Stop) blocks the stop once per turn when paths outside
// odd/tasks/ changed and the final message has no Risk line. It fails open: any
// error, and every uncertain state, means no output and exit 0.
// Usage: node risk-line.mjs mark|check   (hook JSON on stdin)
import { mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataDir, hasOpenSubagents, pruneState, readInput, safeName } from './hook-io.mjs'

const MAX_PATHS = 3
// Code-shaped markers of a weakened verifier, matched on one added line. Anchored to the line
// start (TODO: a comment opener at the line start) so a string literal in a fixture does not match.
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
const TODO = /^\s*(?:\/\/|#|\/\*|\*|--)\s*TODO\b/
// Optional list marker (-, *, +, 1., 1)) and emphasis around the label and the
// value, then `none` or `item 1-6` that ends the line or is followed by
// whitespace or `(`; the space after the colon is optional.
const RISK_LINE = /^[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)?[*_`]*Risk[*_`]*:[*_`]*[ \t]*[*_`]*(?:none|item [1-6])[*_`]*(?=$|\s|\()/m

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
      path = text.startsWith('+++ b/') ? text.slice(6) : null
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
      previous = promptId ? readRecord(file) : null
    } catch {
      // A corrupt record is replaced.
    }
    if (previous && previous.root === root && previous.prompt_id === promptId) return
    write({ root, tree: freezeWorkingTree(root).candidateTree, blocked: false, ...(promptId ? { prompt_id: promptId } : {}) })
    return
  }

  const { candidateTree } = freezeWorkingTree(root)
  // A record from another repository, or an old one without a root, is not this turn's.
  if (record.root !== root || record.tree === candidateTree) return
  const paths = git(root, ['diff', '--no-renames', '--name-only', '-z', record.tree, candidateTree])
    .toString('utf8')
    .split('\0')
    .filter((path) => path !== '' && !path.startsWith('odd/tasks/'))
  if (paths.length === 0) return
  const riskMissing = !RISK_LINE.test(input.last_assistant_message)
  let hits = []
  try {
    hits = markerHits(git(root, ['-c', 'core.quotepath=off', 'diff', '-U0', record.tree, candidateTree]).toString('utf8'))
  } catch {
    // Fail open on the marker scan.
  }
  if (!riskMissing && hits.length === 0) return

  // One block per turn: the next Stop of this turn finds the record spent.
  write({ ...record, blocked: true })
  const list = (items) => items.slice(0, MAX_PATHS).join(', ') + (items.length > MAX_PATHS ? `, and ${items.length - MAX_PATHS} more` : '')
  const reasons = []
  if (riskMissing) {
    reasons.push(
      `Risk line missing: this turn changed ${list(paths)}. ` +
        'End the final message with one line, `Risk: item N (reason)` for a high-risk item 1-6, or `Risk: none`.',
    )
  }
  if (hits.length > 0) {
    reasons.push(`Verifier-weakening marker added: ${list(hits)}. Remove the marker, or explain in the final message why it must stay.`)
  }
  const reason = reasons.join(' ')
  process.stdout.write(`${JSON.stringify({ decision: 'block', reason })}\n`)
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
