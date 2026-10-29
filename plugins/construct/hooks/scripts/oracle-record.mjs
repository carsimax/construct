// SubagentStop hook for construct:oracle (S2 of .vault/tasks/oracle-separation.md): when an oracle stops, it
// records the git blob id of every file in its allowed edit surfaces (exact paths, admission denies globs)
// in the review store's oracles/ area, keyed by path, with the feature document and task of its Spec line.
// The gate (publication-gate.mjs) denies publishing when a locked file differs at the ref. Surfaces and Spec
// line are read from the agent's prompt (the first user row of its transcript), not from the admission
// record: delegation-admission's own stop hook runs in parallel and may already have removed that record.
// A path with an active lock (activeLocks) is kept untouched (release is a human unlock or a finished feature); a released lock is replaced.
// The reply's `## Envelope` section (envelope.mjs) is stored in the envelopes/ area, keyed by feature and task; like a lock it is
// kept while any lock of that task is active, and replaced otherwise.
// A surface that is a symlink or directory cannot be hashed as a file: it is locked with the UNLOCKABLE sentinel, which the gate always reports changed. Fails open: no output, exit 0.
// Usage: node oracle-record.mjs   (hook JSON on stdin)
import { lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnvelope } from './envelope.mjs'
import { firstUserPrompt, parseSurfaces } from './delegation-admission.mjs'
import { git, repositoryRoot } from './git-tree.mjs'
import { readInput } from './hook-io.mjs'
import { qualified } from './roles.mjs'
import { activeLocks } from './publication-gate.mjs'
import { UNLOCKABLE, UnreadableState, readEnvelope, writeEnvelope, writeOracle } from './review-store.mjs'

const SPEC = /^[ \t]*(?:[-*+][ \t]+)?Spec:[ \t]*`?(\.vault\/tasks\/[^\s,`()]+\.md)`?[^\n]*?\b(T\d+)\b/m

// replyOf: last_assistant_message, else the last assistant text of the agent's transcript.
function replyOf(input) {
  if (typeof input.last_assistant_message === 'string' && input.last_assistant_message.trim() !== '') return input.last_assistant_message
  let text = null
  for (const line of readFileSync(input.agent_transcript_path, 'utf8').split('\n')) {
    try {
      const parts = JSON.parse(line)?.type === 'assistant' ? JSON.parse(line).message?.content : null
      for (const part of Array.isArray(parts) ? parts : []) if (part?.type === 'text' && part.text?.trim()) text = part.text
    } catch {
      // not a JSON row
    }
  }
  return text
}

function main() {
  const input = readInput()
  if (!input || input.agent_type !== qualified('oracle') || typeof input.cwd !== 'string' || typeof input.agent_transcript_path !== 'string') return
  const prompt = firstUserPrompt(input.agent_transcript_path)
  const spec = prompt && SPEC.exec(prompt)
  const { paths } = prompt ? parseSurfaces(prompt) : {}
  if (!spec || !paths) return
  const root = repositoryRoot(input.cwd)
  // The gate verifies the release ref against the URL pinned here, not the config an agent can edit later.
  const remote = git(root, ['config', '--get', 'remote.origin.url'], { okStatuses: [0, 1] }).toString('utf8').trim()
  const active = activeLocks(root)
  const locked = new Set(active.map((o) => o.path))
  const envelope = parseEnvelope(replyOf(input))
  let kept = false
  try {
    kept = active.some((o) => o.feature === spec[1] && o.task === spec[2]) && readEnvelope(root, spec[1], spec[2])
  } catch (error) {
    // An unreadable envelope is replaced by this oracle's, so the task gets a readable one and the locks below still run.
    if (!(error instanceof UnreadableState)) throw error
  }
  if (envelope && !kept) writeEnvelope(root, { feature: spec[1], task: spec[2], ...envelope, at: Date.now() })
  for (const path of paths) {
    if (locked.has(path)) continue
    let stat
    try {
      stat = lstatSync(join(root, path))
    } catch {
      continue // an oracle that wrote nothing at this path locks nothing
    }
    const blob = stat.isFile() ? git(root, ['hash-object', `--path=${path}`, path]).toString('utf8').trim() : UNLOCKABLE
    writeOracle(root, { path, blob, feature: spec[1], task: spec[2], at: Date.now(), ...(remote && { remote }) })
  }
}

try {
  main()
} catch {
  // Fail open: no output, exit 0.
}
process.exitCode = 0
