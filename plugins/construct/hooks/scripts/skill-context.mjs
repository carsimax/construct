// Prints the real repository state a skill injects at load time (Claude Code `!` command line).
// Read-only and fail-soft: always exit 0 (a non-zero exit aborts the whole skill), at most MAX
// characters, any failure becomes one `(state unavailable: <reason>)` line.
// Usage: node skill-context.mjs <workflow|review|delivery>
import { spawnSync } from 'node:child_process'
import { activeDocuments } from './feature-state.mjs'
import { commitSliceReport, defaultBranch, git } from './delivery-signals.mjs'
import { reviewState } from './publication-gate.mjs'

const MAX = 1500
const MAX_STATUS_LINES = 12
const MAX_TASK_LINES = 10

const TRUNCATED = '… (truncated)'
// MAX counts the trailing newline too.
const clip = (text) => (text.length + 1 > MAX ? `${text.slice(0, MAX - 1 - TRUNCATED.length)}${TRUNCATED}` : text)

// Unlike delivery-signals' git, this keeps the leading space of the first status line.
function status(cwd) {
  const run = spawnSync('git', ['--no-optional-locks', 'status', '--short'], { cwd, encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] })
  if (run.error || run.status !== 0) throw new Error('git status failed')
  return run.stdout.split('\n').filter(Boolean)
}

// Tasks first: a clip cuts the tail, and a long working tree must not push the open tasks out.
function workflow(cwd, root) {
  let changes
  try {
    const lines = status(cwd)
    const shown = lines.slice(0, MAX_STATUS_LINES).map((l) => (l.length > 100 ? `${l.slice(0, 99)}…` : l))
    changes = lines.length === 0 ? ['Working tree: clean'] : ['Working tree:', ...shown, ...(lines.length > shown.length ? [`(+${lines.length - shown.length} more)`] : [])]
  } catch (error) {
    changes = [`Working tree: unavailable (${error.message})`]
  }
  let docs = []
  try {
    docs = activeDocuments(root)
  } catch {
    // No odd/tasks directory: no feature documents.
  }
  if (docs.length === 0) return ['No unfinished feature tasks.', ...changes]
  const tasks = docs.slice(0, 3).flatMap(({ doc }) => [doc.path, ...doc.rows.slice(0, MAX_TASK_LINES).map((r) => `- ${r.length > 120 ? `${r.slice(0, 119)}…` : r}`), ...(doc.rows.length > MAX_TASK_LINES ? [`- (+${doc.rows.length - MAX_TASK_LINES} more unfinished)`] : [])])
  return ['Unfinished tasks:', ...tasks, ...changes]
}

// The same read-only review state the publication gate judges (reviewState), for HEAD against the default branch.
function review(cwd, root) {
  const branch = git(cwd, ['symbolic-ref', '-q', '--short', 'HEAD'])
  const base = defaultBranch(root)
  if (!base) throw new Error('no default branch (origin/HEAD, origin or local main or master)')
  const target = base.replace(/^refs\/(remotes\/|heads\/)/, '')
  // The gate's own refusal (refVerdict): a local default branch with nothing remote to compare it with.
  if (base.startsWith('refs/heads/') && git(cwd, ['rev-parse', '--symbolic-full-name', 'HEAD']) === base) {
    return [`${target} is the default branch and no remote-tracking default branch exists to compare it with (fetch origin, or publish a branch), so its review state cannot be checked.`]
  }
  const { mergeBase, items, required, state } = reviewState(root, base, git(cwd, ['rev-parse', 'HEAD']))
  const head = `Branch ${branch ?? '(detached HEAD)'} against ${target}:`
  if (required.length === 0) return [head, 'no review required (no Risk items in the feature documents changed on this branch).']
  const label = { ok: 'approved', rejected: 'rejected', missing: 'missing' }
  return [head, `Risk items ${[...items].sort().join(', ')}; required lenses for HEAD (Review subject: ${mergeBase}):`, ...required.map((lens) => `- ${lens}: ${label[state(lens)]}`)]
}

function delivery(cwd) {
  return [commitSliceReport(cwd) ?? 'Commit slice: no commits ahead of the default branch (or on it), nothing to measure.']
}

const KINDS = { workflow, review, delivery }

function main() {
  const kind = process.argv[2]
  if (!Object.hasOwn(KINDS, kind)) throw new Error(`unknown kind ${JSON.stringify(kind)} (expected workflow, review, or delivery)`)
  const cwd = process.cwd()
  const top = git(cwd, ['rev-parse', '--show-toplevel'])
  if (!top) throw new Error('not a git repository')
  return KINDS[kind](cwd, top).join('\n')
}

let text
try {
  text = main()
} catch (error) {
  text = `(state unavailable: ${String(error.message).split('\n')[0]})`
}
process.stdout.write(`${clip(text)}\n`)
process.exitCode = 0
