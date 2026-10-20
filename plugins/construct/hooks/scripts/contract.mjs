// Emits the Construct always-on contract as hook additionalContext.
// Usage: node contract.mjs session|subagent  (hook JSON on stdin)
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const KINDS = {
  session: { event: 'SessionStart', file: 'session.md' },
  subagent: { event: 'SubagentStart', file: 'subagent.md' },
}

// Agents whose output contract is a single JSON object get no extra context
const JSON_ONLY_AGENT = /^(construct:)?(review-|jd-judge-)/

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

// Session only: tell the agent when a git root has no CodeGraph index
function indexNotice(dir) {
  if (!existsSync(join(dir, '.git')) || existsSync(join(dir, '.codegraph'))) return ''
  return `CodeGraph: \`${dir}\` has no \`.codegraph/\` index, so \`codegraph_explore\` cannot answer for it. Indexing is the user's decision: suggest \`! codegraph init ${dir}\` once, then fall back to file tools.`
}

const root = process.env.CLAUDE_PLUGIN_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..', '..')
let text = readFileSync(join(root, 'hooks', 'contract', kind.file), 'utf8').trim()
if (process.argv[2] === 'session') {
  const notice = indexNotice(typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd())
  if (notice) text += `\n\n${notice}`
}

process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: kind.event, additionalContext: text } }))
