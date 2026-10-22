// Emits the Construct always-on contract as hook additionalContext.
// Usage: node contract.mjs session|subagent  (hook JSON on stdin)
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { kindOf } from './roles.mjs'

const KINDS = {
  session: { event: 'SessionStart', file: 'session.md' },
  subagent: { event: 'SubagentStart', file: 'subagent.md' },
}

// Agents whose output contract is a single JSON object get no extra context
const jsonOnly = (type) => ['judge', 'lens'].includes(kindOf(type))

function readInput() {
  try {
    const parsed = JSON.parse(readFileSync(0, 'utf8') || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

const kind = KINDS[process.argv[2]]
if (!kind) process.exit(0)

const input = readInput()
if (process.argv[2] === 'subagent' && jsonOnly(input.agent_type)) process.exit(0)

const root = process.env.CLAUDE_PLUGIN_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const text = readFileSync(join(root, 'hooks', 'contract', kind.file), 'utf8').trim()

process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: kind.event, additionalContext: text } }))
