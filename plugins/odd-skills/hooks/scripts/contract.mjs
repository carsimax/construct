// Emits the odd_skills always-on contract as hook additionalContext.
// Usage: node contract.mjs session|subagent  (hook JSON on stdin)
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const KINDS = {
  session: { event: 'SessionStart', file: 'session.md' },
  subagent: { event: 'SubagentStart', file: 'subagent.md' },
}

// Agents whose output contract is a single JSON object get no extra context
const JSON_ONLY_AGENT = /^(odd-skills:)?(review-|jd-judge-)/

function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}')
  } catch {
    return {}
  }
}

const kind = KINDS[process.argv[2]]
if (!kind) process.exit(0)

const input = readInput()
if (process.argv[2] === 'subagent' && JSON_ONLY_AGENT.test(input.agent_type ?? '')) process.exit(0)

const root = process.env.CLAUDE_PLUGIN_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const text = readFileSync(join(root, 'hooks', 'contract', kind.file), 'utf8').trim()

process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: kind.event, additionalContext: text } }))
