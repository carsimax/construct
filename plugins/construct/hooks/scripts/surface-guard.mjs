// Edit-surface guard (PreToolUse on Write, Edit, MultiEdit, NotebookEdit). A path with an active oracle lock (activeLocks) is denied to
// every agent and to the main thread (S4 of .vault/tasks/oracle-separation.md). A construct writer
// (agent_id present) may only write inside the `## Allowed edit surfaces` recorded at its launch
// by delegation-admission.mjs; the main thread may write under .vault/tasks/ at any size and
// elsewhere only a call that changes at most the session's inline limit (limits.mjs, set with
// construct-limits; default 150, 0 means .vault/tasks/ only), and sends bigger changes to construct:worker.
// While a feature document has an unfinished task (activeDocuments) the main thread writes only .vault/tasks/ (S4 of
// .vault/tasks/config-surface.md). Paths outside the git work tree, a cwd outside a repository, a subagent
// with no record, and any internal error pass (fail open, no output).
// shortcut: the record is paired to its agent by same-type FIFO at SubagentStart, so two
// same-type launches in flight may swap surfaces; Bash writes (sed -i, redirects) are not covered.
// Upgrade both if the host adds the prompt to SubagentStart or real use shows bypasses.
// Usage: node surface-guard.mjs   (hook JSON on stdin)
import { readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { activeDocuments, projectRoot } from './feature-state.mjs'
import { surfaceContains, writerRecord } from './delegation-admission.mjs'
import { repositoryRoot } from './git-tree.mjs'
import { readInput } from './hook-io.mjs'
import { readLimits } from './limits.mjs'
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

const textLines = (text) => (typeof text === 'string' && text !== '' ? text.replace(/\n$/, '').split('\n') : [])

// shortcut: a multiset line diff ignores line order, so a pure reordering counts as zero; upgrade
// to a real diff if that lets a large rewrite through.
function lineChanges(before, after) {
  const counts = new Map()
  for (const line of textLines(before)) counts.set(line, (counts.get(line) ?? 0) + 1)
  let added = 0
  for (const line of textLines(after)) {
    if (counts.get(line) > 0) counts.set(line, counts.get(line) - 1)
    else added++
  }
  return [added, [...counts.values()].reduce((a, b) => a + b, 0)]
}

const rewrittenLines = (before, after) => lineChanges(before, after).reduce((a, b) => a + b, 0)

// An Edit counts the larger of its added and removed lines; context lines kept unchanged do not count.
const editedLines = (old, next, file, all) => {
  const size = Math.max(...lineChanges(old, next))
  return all && old ? size * Math.max(1, file.split(old).length - 1) : size
}

// changedLines is how many lines one write call changes.
function changedLines(input, file) {
  const { tool_name: tool, tool_input: args } = input
  const current = () => { try { return readFileSync(file, 'utf8') } catch { return '' } }
  if (tool === 'Edit') return editedLines(args.old_string, args.new_string, args.replace_all ? current() : '', args.replace_all)
  if (tool === 'MultiEdit') return (args.edits ?? []).reduce((sum, e) => sum + editedLines(e.old_string, e.new_string, '', false), 0)
  if (tool === 'NotebookEdit') return textLines(args.new_source).length
  return rewrittenLines(current(), args.content)
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
  if (typeof input.agent_id === 'string' && input.agent_id !== '') {
    const entry = writerRecord(input.session_id, input.agent_id)
    if (!entry || entry.surfaces.some((surface) => surfaceContains(surface, rel))) return
    deny(`surface-guard: ${rel} is outside your allowed edit surfaces (${entry.surfaces.join(', ')}). Write only inside them, or return needs_interaction naming the path you need.`)
  } else if (!/^\.vault\/tasks\//.test(rel)) {
    let tracked = false
    try {
      tracked = activeDocuments(projectRoot(input.cwd)).length > 0
    } catch {
      // No feature documents readable: the inline limit applies.
    }
    if (tracked) {
      deny(`surface-guard: a feature document has unfinished tasks, so ${rel} is written by construct:worker, not inline. Delegate it with an Allowed edit surfaces section and a Spec line; only .vault/tasks/ is written inline.`)
      return
    }
    const limit = readLimits(input.session_id).inline
    const changed = changedLines(input, resolve(input.cwd, path))
    if (changed > limit) deny(`surface-guard: this call changes ${changed} lines of ${rel}, over the inline limit of ${limit} (set with construct-limits). Delegate it to construct:worker with an Allowed edit surfaces section.`)
  }
}

try {
  main()
} catch {
  // Fail open: no output, exit 0.
}
process.exitCode = 0
