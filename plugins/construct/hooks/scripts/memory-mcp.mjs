// MCP server over the construct-memory CLI: newline-delimited JSON-RPC 2.0 on stdin and stdout.
// Each tool runs bin/construct-memory once, so the CLI stays the single implementation; nothing
// destructive is exposed. Nothing is written to stderr; the server exits when stdin closes.
// Usage: node memory-mcp.mjs  (started by plugins/construct/.mcp.json)
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const ROOT = process.env.CLAUDE_PLUGIN_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CLI = join(ROOT, 'bin', 'construct-memory')
const DEFAULT_VERSION = '2025-06-18'
const TIMEOUT_MS = 10_000

const str = (description) => ({ type: 'string', description })
const int = (description) => ({ type: 'integer', description })
const bool = (description) => ({ type: 'boolean', description })
const num = (description) => ({ type: 'number', description })
// opt turns optional values into CLI options in the `--name=value` form, so a value starting with `-` is never read as an option.
const opt = (name, value) => (value === undefined ? [] : [`--${name}=${value}`])
const without = (args, ...keys) => Object.fromEntries(Object.entries(args).filter(([k]) => !keys.includes(k)))

// Each tool: its schema and `run`, which maps validated arguments to the CLI argv and stdin.
// Free-text positionals go after `--` so a value starting with `-` is never parsed as an option.
const TOOLS = {
  mem_save: {
    description: 'Save a memory for this repository (decision, root-cause fix, discovery, convention, preference). Saving an existing topic_key updates it. Prints the id and any similar memories to judge.',
    properties: { title: str('Short, searchable title'), content: str('What, Why, Where (paths on one `Where:` line), Learned'), type: str('decision, policy, preference, config, discovery, pattern, architecture, or bugfix'), topic_key: str('Stable key for an evolving topic, such as area/subject'), session_id: str('Session to attach the memory to') },
    required: ['title', 'content'],
    run: (a) => ({ argv: ['save'], stdin: JSON.stringify(a) }),
  },
  mem_search: {
    description: 'Search this repository\'s memories by text. Prints one line per hit: id, type, title, preview.',
    properties: { query: str('Words to search for'), type: str('Only this memory type'), limit: int('Maximum hits'), any: bool('Match any word instead of all') },
    required: ['query'],
    run: (a) => ({ argv: ['search', ...opt('type', a.type), ...opt('limit', a.limit), ...(a.any ? ['--any'] : []), '--', a.query] }),
  },
  mem_context: {
    description: 'Print the recent memory context for this repository: sessions, prompts, pinned and newest memories.',
    properties: {},
    required: [],
    run: () => ({ argv: ['context'] }),
  },
  mem_get_observation: {
    description: 'Show one memory in full by id, optionally with its earlier versions.',
    properties: { id: int('Observation id'), history: bool('Include earlier versions') },
    required: ['id'],
    run: (a) => ({ argv: ['get', ...(a.history ? ['--history'] : []), '--', String(a.id)] }),
  },
  mem_update: {
    description: 'Change fields of one memory in place by id; omitted fields stay as they are.',
    properties: { id: int('Observation id'), title: str('New title'), content: str('New content'), type: str('New type'), topic_key: str('New topic key') },
    required: ['id'],
    run: (a) => ({ argv: ['update', '--', String(a.id)], stdin: JSON.stringify(without(a, 'id')) }),
  },
  mem_timeline: {
    description: 'Show the memories around one memory in its session, the focus marked with >.',
    properties: { id: int('Observation id'), before: int('Memories before (default 5)'), after: int('Memories after (default 5)') },
    required: ['id'],
    run: (a) => ({ argv: ['timeline', ...opt('before', a.before), ...opt('after', a.after), '--', String(a.id)] }),
  },
  mem_session_summary: {
    description: 'Store the summary of a session (Goal, Instructions, Discoveries, Accomplished, Next Steps, Relevant Files) and end the session.',
    properties: { session_id: str('Session id'), content: str('The summary') },
    required: ['session_id', 'content'],
    run: (a) => ({ argv: ['summary', ...opt('session', a.session_id)], stdin: a.content }),
  },
  mem_judge: {
    description: 'Record a verdict on a related-memory candidate printed after a save; re-judging overwrites.',
    properties: { judgment_id: str('Judgment id from the save output'), relation: str('related, compatible, scoped, conflicts_with, supersedes, or not_conflict'), reason: str('Why'), evidence: str('Supporting evidence'), confidence: num('0 to 1') },
    required: ['judgment_id', 'relation'],
    run: (a) => ({ argv: ['judge', ...opt('reason', a.reason), ...opt('evidence', a.evidence), ...opt('confidence', a.confidence), '--', a.judgment_id, a.relation] }),
  },
  mem_suggest_topic_key: {
    description: 'Suggest a stable topic key (such as bug/fix-login) for a memory; writes nothing.',
    properties: { type: str('Memory type'), title: str('Memory title'), content: str('Memory content') },
    required: [],
    run: (a) => ({ argv: ['suggest-topic-key'], stdin: JSON.stringify(a) }),
  },
  mem_relations_pending: {
    description: 'List the pending relation candidates between live memories, newest first, to judge with mem_judge.',
    properties: { limit: int('Maximum candidates (default 20)') },
    required: [],
    run: (a) => ({ argv: ['relations', ...opt('limit', a.limit), '--', 'pending'] }),
  },
}

const listing = Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: { type: 'object', properties: t.properties, required: t.required, additionalProperties: false } }))

class RpcError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

// validate checks the arguments against the declared schema: an object, no extra keys, required keys present, each value of its type.
function validate(name, args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new RpcError(-32602, `${name}: arguments must be an object`)
  const { properties, required } = TOOLS[name]
  for (const key of Object.keys(args)) if (!(key in properties)) throw new RpcError(-32602, `${name}: unknown argument ${key}`)
  for (const key of required) if (args[key] === undefined) throw new RpcError(-32602, `${name}: missing required argument ${key}`)
  for (const [key, value] of Object.entries(args)) {
    const { type } = properties[key]
    const ok = type === 'integer' ? Number.isInteger(value) : type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === type
    if (!ok) throw new RpcError(-32602, `${name}: argument ${key} must be ${type === 'integer' ? 'an integer' : `a ${type}`}`)
  }
}

// runCli runs the CLI once without a shell; a failure becomes an isError result carrying the stderr line.
function runCli({ argv, stdin }) {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [CLI, ...argv], { cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd(), timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
      const reply = (text, isError) => resolve({ content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) })
      if (!error) return reply(stdout, false)
      if (error.killed) return reply('construct-memory timed out', true)
      reply(stderr.trim() || `construct-memory failed: ${error.message.split('\n')[0]}`, true)
    })
    child.stdin.on('error', () => {})
    child.stdin.end(stdin ?? '')
  })
}

async function handle(method, params) {
  switch (method) {
    case 'initialize':
      return { protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : DEFAULT_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'construct-memory', version: VERSION } }
    case 'ping':
      return {}
    case 'tools/list':
      return { tools: listing }
    case 'tools/call': {
      const name = params?.name
      if (typeof name !== 'string' || !Object.hasOwn(TOOLS, name)) throw new RpcError(-32602, `unknown tool: ${name}`)
      const args = params.arguments ?? {}
      validate(name, args)
      return runCli(TOOLS[name].run(args))
    }
    default:
      throw new RpcError(-32601, `method not found: ${method}`)
  }
}

let VERSION = 'unknown'
try {
  VERSION = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version
} catch {}

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)

async function onLine(line) {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return send({ id: null, error: { code: -32700, message: 'parse error: the line is not JSON' } })
  }
  if (message === null || typeof message !== 'object' || Array.isArray(message) || typeof message.method !== 'string') return send({ id: null, error: { code: -32600, message: 'invalid request: a JSON object with a method is required' } })
  const notification = !('id' in message)
  try {
    const result = await handle(message.method, message.params)
    if (!notification) send({ id: message.id, result })
  } catch (error) {
    if (notification) return
    send({ id: message.id, error: error instanceof RpcError ? { code: error.code, message: error.message } : { code: -32603, message: String(error?.message ?? error) } })
  }
}

// Lines are handled one at a time, so replies keep the request order; the process ends once stdin is closed and the queue is empty.
let queue = Promise.resolve()
createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim() !== '') queue = queue.then(() => onLine(line))
})
