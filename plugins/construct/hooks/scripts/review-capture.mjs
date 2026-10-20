// SubagentStop hook for construct:review-* agents that review-context.mjs
// prepared: pipe the agent's final reply to odd-review (capture,
// capture-refuter, or capture-validation), so no result is copied by hand. Only
// a surrounding code fence is removed; the JSON itself is never edited. A
// malformed or invalid reply blocks the stop with the validator's message, at
// most MAX_RETRIES times; any other answer lets the agent stop, and the
// orchestrator reads `odd-review status`. Errors fail open.
// Usage: node review-capture.mjs   (hook JSON on stdin)
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { atomicWrite } from '../../lib/review/store.mjs'
import { pendingFile, readInput } from './hook-io.mjs'

const ODD_REVIEW = new URL('../../bin/odd-review', import.meta.url).pathname
const MAX_RETRIES = 2
const RETRYABLE = new Set(['malformed_result', 'invalid_result'])

const FENCE = /^```[A-Za-z]*[ \t]*\r?\n([\s\S]*?)\r?\n```$/
const unfence = (text) => FENCE.exec(text.trim())?.[1] ?? text

function captureArgs({ lineage, lens }) {
  if (lens === 'review-refuter') return ['capture-refuter', '--lineage', lineage]
  if (lens === 'review-validator') return ['capture-validation', '--lineage', lineage]
  return ['capture', '--lineage', lineage, '--lens', lens]
}

function refusalOf(stderr) {
  try {
    return JSON.parse(stderr).error ?? {}
  } catch {
    return {}
  }
}

function main() {
  const input = readInput()
  if (typeof input?.agent_type !== 'string' || typeof input.last_assistant_message !== 'string') return
  const file = pendingFile(input.session_id, input.agent_type)
  let pending
  try {
    pending = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return
  }

  const args = captureArgs(pending)
  const result = spawnSync('node', [ODD_REVIEW, '--cwd', pending.cwd, ...args, '--input', '-'], {
    input: unfence(input.last_assistant_message),
    encoding: 'utf8',
    timeout: 25_000,
  })
  const refusal = result.status === 0 ? null : refusalOf(result.stderr)
  if (refusal && RETRYABLE.has(refusal.code) && pending.attempts < MAX_RETRIES) {
    atomicWrite(file, `${JSON.stringify({ ...pending, attempts: pending.attempts + 1 })}\n`)
    const reason =
      `odd-review ${args[0]} rejected your result (${refusal.code}): ${refusal.message}. ` +
      'Reply again with only the complete corrected JSON object for the same binding, with no code fence and no other text.'
    process.stdout.write(`${JSON.stringify({ decision: 'block', reason })}\n`)
    return
  }
  rmSync(file, { force: true })
}

try {
  main()
} catch {
  // Fail open: no output, exit 0.
}
process.exitCode = 0
