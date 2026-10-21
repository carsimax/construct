// Review store write guard (PreToolUse on Write, Edit, MultiEdit, NotebookEdit, Bash). The review
// store (<git-common-dir>/construct-review/) is written only by the review hooks, so a file tool
// aimed inside it, or a Bash command that names `construct-review`, is denied. A heuristic guard:
// it fails open on unreadable input or outside a git repository.
// Usage: node review-store-guard.mjs   (hook JSON on stdin)
import { realpathSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { repositoryRoot } from './git-tree.mjs'
import { readInput } from './hook-io.mjs'
import { storeDir } from './review-store.mjs'

const REASON = 'review-store-guard: the review store (construct-review/ under the git directory) is written only by the review hooks. Run the construct:rdd-review skill to record a review; do not write verdicts or pending records yourself.'

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
  const rel = relative(real(store), real(resolve(input.cwd, path)))
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'))
}

function main() {
  const input = readInput()
  if (!input || typeof input.cwd !== 'string' || input.cwd === '' || typeof input.tool_name !== 'string') return
  const command = input.tool_input?.command
  let denied
  if (input.tool_name === 'Bash') denied = typeof command === 'string' && command.includes('construct-review')
  else if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(input.tool_name)) {
    denied = insideStore(input, storeDir(repositoryRoot(input.cwd)))
  } else return
  if (denied) process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: REASON } })}\n`)
}

try {
  main()
} catch {
  // Fail open: no output, exit 0.
}
process.exitCode = 0
