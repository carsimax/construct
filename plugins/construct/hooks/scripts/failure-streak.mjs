// Repeated-failure nudge (PostToolUseFailure): the 5th failure of one tool by one agent in one
// session within 10 minutes adds a note telling the model to change approach, then resets that
// counter. One file per agent and tool under dataDir()/failure-streak/<session>, written to a temp name and renamed.
// Interrupts are not failures. Never blocks: any error means no output, exit 0.
// shortcut: counting is per tool name, not per command, and concurrent failures of one agent may
// race (a lost update delays the nudge), upgrade if either proves noisy.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { dataDir, readInput, safeName } from './hook-io.mjs'

const LIMIT = 5
const WINDOW_MS = 10 * 60 * 1000

function main() {
  const input = readInput()
  if (!input || typeof input.tool_name !== 'string' || input.is_interrupt === true) return
  const dir = join(dataDir(), 'failure-streak', safeName(input.session_id))
  mkdirSync(dir, { recursive: true })
  const key = [input.agent_id || 'main', input.tool_name].map((v) => Buffer.from(String(v)).toString('base64url')).join('.') // '.' is outside base64url, so distinct pairs never share a file
  const file = join(dir, key)
  const now = Number(process.env.FAILURE_STREAK_NOW) || Date.now() // env only for tests
  let times = []
  try {
    times = JSON.parse(readFileSync(file, 'utf8')).filter((t) => now - t <= WINDOW_MS)
  } catch {
    // No state yet.
  }
  times.push(now)
  if (times.length >= LIMIT) {
    rmSync(file, { force: true })
    const additionalContext = `${input.tool_name} failed ${LIMIT} times in the last 10 minutes. Stop repeating the same approach: read the error, change strategy or report the blocker.`
    process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUseFailure', additionalContext } })}\n`)
    return
  }
  const temporary = join(dir, `.${key}.${randomBytes(6).toString('hex')}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify(times))
    renameSync(temporary, file)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

try {
  main()
} catch {
  // Fail open: no output, exit 0.
}
process.exitCode = 0
