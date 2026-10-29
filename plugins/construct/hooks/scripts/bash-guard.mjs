// Bash guard (PreToolUse on Bash): one process for the three Bash checks. It reads the hook input
// once and applies review-store-guard, command-guard, and publication-gate in that order, printing
// the first denial exactly as that script prints it. Each script keeps its own error rules (a command
// the shell parser rejects is denied by all three; other errors fail open, except the publication
// gate's, which deny a publication), and shell-words.mjs parses each command text once for all three.
// The scripts stay runnable alone. The hook entry sets onFailure: "block", as the publication gate's did.
// Usage: node bash-guard.mjs   (hook JSON on stdin)
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { guard as commandGuard } from './command-guard.mjs'
import { readInput } from './hook-io.mjs'
import { guard as publicationGate } from './publication-gate.mjs'
import { guard as reviewStoreGuard } from './review-store-guard.mjs'

const GUARDS = [reviewStoreGuard, commandGuard, publicationGate]

// bashGuard returns the first denial reason of the three guards, or null.
export function bashGuard(input) {
  for (const guard of GUARDS) {
    const reason = guard(input)
    if (reason) return reason
  }
  return null
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const reason = bashGuard(readInput())
  if (reason) process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })}\n`)
  process.exitCode = 0
}
