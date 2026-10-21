// Review store write guard (PreToolUse on Write, Edit, MultiEdit, NotebookEdit, Bash). The review
// store (<git-common-dir>/construct-review/) is written only by the review hooks, so a file tool
// aimed inside it, or a Bash command that names `construct-review`, `review-capture`, or
// `review-context` once quotes, backslashes, and brackets are removed, is denied. A heuristic
// guard: it fails open on unreadable input or outside a git repository.
// shortcut: a name built indirectly (variables, concatenation, base64) or reached through an
// interpreter (`node -e`) is not seen; upgrade if that shows up in real use.
// Usage: node review-store-guard.mjs   (hook JSON on stdin)
import { realpathSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { git } from './git-tree.mjs'
import { readInput } from './hook-io.mjs'
import { storeAt } from './review-store.mjs'

const REASON = 'review-store-guard: the review store (construct-review/ under the git directory) is written only by the review hooks, which only the harness runs. Run the construct:rdd-review skill to record a review; do not write verdicts or pending records yourself.'

// real resolves symlinks in the deepest existing ancestor and appends the rest.
function real(path) {
  try {
    return realpathSync(path)
  } catch {
    return join(real(dirname(path)), path.slice(dirname(path).length))
  }
}

function insideStore(input, store) {
  const path = input.tool_input?.file_path ?? input.tool_input?.notebook_path
  if (typeof path !== 'string' || path === '') return false
  // macOS volumes are case-insensitive, so `.git/CONSTRUCT-REVIEW` is the store.
  const rel = relative(real(store).toLowerCase(), real(resolve(input.cwd, path)).toLowerCase())
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'))
}

function main() {
  const input = readInput()
  if (!input || typeof input.cwd !== 'string' || input.cwd === '' || typeof input.tool_name !== 'string') return
  const command = input.tool_input?.command
  let denied
  if (input.tool_name === 'Bash') denied = typeof command === 'string' && /construct-review|review-capture|review-context/i.test(command.replace(/["'\\\[\]]/g, ''))
  else if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(input.tool_name)) {
    // One git call; a relative common dir is relative to cwd.
    const common = git(input.cwd, ['rev-parse', '--git-common-dir']).toString('utf8').trim()
    denied = insideStore(input, storeAt(common, input.cwd))
  } else return
  if (denied) process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: REASON } })}\n`)
}

try {
  main()
} catch {
  // Fail open: no output, exit 0.
}
process.exitCode = 0
