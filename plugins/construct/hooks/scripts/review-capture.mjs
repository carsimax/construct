// SubagentStop hook for construct:review-* agents that review-context.mjs
// prepared: it takes the agent's report (its final reply, or the SubagentHandback
// message a background agent sends, read from its transcript), validates it
// against the pending record, and writes the verdict record. Only a surrounding
// code fence is removed; the JSON itself is never edited. A malformed or invalid
// reply blocks the stop with the reason, at most MAX_RETRIES times. Errors fail open.
// Usage: node review-capture.mjs   (hook JSON on stdin)
import { readFileSync } from 'node:fs'
import { atomicWrite, repositoryRoot } from './git-tree.mjs'
import { readInput } from './hook-io.mjs'
import { checkLensResult, clearPending, pendingRecords, writePending, writeVerdict } from './review-store.mjs'

const MAX_RETRIES = 2
const AGENT = /^construct:(review-[a-z]+)$/
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

const block = (reason) => process.stdout.write(`${JSON.stringify({ decision: 'block', reason })}\n`)

function main() {
  const input = readInput()
  const lens = AGENT.exec(input?.agent_type ?? '')?.[1]
  if (!lens || typeof input.cwd !== 'string') return
  const reply = replyOf(input)
  if (reply === null) return
  const root = repositoryRoot(input.cwd)
  const records = pendingRecords(root, lens)
  if (records.length === 0) return
  let parsed
  let malformed = null
  try {
    parsed = JSON.parse(unfence(reply))
  } catch {
    malformed = 'the reply is not a JSON object'
  }
  // Among several pending subjects take the one the reply names, else the newest spawn.
  const pending = records.find((record) => record.subject_hash === parsed?.subject_hash) ?? records[records.length - 1]
  const refusal = malformed ? { code: 'malformed_result', message: malformed } : checkLensResult(parsed, { subjectHash: pending.subject_hash, manifest: pending.manifest })
  if (refusal.code === undefined) {
    writeVerdict(root, { lens, subject_hash: pending.subject_hash, approved: refusal.approved, at: Date.now(), result: parsed })
    clearPending(root, pending)
    return
  }
  if (['malformed_result', 'invalid_result'].includes(refusal.code) && pending.attempts < MAX_RETRIES) {
    writePending(root, { ...pending, attempts: pending.attempts + 1 })
    block(
      `review-capture rejected your result (${refusal.code}): ${refusal.message}. ` +
        'Reply again with only the complete corrected JSON object for the same binding, with no code fence and no other text.',
    )
    return
  }
  clearPending(root, pending)
}

try {
  main()
} catch {
  // Fail open: no output, exit 0.
}
process.exitCode = 0
