// Band state for the construct mod: pure reducers and selectors over the value persisted as
// construct.band.v1. Every reducer takes a state (any value is repaired through merge) and an
// event object, and returns a new state; nothing here reads the clock or the disk.
import { roleFor } from '../routing.js'
import { isNum } from '../status/format.js'
import { kindOf } from '../scripts/roles.mjs'

export const SCHEMA_VERSION = 1

const MAX_AGENTS = 20

const isObj = (x) => typeof x === 'object' && x !== null && !Array.isArray(x)
const str = (x) => (typeof x === 'string' && x !== '' ? x : null)
const last = (list, max) => (list.length > max ? list.slice(list.length - max) : list)

// ---- state shape ---------------------------------------------------------

export function initialState() {
  return {
    v: SCHEMA_VERSION,
    agents: [],
    turn: null,
    blocked: false,
  }
}

// Repairs a stored value: another version resets. A field outside the schema (an older `gate` or
// `inline`) is dropped.
export function merge(stored) {
  const base = initialState()
  if (!isObj(stored) || stored.v !== SCHEMA_VERSION) return base
  return {
    v: SCHEMA_VERSION,
    agents: (Array.isArray(stored.agents) ? stored.agents : []).filter(isObj),
    turn: isObj(stored.turn) ? stored.turn : null,
    blocked: stored.blocked === true,
  }
}

// merge is idempotent on a sound value, so every reducer repairs nested damage in a current value too
const open = merge

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

// ---- blocked flag --------------------------------------------------------

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

// The construct kind of an agent; null for another plugin's agent, even one named like a construct role.
export const kindOfAgent = (agent) => (roleFor(agent?.type) ? kindOf(agent.type) : null)

// What the running agents are doing, the most advanced phase winning; null with none running.
export function phaseOf(state) {
  const running = (isObj(state) && Array.isArray(state.agents) ? state.agents : []).filter((a) => a?.status === 'running')
  if (running.length === 0) return null
  const kinds = running.map(kindOfAgent)
  return PHASES.find(([kind]) => kinds.includes(kind))?.[1] ?? 'working'
}

// The running agents, oldest first, each with its short name and time running.
export function agentsView(state, nowMs) {
  const agents = (isObj(state) && Array.isArray(state.agents) ? state.agents : []).filter((a) => isObj(a) && a.status === 'running')
  const start = (a) => (isNum(a.startedMs) ? a.startedMs : 0)
  return agents.sort((a, b) => start(a) - start(b)).map((a) => ({ ...a, name: shortName(a), elapsedMs: isNum(nowMs) && isNum(a.startedMs) ? Math.max(0, nowMs - a.startedMs) : 0 }))
}
