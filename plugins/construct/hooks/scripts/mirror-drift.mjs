// Mirror drift gate (S8a). Stop hook: blocks the stop once per turn when an
// odd/tasks/<f>.md changed during the turn and the transcript, since the last real user
// prompt, holds no engram mem_save whose topic_key is odd/<f>/tasks. "Changed during the
// turn" is risk-line's per-turn tree record (`mark` on UserPromptSubmit) against the working
// tree now. Silent while subagents are open and on stop_hook_active; it fails open: any
// error, and every uncertain state (no record, no transcript, no prompt boundary in the
// transcript tail), means no output and exit 0.
// Usage: node mirror-drift.mjs   (Stop hook JSON on stdin)
import { closeSync, mkdirSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir, hasOpenSubagents, readInput, safeName } from './hook-io.mjs'
import { readRecord, recordFile } from './risk-line.mjs'

const SAVE_TOOLS = ['mcp__engram__mem_save', 'mcp__plugin_engram_engram__mem_save']
// Only the tail of the transcript is read.
// shortcut: a turn longer than this tail has no prompt boundary in view, so the gate stays silent, upgrade if long turns slip through.
const TAIL_BYTES = 512 * 1024
const DOC = /^odd\/tasks\/([^/]+)\.md$/

const topicKey = (feature) => `odd/${feature}/tasks`

const rowsOf = (path) => {
  const fd = openSync(path, 'r')
  try {
    const size = statSync(path).size
    const start = Math.max(0, size - TAIL_BYTES)
    const buffer = Buffer.alloc(size - start)
    readSync(fd, buffer, 0, buffer.length, start)
    const rows = buffer.toString('utf8').split('\n')
    // The first row of a tail that does not begin the file is cut mid-line.
    if (start > 0) rows.shift()
    return rows
  } finally {
    closeSync(fd)
  }
}

// A real user prompt: a user row that is not a tool result, a meta row, or a sidechain row.
const isPrompt = (row) => {
  if (row?.type !== 'user' || row.isMeta === true || row.isSidechain === true) return false
  const content = row.message?.content
  if (typeof content === 'string') return content !== ''
  return Array.isArray(content) && content.length > 0 && !content.some((part) => part?.type === 'tool_result')
}

// turnSince returns the id of the last real user prompt and the topic keys saved after it, or
// null when the tail holds no such prompt.
function turnSince(path) {
  const rows = rowsOf(path)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
  const at = rows.findLastIndex(isPrompt)
  if (at < 0) return null
  const saved = new Set()
  for (const row of rows.slice(at + 1)) {
    if (row?.type !== 'assistant' || !Array.isArray(row.message?.content)) continue
    for (const part of row.message.content) {
      if (part?.type === 'tool_use' && SAVE_TOOLS.includes(part.name) && typeof part.input?.topic_key === 'string') saved.add(part.input.topic_key)
    }
  }
  return { id: String(rows[at].uuid ?? rows[at].timestamp ?? at), saved }
}

async function main() {
  const input = readInput()
  if (!input || typeof input.cwd !== 'string' || typeof input.transcript_path !== 'string' || input.stop_hook_active === true) return
  if (hasOpenSubagents(input.session_id)) return

  const [{ repositoryRoot, freezeWorkingTree, git }, { headCommit }, { atomicWrite }] = await Promise.all([
    import('../../lib/assess/git.mjs'),
    import('../../lib/review/boundary.mjs'),
    import('../../lib/review/store.mjs'),
  ])
  let root
  try {
    root = repositoryRoot(input.cwd)
  } catch {
    return
  }
  if (!headCommit(root)) return

  const record = readRecord(recordFile(input.session_id).file)
  if (!record || record.root !== root) return
  const { candidateTree } = freezeWorkingTree(root)
  if (record.tree === candidateTree) return
  const features = git(root, ['diff', '--no-renames', '--diff-filter=AM', '--name-only', '-z', record.tree, candidateTree])
    .toString('utf8')
    .split('\0')
    .map((path) => DOC.exec(path)?.[1])
    .filter(Boolean)
  if (features.length === 0) return

  const turn = turnSince(input.transcript_path)
  if (!turn) return
  const missing = features.filter((feature) => !turn.saved.has(topicKey(feature)))
  if (missing.length === 0) return

  // One block per turn: the next Stop of this turn finds the prompt's id spent.
  const dir = join(dataDir(), 'mirror-drift')
  const file = join(dir, `${safeName(input.session_id)}.json`)
  try {
    if (JSON.parse(readFileSync(file, 'utf8')).turn === turn.id) return
  } catch {
    // No marker yet.
  }
  mkdirSync(dir, { recursive: true })
  atomicWrite(file, `${JSON.stringify({ turn: turn.id })}\n`)

  const named = missing.map((feature) => `odd/tasks/${feature}.md (topic_key \`${topicKey(feature)}\`)`).join(', ')
  const reason =
    `Mirror drift: this turn changed ${named} and engram holds no matching save. ` +
    'Call engram mem_save with that topic_key and the changed state, then finish.'
  process.stdout.write(`${JSON.stringify({ decision: 'block', reason })}\n`)
}

try {
  await main()
} catch {
  // Fail open: no output, exit 0.
}
process.exitCode = 0
