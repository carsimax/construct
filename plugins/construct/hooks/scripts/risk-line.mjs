// Risk line gate. `mark` (UserPromptSubmit) records the working-state tree at the
// start of a turn and prints nothing, because stdout would enter the model's
// context. `check` (Stop) blocks the stop once per turn when paths outside
// odd/tasks/ changed and the final message has no Risk line. It fails open: any
// error, and every uncertain state, means no output and exit 0.
// Usage: node risk-line.mjs mark|check   (hook JSON on stdin)
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir, readInput, safeName } from './hook-io.mjs'

const MAX_PATHS = 3
// Optional list marker (-, *, +, 1., 1)) and emphasis around the label and the
// value, then `none` or `item 1-6`; the space after the colon is optional.
const RISK_LINE = /^[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)?[*_`]*Risk[*_`]*:[*_`]*[ \t]*[*_`]*(?:none|item [1-6])\b/m

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

async function main() {
  const mode = process.argv[2]
  const input = readInput()
  if (!input || typeof input.cwd !== 'string' || (mode !== 'mark' && mode !== 'check')) return
  if (mode === 'check' && (input.stop_hook_active === true || typeof input.last_assistant_message !== 'string')) return

  const [{ repositoryRoot, freezeWorkingTree, git }, { headCommit }, { atomicWrite }] = await Promise.all([
    import('../../lib/assess/git.mjs'),
    import('../../lib/review/boundary.mjs'),
    import('../../lib/review/store.mjs'),
  ])

  let root
  try {
    root = repositoryRoot(input.cwd)
  } catch {
    return
  }
  if (!headCommit(root)) return

  const { dir, file } = recordFile(input.session_id)
  const { candidateTree } = freezeWorkingTree(root)
  const write = (record) => {
    mkdirSync(dir, { recursive: true })
    atomicWrite(file, `${JSON.stringify(record)}\n`)
  }

  if (mode === 'mark') {
    write({ root, tree: candidateTree, blocked: false })
    return
  }

  const record = readRecord(file)
  // A record from another repository, or an old one without a root, is not this turn's.
  if (!record || record.root !== root || record.blocked === true || record.tree === candidateTree) return
  if (RISK_LINE.test(input.last_assistant_message)) return
  const paths = git(root, ['diff', '--no-renames', '--name-only', '-z', record.tree, candidateTree])
    .toString('utf8')
    .split('\0')
    .filter((path) => path !== '' && !path.startsWith('odd/tasks/'))
  if (paths.length === 0) return

  // One block per turn: the next Stop of this turn finds the record spent.
  write({ ...record, blocked: true })
  const named = paths.slice(0, MAX_PATHS).join(', ') + (paths.length > MAX_PATHS ? `, and ${paths.length - MAX_PATHS} more` : '')
  const reason =
    `Risk line missing: this turn changed ${named}. ` +
    'End the final message with one line, `Risk: item N (reason)` for a high-risk item 1-6, or `Risk: none`.'
  process.stdout.write(`${JSON.stringify({ decision: 'block', reason })}\n`)
}

try {
  await main()
} catch {
  // Fail open: no output, exit 0.
}
process.exitCode = 0
