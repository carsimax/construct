// Panel state for the construct mod: pure reducers and selectors over the value persisted as
// construct.panel.v3. Every reducer takes a state (any value is repaired through merge) and an
// event object, and returns a new state; nothing here reads the clock or the disk.
import { roleFor } from '../routing.js'
import { isNum } from '../status/format.js'
import { kindOf } from '../scripts/roles.mjs'

export const SCHEMA_VERSION = 3

const MAX_AGENTS = 20
const MAX_CELLS = 60
const MAX_PENDING = 100
const MAX_DETAIL = 80

const isObj = (x) => typeof x === 'object' && x !== null && !Array.isArray(x)
const str = (x) => (typeof x === 'string' && x !== '' ? x : null)
const last = (list, max) => (list.length > max ? list.slice(list.length - max) : list)

// ---- state shape ---------------------------------------------------------

const tally = () => ({ rule: 0, ask: 0, cleared: 0, deny: 0 })

export function initialState() {
  return {
    v: SCHEMA_VERSION,
    agents: [],
    inline: { count: 0, last: null },
    gate: {
      cells: [],
      counts: { allowed: 0, asked: 0, denied: 0, sub: 0 },
      denied: 0,
      lastDenied: null,
      verdicts: tally(),
      buckets: { file: tally(), shell: tally(), other: tally() },
      pending: {},
    },
    turn: null,
    compactions: 0,
    main: { steps: 0, model: null, effort: null, mode: null },
    blocked: false,
  }
}

// A section over its defaults: numeric fields must be numbers, the rest take the stored value when set.
const fill = (def, v) => {
  const from = isObj(v) ? v : {}
  return Object.fromEntries(Object.entries(def).map(([k, d]) => [k, typeof d === 'number' ? (isNum(from[k]) ? from[k] : d) : (from[k] ?? d)]))
}

// Repairs a stored value: v1 to v3 are read, anything else resets. A section of the wrong type
// takes its default, so a field dropped from the schema (receipt, log) never comes back.
export function merge(stored) {
  const base = initialState()
  if (!isObj(stored) || ![1, 2, 3].includes(stored.v)) return base
  const g = isObj(stored.gate) ? stored.gate : {}
  const gate = {
    ...fill(base.gate, g),
    cells: Array.isArray(g.cells) ? g.cells : [],
    counts: fill(base.gate.counts, g.counts),
    verdicts: fill(base.gate.verdicts, g.verdicts),
    buckets: Object.fromEntries(Object.keys(base.gate.buckets).map((k) => [k, fill(base.gate.verdicts, g.buckets?.[k])])),
    lastDenied: isObj(g.lastDenied) ? g.lastDenied : null,
    pending: isObj(g.pending) ? g.pending : {},
  }
  const agents = (Array.isArray(stored.agents) ? stored.agents : []).filter(isObj).map((a) => ({ ...a, steps: isNum(a.steps) ? a.steps : 0, ctx: isNum(a.ctx) ? a.ctx : 0 }))
  return {
    v: SCHEMA_VERSION,
    agents,
    inline: fill(base.inline, stored.inline),
    gate,
    turn: isObj(stored.turn) ? stored.turn : null,
    compactions: isNum(stored.compactions) ? stored.compactions : 0,
    main: fill(base.main, stored.main),
    blocked: stored.blocked === true,
  }
}

const open = (s) => (isObj(s) && s.v === SCHEMA_VERSION ? s : merge(s))

// ---- secrets and paths ---------------------------------------------------

const SECRET_RULES = [
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+@/gi, '$1***@'],
  [/(\s-u\s+[^\s:]+:)\S+/g, '$1***'],
  [/\b([\w-]*(?:key|token|secret|password|passwd|pwd|credentials?))(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s&"']+)/gi, '$1$2***'],
  [/\b(?:(?:sk|pk|rk)[-_][A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|glpat-[\w-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[A-Z0-9]{16})/g, '***'],
  // an AWS-style secret key: 40 chars of base64 with every character class present
  [/(?<![A-Za-z0-9/+])(?=[A-Za-z0-9/+]*\d)(?=[A-Za-z0-9/+]*[A-Z])(?=[A-Za-z0-9/+]*[a-z])[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+])/g, '***'],
  [/\b(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{32,}\b/g, '***'],
]

export function maskSecrets(text) {
  if (typeof text !== 'string') return ''
  let out = text
  // `-pSECRET` is the mysql form; only mask it where the command is one that takes it
  if (/\b(?:mysql\w*|mariadb\w*|mongo\w*)\b/.test(out)) out = out.replace(/(\s-p)\S+/g, '$1***')
  for (const [re, to] of SECRET_RULES) out = out.replace(re, to)
  return out
}

// The path a tool call touches: a top-level file_path on the call, else the one in its input.
export function filePathOf(e) {
  const input = isObj(e?.input) ? e.input : {}
  return str(e?.file_path) ?? str(input.file_path) ?? str(e?.notebook_path) ?? str(input.notebook_path) ?? str(e?.path) ?? str(input.path) ?? undefined
}

// Lexical normalization against cwd, so `sub/../odd/tasks/x` and `./odd/tasks/x` resolve alike.
function resolve(path, cwd) {
  const full = path.startsWith('/') ? path : `${typeof cwd === 'string' ? cwd : ''}/${path}`
  const parts = []
  for (const part of full.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '' && part !== '.') parts.push(part)
  }
  return parts
}

export function isOutsideTasks(path, cwd) {
  if (typeof path !== 'string' || path === '') return false
  const parts = resolve(path, cwd)
  const tasks = resolve('odd/tasks', cwd)
  return !tasks.every((p, i) => parts[i] === p)
}

// ---- agents --------------------------------------------------------------

const withAgent = (s, id, change) => {
  if (!s.agents.some((a) => a.id === id)) return s
  return { ...s, agents: s.agents.map((a) => (a.id === id ? { ...a, ...change(a) } : a)) }
}

export function onAgentSpawn(state, e) {
  const s = open(state)
  const id = str(e?.agentId)
  if (!id) return s
  const type = str(e.subagentType)
  const agent = {
    id,
    role: roleFor(type) ?? type,
    type,
    description: typeof e.description === 'string' ? e.description : '',
    model: str(e.model),
    effort: str(e.effort),
    ctx: 0,
    steps: 0,
    startedMs: isNum(e.nowMs) ? e.nowMs : 0,
    endedMs: null,
    status: 'running',
  }
  const spawned = { ...s, agents: last([...s.agents.filter((a) => a.id !== id), agent], MAX_AGENTS) }
  return e.parentAgentId === undefined ? onPermissionMode(spawned, { mode: e.mode }) : spawned
}

export function onTurnStep(state, e) {
  const s = open(state)
  const id = str(e?.agentId)
  if (!id) return s
  const u = e.usage
  const ctx = isObj(u) ? (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) : null
  return withAgent(s, id, (a) => ({ steps: a.steps + 1, ctx: isNum(ctx) ? ctx : a.ctx }))
}

export function onTurnStart(state, e) {
  const s = open(state)
  const id = str(e?.agentId)
  if (id) return withAgent(s, id, () => ({ status: 'running', endedMs: null }))
  return { ...s, turn: { turnId: str(e?.turnId) } }
}

export function onTurnComplete(state, e) {
  const s = open(state)
  const id = str(e?.agentId)
  if (id) return withAgent(s, id, () => ({ status: 'done', endedMs: isNum(e.nowMs) ? e.nowMs : 0 }))
  const turnId = str(e?.turnId)
  // a different turn id means a stale completion: the open turn stays
  if (s.turn && turnId && s.turn.turnId && s.turn.turnId !== turnId) return s
  return s.turn ? { ...s, turn: null } : s
}

export function onMainStep(state, e) {
  const s = open(state)
  if (str(e?.agentId) !== null) return s
  const effort = e?.effort == null || e.effort === '' ? null : String(e.effort)
  return { ...s, main: { ...s.main, steps: s.main.steps + 1, model: str(e?.model) ?? s.main.model, effort } }
}

export function onPermissionMode(state, e) {
  const s = open(state)
  const mode = str(e?.mode)
  return mode ? { ...s, main: { ...s.main, mode } } : s
}

export const onCompact = (state) => {
  const s = open(state)
  return { ...s, compactions: s.compactions + 1 }
}

// ---- gate ----------------------------------------------------------------

const FILE_TOOLS = ['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Glob', 'Grep']
const SHELL_TOOLS = ['Bash', 'PowerShell']
const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']

export function bucketOf(tool) {
  if (FILE_TOOLS.includes(tool)) return 'file'
  return SHELL_TOOLS.includes(tool) ? 'shell' : 'other'
}

const bump = (counts, key, by = 1) => ({ ...counts, [key]: counts[key] + by })

// Moves one verdict from `from` to `to`, in the totals and in the tool's bucket.
function shift(gate, bucket, from, to) {
  const buckets = { ...gate.buckets, [bucket]: bump(bump(gate.buckets[bucket], from, -1), to) }
  return { ...gate, verdicts: bump(bump(gate.verdicts, from, -1), to), buckets }
}

const DETAIL_FIELDS = ['command', 'file_path', 'notebook_path', 'path', 'url', 'pattern']
const CELL = { allow: 'allowed', ask: 'asked', deny: 'denied' }
const VERDICT = { allow: 'rule', ask: 'ask', deny: 'deny' }

export function onToolCheck(state, e) {
  const s = open(state)
  const decision = e?.decision
  // a query carries no tool_use_id: it asks what would happen and decides nothing
  if (e?.isQuery || !CELL[decision]) return s
  // the same call asked again (a re-check while it waits) is one ask, not two
  if (decision === 'ask' && str(e.callId) && Object.hasOwn(s.gate.pending ?? {}, e.callId)) return s
  const bucket = bucketOf(e.tool)
  const verdict = VERDICT[decision]
  const sub = str(e.agentId) !== null
  const cell = sub ? 'sub' : CELL[decision]
  const g = s.gate
  let gate = {
    ...g,
    cells: last([...g.cells, cell], MAX_CELLS),
    counts: bump(g.counts, cell),
    verdicts: bump(g.verdicts, verdict),
    buckets: { ...g.buckets, [bucket]: bump(g.buckets[bucket], verdict) },
  }
  if (decision === 'deny') {
    const input = isObj(e.input) ? e.input : {}
    const shown = maskSecrets(DETAIL_FIELDS.map((k) => str(input[k])).find((x) => x) ?? '')
    const detail = shown.length > MAX_DETAIL ? `${shown.slice(0, MAX_DETAIL - 3)}...` : shown
    gate = { ...gate, denied: g.denied + 1, lastDenied: { tool: str(e.tool) ?? 'tool', detail } }
  }
  if (decision === 'ask') {
    // asks without a call id still need a unique slot; the running total is one
    const key = str(e.callId) ?? `anon${Object.values(g.counts).reduce((a, b) => a + b, 0)}`
    const keys = Object.keys(gate.pending ?? {}).concat(key).slice(-MAX_PENDING)
    gate = { ...gate, pending: Object.fromEntries(keys.map((k) => [k, k === key ? bucket : gate.pending[k]])) }
  }
  return { ...s, gate }
}

// The ask got its answer: it ran (cleared) or it did not (deny).
export function onToolSettle(state, e) {
  const s = open(state)
  const pending = s.gate.pending ?? {}
  const id = str(e?.callId)
  const bucket = bucketOf(e?.tool)
  const key = id ?? Object.keys(pending).find((k) => pending[k] === bucket)
  if (key === undefined || !Object.hasOwn(pending, key)) return s
  const { [key]: settled, ...rest } = pending
  const gate = shift({ ...s.gate, pending: rest }, settled, 'ask', e.didRun ? 'cleared' : 'deny')
  return { ...s, gate }
}

// ---- inline writes, blocked flag ----------------------------------------

export function onToolCall(state, e) {
  const s = open(state)
  if (str(e?.agentId) !== null || !WRITE_TOOLS.includes(e?.tool) || !isOutsideTasks(e.path, e.cwd)) return s
  return { ...s, inline: { count: s.inline.count + 1, last: e.path } }
}

const BLOCKING = ['AskUserQuestion', 'ExitPlanMode']
export const isBlockingTool = (tool) => BLOCKING.includes(tool)

export function onBlocked(state) {
  const s = open(state)
  return s.blocked ? s : { ...s, blocked: true }
}

export function onUnblocked(state) {
  const s = open(state)
  return s.blocked ? { ...s, blocked: false } : s
}

// ---- selectors -----------------------------------------------------------

export const mainBusy = (state) => isObj(state?.turn)

// The agent's short panel name: its role with dashes when that is a construct role, else the role
// or type as is.
export function shortName(agent) {
  const name = typeof agent === 'string' ? agent : (str(agent?.role) ?? str(agent?.type))
  return name ? name.replace(/^construct:/, '').replaceAll('_', '-') : 'agent'
}

const PHASES = [
  ['verifier', 'verifying'],
  ['judge', 'reviewing'],
  ['lens', 'reviewing'],
  ['writer', 'implementing'],
  ['reader', 'exploring'],
]

// What the running agents are doing, the most advanced phase winning; null with none running.
export function phaseOf(state) {
  const running = (isObj(state) && Array.isArray(state.agents) ? state.agents : []).filter((a) => a?.status === 'running')
  if (running.length === 0) return null
  const kinds = running.map((a) => kindOf(shortName(a)))
  return PHASES.find(([kind]) => kinds.includes(kind))?.[1] ?? 'working'
}

// Cards for the agents section: running ones first, then the latest finished, finished by most recent end.
export function agentsView(state, nowMs, max = 3) {
  const agents = isObj(state) && Array.isArray(state.agents) ? state.agents : []
  const running = agents.filter((a) => a.status === 'running').sort((a, b) => b.startedMs - a.startedMs)
  const done = agents.filter((a) => a.status !== 'running').sort((a, b) => (b.endedMs ?? 0) - (a.endedMs ?? 0))
  const cards = [...running, ...done].slice(0, max).map((a) => {
    const end = a.status === 'running' ? nowMs : a.endedMs
    return { ...a, name: shortName(a), elapsedMs: isNum(end) && isNum(a.startedMs) ? Math.max(0, end - a.startedMs) : 0 }
  })
  return { cards, rest: agents.length - cards.length, running: running.length }
}
