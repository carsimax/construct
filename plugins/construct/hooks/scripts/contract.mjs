// Emits the Construct always-on contract as hook additionalContext.
// Usage: node contract.mjs session|subagent  (hook JSON on stdin)
import { spawn } from 'node:child_process'
import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const KINDS = {
  session: { event: 'SessionStart', file: 'session.md' },
  subagent: { event: 'SubagentStart', file: 'subagent.md' },
}

// Agents whose output contract is a single JSON object get no extra context
const JSON_ONLY_AGENT = /^(construct:)?(review-|jd-judge-)/

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
if (process.argv[2] === 'subagent' && JSON_ONLY_AGENT.test(input.agent_type ?? '')) process.exit(0)

// Documented plugin option env var (plugins-reference, "Reference a saved value"); booleans may be strings
const autoIndex = /^(true|1)$/i.test(process.env.CLAUDE_PLUGIN_OPTION_CODEGRAPH_AUTO_INDEX ?? '')

// Synchronous PATH scan, no subprocess
function findOnPath(name) {
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    if (!entry) continue
    const file = join(entry, name)
    try {
      if (statSync(file).isFile()) {
        accessSync(file, constants.X_OK)
        return file
      }
    } catch {}
  }
  return ''
}

// Launch `codegraph init --yes <dir>` without ever waiting on it; true when the launch was issued
function startIndexing(cli, dir) {
  try {
    const child = spawn(cli, ['init', '--yes', dir], { cwd: dir, detached: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}

// Session only: tell the agent when a git root has no CodeGraph index (and index it when opted in)
function indexNotice(dir, source) {
  if (!existsSync(join(dir, '.git')) || existsSync(join(dir, '.codegraph'))) return ''
  const manual = `Indexing is the user's decision: suggest \`! codegraph init ${dir}\` once, then fall back to file tools.`
  const missing = `CodeGraph: \`${dir}\` has no \`.codegraph/\` index, so \`codegraph_explore\` cannot answer for it.`
  if (autoIndex) {
    const cli = findOnPath('codegraph')
    if (!cli) return `${missing} Auto-index is on, but the \`codegraph\` CLI is not on the PATH. ${manual}`
    // Launch only on a fresh startup; a later source means an earlier launch already had its chance
    if (source !== 'startup') {
      return `${missing} An earlier automatic init may have failed (for example in a directory codegraph refuses, such as $HOME). ${manual}`
    }
    if (startIndexing(cli, dir)) {
      return `CodeGraph: \`${dir}\` has no \`.codegraph/\` index yet; a background \`codegraph init --yes\` was requested and may still fail. Use file tools until \`codegraph status\` reports the index complete.`
    }
  }
  return `${missing} ${manual}`
}

const root = process.env.CLAUDE_PLUGIN_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..', '..')
let text = readFileSync(join(root, 'hooks', 'contract', kind.file), 'utf8').trim()
if (process.argv[2] === 'session') {
  const notice = indexNotice(typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd(),
    typeof input.source === 'string' && input.source ? input.source : 'startup')
  if (notice) text += `\n\n${notice}`
}

process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: kind.event, additionalContext: text } }))
