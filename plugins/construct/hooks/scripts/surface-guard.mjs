// Edit-surface guard (PreToolUse on Write, Edit, MultiEdit, NotebookEdit). A path with an active oracle lock (activeLocks) is denied to
// every agent and to the main thread (S4 of .vault/tasks/oracle-separation.md). A construct writer
// (agent_id present) may only write inside the `## Allowed edit surfaces` recorded at its launch
// by delegation-admission.mjs; the main thread may write only under .vault/ and docs (isFree in envelope.mjs, S1 of
// .vault/tasks/oracle-limits.md), whatever the size: code goes through construct:oracle, then construct:worker.
// A subagent never writes under the plugin data dir (dataDir: writer records and guard state). Other paths outside the
// git work tree, a cwd outside a repository, a subagent with no record, and any internal error pass (fail open, no output).
// shortcut: the record is paired to its agent by same-type FIFO at SubagentStart, so two
// same-type launches in flight may swap surfaces; Bash writes (sed -i, redirects) are not covered.
// Upgrade both if the host adds the prompt to SubagentStart or real use shows bypasses.
// Usage: node surface-guard.mjs   (hook JSON on stdin)
import { realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { surfaceContains, writerRecord } from './delegation-admission.mjs'
import { repositoryRoot } from './git-tree.mjs'
import { isFree } from './envelope.mjs'
import { dataDir, readInput } from './hook-io.mjs'
import { activeLocks } from './publication-gate.mjs'
import { hasOracleFiles, readOracles } from './review-store.mjs'

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
  const subagent = typeof input.agent_id === 'string' && input.agent_id !== ''
  // The plugin data dir holds the writer records and guard state the guards read.
  const data = relative(real(dataDir()), real(resolve(input.cwd, path)))
  if (subagent && !(data === '..' || data.startsWith('../') || isAbsolute(data))) {
    deny(`surface-guard: ${path} is in the plugin data directory, which holds the writer records and guard state; a subagent never writes it. Ask the orchestrator instead.`)
    return
  }
  const root = real(repositoryRoot(input.cwd))
  const rel = relative(root, real(resolve(input.cwd, path)))
  if (rel === '' || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) return
  // A lock on a symlink or directory covers the target and what lies under it, by its stored and its canonical path.
  const raw = relative(root, resolve(input.cwd, path))
  const under = (p, l) => p === l || p.startsWith(`${l}/`)
  let locks = []
  try {
    if (hasOracleFiles(root)) locks = activeLocks(root)
  } catch {
    // Fail closed for this check only: every recorded lock counts as active; the rest of the guard still runs.
    try {
      locks = readOracles(root)
    } catch {
      // No lock readable: continue with the rest of the guard.
    }
  }
  const lock = locks.find((l) => [l.path, relative(root, real(join(root, l.path)))].some((p) => under(rel, p) || under(raw, p)))
  if (lock) {
    deny(`surface-guard: ${rel} is a locked oracle for ${lock.feature} (task ${lock.task}). Do not edit it: return \`oracle_conflict\` (path, test, spec) to the user, or ask them to unlock it with \`construct-gate oracle unlock ${rel}\`.`)
    return
  }
  if (subagent) {
    const entry = writerRecord(input.session_id, input.agent_id)
    if (!entry || entry.surfaces.some((surface) => surfaceContains(surface, rel))) return
    deny(`surface-guard: ${rel} is outside your allowed edit surfaces (${entry.surfaces.join(', ')}). Write only inside them, or return needs_interaction naming the path you need.`)
  } else if (!isFree(rel)) {
    deny(`surface-guard: ${rel} is code, and the main thread writes only under .vault/ and docs. Write a failing test with construct:oracle (it declares the envelope), then delegate the change to construct:worker with an Allowed edit surfaces section and a Spec line.`)
  }
}

try {
  main()
} catch {
  // Fail open: no output, exit 0.
}
process.exitCode = 0
