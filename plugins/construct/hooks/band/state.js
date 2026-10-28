// Band state for the construct mod: pure reducers and selectors over the value persisted as
// construct.band.v1. Every reducer takes a state (any value is repaired through merge) and an
// event object, and returns a new state; nothing here reads the clock or the disk.
import { roleFor } from '../routing.js'
import { isNum } from '../status/format.js'
import { kindOf } from '../scripts/roles.mjs'

export const SCHEMA_VERSION = 1

const MAX_AGENTS = 20
const MAX_PENDING = 100

const isObj = (x) => typeof x === 'object' && x !== null && !Array.isArray(x)
const str = (x) => (typeof x === 'string' && x !== '' ? x : null)
const last = (list, max) => (list.length > max ? list.slice(list.length - max) : list)

// ---- state shape ---------------------------------------------------------

const tally = () => ({ rule: 0, ask: 0, cleared: 0, deny: 0 })

export function initialState() {
  return {
    v: SCHEMA_VERSION,
    agents: [],
    inline: { count: 0 },
    gate: { verdicts: tally(), pending: {} },
    turn: null,
    blocked: false,
  }
}

// A section over its defaults: numeric fields must be numbers, the rest take the stored value when set.
const fill = (def, v) => {
  const from = isObj(v) ? v : {}
  return Object.fromEntries(Object.entries(def).map(([k, d]) => [k, typeof d === 'number' ? (isNum(from[k]) ? from[k] : d) : (from[k] ?? d)]))
}

// Repairs a stored value: another version resets. A section of the wrong type takes its default,
// and a field outside the schema is dropped.
export function merge(stored) {
  const base = initialState()
  if (!isObj(stored) || stored.v !== SCHEMA_VERSION) return base
  const g = isObj(stored.gate) ? stored.gate : {}
  const gate = { verdicts: fill(base.gate.verdicts, g.verdicts), pending: isObj(g.pending) ? g.pending : {} }
  return {
    v: SCHEMA_VERSION,
    agents: (Array.isArray(stored.agents) ? stored.agents : []).filter(isObj),
    inline: fill(base.inline, stored.inline),
    gate,
    turn: isObj(stored.turn) ? stored.turn : null,
    blocked: stored.blocked === true,
  }
}

// merge is idempotent on a sound value, so every reducer repairs nested damage in a current value too
const open = merge

// ---- paths ---------------------------------------------------------------

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
  // with no cwd, an `odd/tasks` segment pair anywhere in the path counts as inside tasks
  if (typeof cwd !== 'string') return !parts.some((p, i) => p === 'odd' && parts[i + 1] === 'tasks')
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
    startedMs: isNum(e.nowMs) ? e.nowMs : 0,
    endedMs: null,
    status: 'running',
  }
  return { ...s, agents: last([...s.agents.filter((a) => a.id !== id), agent], MAX_AGENTS) }
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

// ---- gate ----------------------------------------------------------------

const FILE_TOOLS = ['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Glob', 'Grep']
const SHELL_TOOLS = ['Bash', 'PowerShell']
const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']

export function bucketOf(tool) {
  if (FILE_TOOLS.includes(tool)) return 'file'
  return SHELL_TOOLS.includes(tool) ? 'shell' : 'other'
}

const bump = (counts, key, by = 1) => ({ ...counts, [key]: Math.max(0, counts[key] + by) })

// Moves one verdict from `from` to `to`.
const shift = (gate, from, to) => ({ ...gate, verdicts: bump(bump(gate.verdicts, from, -1), to) })

const VERDICT = { allow: 'rule', ask: 'ask', deny: 'deny' }

export function onToolCheck(state, e) {
  const s = open(state)
  const decision = e?.decision
  // a query carries no tool_use_id: it asks what would happen and decides nothing
  if (e?.isQuery || !VERDICT[decision]) return s
  // the same call asked again (a re-check while it waits) is one ask, not two
  if (decision === 'ask' && str(e.callId) && Object.hasOwn(s.gate.pending ?? {}, e.callId)) return s
  const g = s.gate
  let gate = { ...g, verdicts: bump(g.verdicts, VERDICT[decision]) }
  if (decision === 'ask') {
    // asks without a call id still need a unique slot; the running total of verdicts is one
    const key = str(e.callId) ?? `anon${Object.values(g.verdicts).reduce((a, b) => a + b, 0)}`
    const keys = Object.keys(gate.pending ?? {}).concat(key).slice(-MAX_PENDING)
    gate = { ...gate, pending: Object.fromEntries(keys.map((k) => [k, k === key ? bucketOf(e.tool) : gate.pending[k]])) }
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
  const { [key]: _settled, ...rest } = pending
  const gate = shift({ ...s.gate, pending: rest }, 'ask', e.didRun ? 'cleared' : 'deny')
  return { ...s, gate }
}

// ---- inline writes, blocked flag ----------------------------------------

export function onToolCall(state, e) {
  const s = open(state)
  if (str(e?.agentId) !== null || !WRITE_TOOLS.includes(e?.tool) || !isOutsideTasks(e.path, e.cwd)) return s
  return { ...s, inline: { count: s.inline.count + 1 } }
}

const BLOCKING = ['AskUserQuestion', 'ExitPlanMode']
export const isBlockingTool = (tool) => BLOCKING.includes(tool)

// A flag that already matches returns the input object itself, before any repair.
export function onBlocked(state) {
  return state?.blocked === true ? state : { ...open(state), blocked: true }
}

export function onUnblocked(state) {
  return state?.blocked === false ? state : { ...open(state), blocked: false }
}

// ---- selectors -----------------------------------------------------------

export const mainBusy = (state) => isObj(state?.turn)

// The agent's short name: its role with dashes when that is a construct role, else the role
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
  const agents = (isObj(state) && Array.isArray(state.agents) ? state.agents : []).filter(isObj)
  const running = agents.filter((a) => a.status === 'running').sort((a, b) => b.startedMs - a.startedMs)
  const done = agents.filter((a) => a.status !== 'running').sort((a, b) => (b.endedMs ?? 0) - (a.endedMs ?? 0))
  const cards = [...running, ...done].slice(0, max).map((a) => {
    const end = a.status === 'running' ? nowMs : a.endedMs
    return { ...a, name: shortName(a), elapsedMs: isNum(end) && isNum(a.startedMs) ? Math.max(0, end - a.startedMs) : 0 }
  })
  return { cards, rest: agents.length - cards.length, running: running.length }
}
