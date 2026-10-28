// Limits record (PreToolUse on Bash): the main thread's `construct-limits set inline=<N> cap=<N>` is validated and written to
// dataDir()/limits/<session_id>.json (limits.mjs), and the context names the active limits; `show` from any agent reports them.
// A subagent's `set` records nothing (command-guard denies it). Never a permission decision. Unreadable input, text the shell
// parser rejects, or any other error: no output (fail open).
// Usage: node limits-record.mjs   (hook JSON on stdin)
import { readInput } from './hook-io.mjs'
import { isLimits, parseSet, readLimits, writeLimits } from './limits.mjs'
import { nestedLines, splitCommands } from './shell-words.mjs'

const MAX_DEPTH = 4

// limitsCalls lists each `construct-limits set|show` in a command line, including those in `sh -c`, `eval`, and substitutions.
function limitsCalls(command, depth = 0) {
  if (depth > MAX_DEPTH) return []
  const found = []
  for (const tokens of splitCommands(command)) {
    const words = tokens.filter((w) => !w.r).map((w) => w.t)
    const { at, lines } = nestedLines(words)
    for (const line of lines) found.push(...limitsCalls(line, depth + 1))
    // Only the command a line runs counts (after env-style wrappers), so `echo construct-limits set ...` records nothing.
    if (isLimits(words[at]) && (words[at + 1] === 'set' || words[at + 1] === 'show')) found.push({ sub: words[at + 1], args: words.slice(at + 2) })
  }
  return found
}

try {
  const input = readInput()
  const command = input?.tool_input?.command
  if (input?.tool_name === 'Bash' && typeof command === 'string' && typeof input.session_id === 'string' && input.session_id !== '') {
    const calls = limitsCalls(command)
    const notes = []
    for (const { sub, args } of calls) {
      if (sub === 'show') continue
      if (input.agent_id) notes.push('set ignored: only the main thread declares session limits')
      else {
        const { values, error } = parseSet(args)
        if (error) notes.push(`set rejected, nothing written: ${error}`)
        else {
          writeLimits(input.session_id, values)
          notes.push('set recorded')
        }
      }
    }
    if (calls.length > 0) {
      const now = readLimits(input.session_id)
      const additionalContext = `construct-limits: ${[...notes, `active limits inline=${now.inline} cap=${now.cap}`].join('; ')}`
      process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext } })}\n`)
    }
  }
} catch {
  // Fail open: the hook only records and reports.
}
process.exitCode = 0
