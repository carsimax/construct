// Edit-surface guard (PreToolUse on Write, Edit, MultiEdit, NotebookEdit). A construct writer
// (agent_id present) may only write inside the `## Allowed edit surfaces` recorded at its launch
// by delegation-admission.mjs; the main thread may only write under odd/tasks/ and sends code to
// construct:worker. Paths outside the git work tree, a cwd outside a repository, a subagent
// with no record, and any internal error pass (fail open, no output).
// shortcut: the record is paired to its agent by same-type FIFO at SubagentStart, so two
// same-type launches in flight may swap surfaces; Bash writes (sed -i, redirects) are not covered.
// Upgrade both if the host adds the prompt to SubagentStart or real use shows bypasses.
// Usage: node surface-guard.mjs   (hook JSON on stdin)
import { realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { surfaceContains, writerRecord } from './delegation-admission.mjs'
import { repositoryRoot } from './git-tree.mjs'
import { readInput } from './hook-io.mjs'

// real resolves symlinks in the deepest existing ancestor and appends the rest.
function real(path) {
  try {
    return realpathSync.native(path)
  } catch {
    return join(real(dirname(path)), path.slice(dirname(path).length))
  }
}

const deny = (reason) => process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })}\n`)

function main() {
  const input = readInput()
  if (!input || typeof input.cwd !== 'string' || input.cwd === '' || !/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(input.tool_name)) return
  const path = input.tool_input?.file_path ?? input.tool_input?.notebook_path
  if (typeof path !== 'string' || path === '') return
  const root = real(repositoryRoot(input.cwd))
  const rel = relative(root, real(resolve(input.cwd, path)))
  if (rel === '' || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) return
  if (typeof input.agent_id === 'string' && input.agent_id !== '') {
    const entry = writerRecord(input.session_id, input.agent_id)
    if (!entry || entry.surfaces.some((surface) => surfaceContains(surface, rel))) return
    deny(`surface-guard: ${rel} is outside your allowed edit surfaces (${entry.surfaces.join(', ')}). Write only inside them, or return needs_interaction naming the path you need.`)
  } else if (!/^odd\/tasks\//.test(rel)) {
    deny(`surface-guard: the main thread does not write code (${rel}). Delegate it to construct:worker with an Allowed edit surfaces section; only odd/tasks/ is written directly.`)
  }
}

try {
  main()
} catch {
  // Fail open: no output, exit 0.
}
process.exitCode = 0
