// Iteration cap: a Bash command that already failed `iteration_cap` times (default 3) for one agent
// in one session is denied, so the agent stops and reports instead of looping. PostToolUseFailure
// counts, PostToolUse (a passing run) resets that command, so only consecutive failures count, PreToolUse denies, SubagentStop ends that agent's counters, UserPromptSubmit resets the main thread's.
// One file per agent under dataDir()/iteration-cap/<session>, written to a temp name and renamed.
// Interrupts are not failures. Never blocks on error: any error means no output, exit 0.
// shortcut: concurrent failures of one agent may race (a lost update delays the cap), upgrade if it matters.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { dataDir, readInput, safeName } from './hook-io.mjs'

const DEFAULT_CAP = 3
const REASON =
  'Iteration cap: this command already failed %N% times. Stop and report what you tried, the failure, and your hypothesis for the cause, then wait for direction. Never edit the test to make it pass.'

function cap() {
  const value = process.env.CLAUDE_PLUGIN_OPTION_ITERATION_CAP
  return typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) ? Number(value) : DEFAULT_CAP
}

function main() {
  const input = readInput()
  if (!input || typeof input.session_id !== 'string' || !input.session_id) return
  const dir = join(dataDir(), 'iteration-cap', safeName(input.session_id))
  const file = join(dir, Buffer.from(String(input.agent_id || 'main')).toString('base64url'))
  const event = input.hook_event_name
  if (event === 'SubagentStop' || event === 'UserPromptSubmit') {
    // SubagentStop ends the stopping agent; a prompt resets only the main thread.
    if (event === 'UserPromptSubmit' || input.agent_id) rmSync(event === 'UserPromptSubmit' ? join(dir, Buffer.from('main').toString('base64url')) : file, { force: true })
    return
  }
  if (input.tool_name !== 'Bash' || typeof input.tool_input?.command !== 'string') return
  // Keyed by a hash: a failing command can carry a secret inline, so its text is never stored.
  const command = createHash('sha256').update(input.tool_input.command.trim().split(/\s+/).join(' ')).digest('hex')
  let counts = {}
  try {
    counts = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    // No state yet.
  }
  if (event === 'PreToolUse') {
    const limit = cap()
    if (limit > 0 && (counts[command] || 0) >= limit) {
      const permissionDecisionReason = REASON.replace('%N%', String(counts[command]))
      process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason } })}\n`)
    }
    return
  }
  if (event === 'PostToolUse') {
    if (!(command in counts)) return
    delete counts[command]
  } else if (event === 'PostToolUseFailure' && input.is_interrupt !== true) {
    counts[command] = (counts[command] || 0) + 1
  } else return
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const temporary = join(dir, `.${randomBytes(6).toString('hex')}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify(counts), { mode: 0o600 })
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
