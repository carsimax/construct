// SubagentStop hook for construct:review-* agents that review-context.mjs
// prepared: pipe the agent's report (its final reply, or the SubagentHandback
// message a background agent sends, read from its transcript) to odd-review (capture,
// capture-refuter, or capture-validation), so no result is copied by hand. Only
// a surrounding code fence is removed; the JSON itself is never edited. A
// malformed or invalid reply blocks the stop with the validator's message, at
// most MAX_RETRIES times; any other answer lets the agent stop, and the
// orchestrator reads `odd-review status`. Errors fail open.
// Usage: node review-capture.mjs   (hook JSON on stdin)
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWrite } from '../../lib/review/store.mjs'
import { pendingDir, readInput, safeName } from './hook-io.mjs'

const ODD_REVIEW = new URL('../../bin/odd-review', import.meta.url).pathname
const MAX_RETRIES = 2
const RETRYABLE = new Set(['malformed_result', 'invalid_result'])

const FENCE = /^```[A-Za-z]*[ \t]*\r?\n([\s\S]*?)\r?\n```$/
const unfence = (text) => FENCE.exec(text.trim())?.[1] ?? text

// replyOf is the agent's report: last_assistant_message when it has text,
// otherwise, from the agent's transcript, the message of its last
// SubagentHandback call (how a background agent reports) or its last text.
function replyOf(input) {
  if (typeof input.last_assistant_message === 'string' && input.last_assistant_message.trim() !== '') return input.last_assistant_message
  if (typeof input.agent_transcript_path !== 'string') return null
  let handback = null
  let text = null
  for (const line of readFileSync(input.agent_transcript_path, 'utf8').split('\n')) {
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry?.type !== 'assistant' || !Array.isArray(entry.message?.content)) continue
    for (const part of entry.message.content) {
      if (!part || typeof part !== 'object') continue
      if (part.type === 'tool_use' && part.name === 'SubagentHandback' && typeof part.input?.message === 'string') handback = part.input.message
      if (part.type === 'text' && typeof part.text === 'string' && part.text.trim() !== '') text = part.text
    }
  }
  return handback ?? text
}

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

// pendingFor picks the pending record of the stopping agent: records are keyed by
// lens and lineage, so among several of one lens it takes the one whose
// subject_hash the reply carries, else the oldest.
function pendingFor(input, reply) {
  const dir = pendingDir(input.session_id)
  const prefix = `${safeName(input.agent_type)}.`
  const records = []
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(prefix) || !name.endsWith('.json')) continue
    try {
      const file = join(dir, name)
      records.push({ file, pending: JSON.parse(readFileSync(file, 'utf8')), at: statSync(file).mtimeMs })
    } catch {
      // Unreadable record: not a candidate.
    }
  }
  records.sort((a, b) => a.at - b.at || a.file.localeCompare(b.file))
  let subject
  try {
    subject = JSON.parse(unfence(reply))?.subject_hash
  } catch {
    // Not JSON: the oldest record takes the retry.
  }
  return records.find((record) => subject !== undefined && record.pending.subject_hash === subject) ?? records[0]
}

function main() {
  const input = readInput()
  if (typeof input?.agent_type !== 'string') return
  let reply
  try {
    reply = replyOf(input)
  } catch {
    return
  }
  if (reply === null) return
  let found
  try {
    found = pendingFor(input, reply)
  } catch {
    return
  }
  if (!found) return
  const { file, pending } = found
  const args = captureArgs(pending)
  const result = spawnSync('node', [ODD_REVIEW, '--cwd', pending.cwd, ...args, '--input', '-'], {
    input: unfence(reply),
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
