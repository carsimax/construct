// SubagentStop hook for construct:oracle (S2 of odd/tasks/oracle-separation.md): when an oracle stops, it
// records the git blob id of every file in its allowed edit surfaces (exact paths, admission denies globs)
// in the review store's oracles/ area, keyed by path, with the feature document and task of its Spec line.
// The gate (publication-gate.mjs) denies publishing when a locked file differs at the ref. Surfaces and Spec
// line are read from the agent's prompt (the first user row of its transcript), not from the admission
// record: delegation-admission's own stop hook runs in parallel and may already have removed that record.
// An existing record for a path is kept untouched (release is a human unlock, not a new oracle run). Fails open: no output, exit 0.
// Usage: node oracle-record.mjs   (hook JSON on stdin)
import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import { firstUserPrompt, parseSurfaces } from './delegation-admission.mjs'
import { git, repositoryRoot } from './git-tree.mjs'
import { readInput } from './hook-io.mjs'
import { qualified } from './roles.mjs'
import { readOracles, writeOracle } from './review-store.mjs'

const SPEC = /^[ \t]*(?:[-*+][ \t]+)?Spec:[ \t]*`?(odd\/tasks\/[^\s,`()]+\.md)`?[^\n]*?\b(T\d+)\b/m

function main() {
  const input = readInput()
  if (!input || input.agent_type !== qualified('oracle') || typeof input.cwd !== 'string' || typeof input.agent_transcript_path !== 'string') return
  const prompt = firstUserPrompt(input.agent_transcript_path)
  const spec = prompt && SPEC.exec(prompt)
  const { paths } = prompt ? parseSurfaces(prompt) : {}
  if (!spec || !paths) return
  const root = repositoryRoot(input.cwd)
  const locked = new Set(readOracles(root).map((o) => o.path))
  for (const path of paths) {
    if (locked.has(path)) continue
    try {
      if (!lstatSync(join(root, path)).isFile()) continue
    } catch {
      continue // an oracle that wrote nothing at this path locks nothing
    }
    const blob = git(root, ['hash-object', `--path=${path}`, path]).toString('utf8').trim()
    writeOracle(root, { path, blob, feature: spec[1], task: spec[2], at: Date.now() })
  }
}

try {
  main()
} catch {
  // Fail open: no output, exit 0.
}
process.exitCode = 0
