// SubagentStop hook for construct:oracle (S2 of odd/tasks/oracle-separation.md): when an oracle stops, it
// records the git blob id of every file in its allowed edit surfaces (exact paths, admission denies globs)
// in the review store's oracles/ area, keyed by path, with the feature document and task of its Spec line.
// The gate (publication-gate.mjs) denies publishing when a locked file differs at the ref. Surfaces and Spec
// line are read from the agent's prompt (the first user row of its transcript), not from the admission
// record: delegation-admission's own stop hook runs in parallel and may already have removed that record.
// A path with an active lock (activeLocks) is kept untouched (release is a human unlock or a finished feature); a released lock is replaced.
// A surface that is a symlink or directory cannot be hashed as a file: it is locked with the UNLOCKABLE sentinel, which the gate always reports changed. Fails open: no output, exit 0.
// Usage: node oracle-record.mjs   (hook JSON on stdin)
import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import { firstUserPrompt, parseSurfaces } from './delegation-admission.mjs'
import { git, repositoryRoot } from './git-tree.mjs'
import { readInput } from './hook-io.mjs'
import { qualified } from './roles.mjs'
import { activeLocks } from './publication-gate.mjs'
import { UNLOCKABLE, writeOracle } from './review-store.mjs'

const SPEC = /^[ \t]*(?:[-*+][ \t]+)?Spec:[ \t]*`?(odd\/tasks\/[^\s,`()]+\.md)`?[^\n]*?\b(T\d+)\b/m

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
  const locked = new Set(activeLocks(root).map((o) => o.path))
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
