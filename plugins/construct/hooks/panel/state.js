// Pure state for the Construct panel: one reducer per engine event the panel
// observes, plus selectors. No `$` calls live here and nothing throws on odd
// input, so these run (and test) in isolation. The wiring passes plain data
// (ids, usage, a clock, a cost number); every reducer returns a new state.
//
// Stored shape (SCHEMA_VERSION 1):
//   v            schema version
//   agents[]     { id, role, type, description, model, effort, ctx, steps,
//                  startedMs, endedMs, status: 'running' | 'done' }, oldest first, at most 20
//   inline       { count, last }  main-thread writes outside odd/tasks/ (S3)
//   gate         { cells[], counts, denied, lastDenied }  (S4)
//                cells: last 60 of 'allowed' | 'asked' | 'denied' | 'sub'
//                counts: { allowed, asked, denied, sub } totals, never capped
//                lastDenied: { tool, detail } | null, detail masked and short
//   receipt      { turnId, startedMs, endedMs, agents, edits, errors, costStart, cost } | null (S5)
//                endedMs null while the turn runs; cost is the cost added, null if unknown
//   compactions  session.compact count

import { roleFor } from '../routing.js'

export const SCHEMA_VERSION = 1

const MAX_AGENTS = 20
const MAX_CELLS = 60
const MAX_DETAIL = 80
const WRITE_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']
const CELL_OF = { allow: 'allowed', ask: 'asked', deny: 'denied' }

export function initialState() {
  return {
    v: SCHEMA_VERSION,
    agents: [],
    inline: { count: 0, last: null },
    gate: { cells: [], counts: { allowed: 0, asked: 0, denied: 0, sub: 0 }, denied: 0, lastDenied: null },
    receipt: null,
    compactions: 0,
  }
}

const isObj = (x) => typeof x === 'object' && x !== null && !Array.isArray(x)
const isNum = (x) => typeof x === 'number' && Number.isFinite(x)
const str = (x) => (typeof x === 'string' && x !== '' ? x : null)

// A stored value merged over the defaults; the defaults when the version differs or the shape is off.
export function merge(stored) {
  const base = initialState()
  if (!isObj(stored) || stored.v !== SCHEMA_VERSION) return base
  const { agents, inline, gate, receipt, compactions } = stored
  if (agents !== undefined && !Array.isArray(agents)) return base
  if (inline !== undefined && !isObj(inline)) return base
  if (gate !== undefined && !isObj(gate)) return base
  if (gate?.cells !== undefined && !Array.isArray(gate.cells)) return base
  if (gate?.counts !== undefined && !isObj(gate.counts)) return base
  if (receipt !== undefined && receipt !== null && !isObj(receipt)) return base
  if (compactions !== undefined && !isNum(compactions)) return base
  return {
    v: SCHEMA_VERSION,
    agents: (agents ?? base.agents).filter(isObj),
    inline: { ...base.inline, ...inline },
    gate: { ...base.gate, ...gate, counts: { ...base.gate.counts, ...gate?.counts } },
    receipt: receipt ?? null,
    compactions: compactions ?? 0,
  }
}

// ---- secrets -----------------------------------------------------------

const SECRET_KEY = '[\\w-]*(?:token|key|secret|password|passwd|pwd|credential)[\\w-]*'
const MASKS = [
  [/\bBearer\s+[\w.~+/=-]+/gi, 'Bearer ***'],
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{10,}/g, '***'],
  [/(\bAuthorization["']?\s*[:=]\s*["']?Basic\s+)[A-Za-z0-9+/]+={0,2}/gi, '$1***'],
  [/\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[A-Z0-9]{16}\b/g, '***'],
  [/\bglpat-[A-Za-z0-9_-]{20,}/g, '***'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+(?=@)/gi, '$1***'],
  [/(\bcurl\b[^|;&\n]*?\s-u\s+[^\s:]+:)[^\s"']+/g, '$1***'],
  [/(\b(?:mysql|mysqldump|mysqladmin|mariadb)\b[^|;&\n]*?\s-p)(?!\s)[^\s"']+/g, '$1***'],
  [/\b(?:gh[pousr]|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{16,}/g, '***'],
  [new RegExp(`\\b(${SECRET_KEY})(\\s*[:=]\\s*)("[^"]*"|'[^']*'|[^\\s&"']+)`, 'gi'), '$1$2***'],
  [/\b(?=[A-Za-z0-9/+]*[A-Z])(?=[A-Za-z0-9/+]*[a-z])(?=[A-Za-z0-9/+]*\/)[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+])/g, '***'],
  [/\b(?=[A-Za-z_-]*\d)[A-Za-z0-9+_-]{32,}={0,2}/g, '***'],
]

// Masks credential-like values: key=value pairs, Bearer tokens, vendor prefixes, long hex/base64-ish runs.
export function maskSecrets(text) {
  if (typeof text !== 'string') return ''
  return MASKS.reduce((out, [re, to]) => out.replace(re, to), text)
}

function shorten(text) {
  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL - 3)}...` : text
}

// ---- paths -------------------------------------------------------------

// The file a tool call targets, from its arguments.
export function filePathOf(args) {
  if (!isObj(args)) return null
  return str(args.file_path) ?? str(args.notebook_path) ?? str(args.path)
}

function segments(path) {
  const out = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out
}

const inTasks = (segs) => segs[0] === 'odd' && segs[1] === 'tasks'

// True for a real path that is not under odd/tasks/ (absolute, or relative to `root`).
export function isOutsideTasks(path, root) {
  if (typeof path !== 'string' || path === '') return false
  const segs = segments(path)
  const rootSegs = typeof root === 'string' && root.startsWith('/') ? segments(root) : null
  if (!path.startsWith('/')) return !inTasks(segs)
  if (!rootSegs) return !segs.some((s, i) => s === 'odd' && segs[i + 1] === 'tasks')
  const inside = rootSegs.every((s, i) => segs[i] === s)
  return !(inside && inTasks(segs.slice(rootSegs.length)))
}

// ---- agents (S2) -------------------------------------------------------

const patchAgent = (state, id, fn) => {
  if (!state.agents.some((a) => a.id === id)) return state
  return { ...state, agents: state.agents.map((a) => (a.id === id ? fn(a) : a)) }
}

const openReceipt = (state, fn) =>
  state.receipt && state.receipt.endedMs === null ? { ...state, receipt: fn(state.receipt) } : state

// A subagent started: add its card (role from the construct agent name, else the subagent type).
export function onAgentSpawn(state, e) {
  const s = merge(state)
  const id = str(e?.agentId)
  if (!id) return s
  const type = str(e.subagentType) ?? 'agent'
  const card = {
    id,
    role: roleFor(type) ?? type,
    type,
    description: str(e.description) ?? '',
    model: str(e.model),
    effort: str(e.effort) ?? (isNum(e.effort) ? String(e.effort) : null),
    ctx: 0,
    steps: 0,
    startedMs: isNum(e.nowMs) ? e.nowMs : 0,
    endedMs: null,
    status: 'running',
  }
  const agents = [...s.agents.filter((a) => a.id !== id), card].slice(-MAX_AGENTS)
  return openReceipt({ ...s, agents }, (r) => ({ ...r, agents: r.agents + 1 }))
}

// One request of a subagent: count the step, ctx is the request's whole input.
export function onTurnStep(state, e) {
  const s = merge(state)
  const id = str(e?.agentId)
  if (!id) return s
  const u = e.usage
  const ctx = isObj(u)
    ? ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'].reduce((n, k) => n + (isNum(u[k]) ? u[k] : 0), 0)
    : null
  return patchAgent(s, id, (a) => ({ ...a, steps: a.steps + 1, ctx: ctx ?? a.ctx }))
}

// A turn began: a subagent runs again, a main turn opens a new receipt.
export function onTurnStart(state, e) {
  const s = merge(state)
  const id = str(e?.agentId)
  if (id) return patchAgent(s, id, (a) => ({ ...a, status: 'running', endedMs: null }))
  const receipt = {
    turnId: str(e?.turnId),
    startedMs: isNum(e?.nowMs) ? e.nowMs : 0,
    endedMs: null,
    agents: 0,
    edits: 0,
    errors: 0,
    costStart: isNum(e?.cost) ? e.cost : null,
    cost: null,
  }
  return { ...s, receipt }
}

// A turn ended: a subagent is done, the main receipt closes with the cost it added.
export function onTurnComplete(state, e) {
  const s = merge(state)
  const nowMs = isNum(e?.nowMs) ? e.nowMs : 0
  const id = str(e?.agentId)
  if (id) return patchAgent(s, id, (a) => ({ ...a, status: 'done', endedMs: nowMs }))
  const turnId = str(e?.turnId)
  if (turnId && s.receipt?.turnId && s.receipt.turnId !== turnId) return s
  return openReceipt(s, (r) => ({
    ...r,
    endedMs: nowMs,
    cost: isNum(e?.cost) && isNum(r.costStart) ? Math.max(0, e.cost - r.costStart) : null,
  }))
}

// Up to `max` cards, running first then the most recent, and how many are left out.
export function agentsView(state, nowMs, max = 3) {
  const agents = isObj(state) && Array.isArray(state.agents) ? state.agents.filter(isObj) : []
  const running = agents.filter((a) => a.status === 'running').reverse()
  const done = agents.filter((a) => a.status !== 'running').sort((a, b) => (b.endedMs ?? 0) - (a.endedMs ?? 0))
  const ordered = [...running, ...done]
  const limit = isNum(max) && max >= 0 ? Math.floor(max) : 3
  const cards = ordered.slice(0, limit).map((a) => {
    const end = a.status === 'running' ? nowMs : a.endedMs
    return { ...a, elapsedMs: isNum(end) && isNum(a.startedMs) ? Math.max(0, end - a.startedMs) : null }
  })
  return { cards, rest: ordered.length - cards.length, running: running.length }
}

// ---- tools: inline writes (S3) and receipt edits/errors (S5) -------------

// A finished tool call. `path` is the file it targets (filePathOf), `cwd` the project root.
export function onToolCall(state, e) {
  let s = merge(state)
  const tool = str(e?.tool)
  const isWrite = tool !== null && WRITE_TOOLS.includes(tool)
  if (isWrite) s = openReceipt(s, (r) => ({ ...r, edits: r.edits + 1 }))
  if (e?.isError === true) s = openReceipt(s, (r) => ({ ...r, errors: r.errors + 1 }))
  const path = str(e?.path)
  if (isWrite && !str(e?.agentId) && path && isOutsideTasks(path, e?.cwd)) {
    s = { ...s, inline: { count: s.inline.count + 1, last: path } }
  }
  return s
}

// ---- gate (S4) -----------------------------------------------------------

const detailOf = (input) => {
  if (!isObj(input)) return ''
  const v = str(input.command) ?? filePathOf(input) ?? str(input.url) ?? str(input.pattern) ?? ''
  return shorten(maskSecrets(v))
}

// One verdict: a cell (a subagent's is 'sub'), totals, and the last denied tool.
export function onToolCheck(state, e) {
  const s = merge(state)
  const kind = CELL_OF[e?.decision]
  if (!kind || e?.isQuery) return s
  const cell = str(e?.agentId) ? 'sub' : kind
  const gate = s.gate
  const denied = kind === 'denied'
  return {
    ...s,
    gate: {
      cells: [...gate.cells, cell].slice(-MAX_CELLS),
      counts: { ...gate.counts, [cell]: (gate.counts[cell] ?? 0) + 1 },
      denied: gate.denied + (denied ? 1 : 0),
      lastDenied: denied ? { tool: str(e.tool) ?? 'tool', detail: detailOf(e.input) } : gate.lastDenied,
    },
  }
}

// ---- session -------------------------------------------------------------

export function onCompact(state) {
  const s = merge(state)
  return { ...s, compactions: s.compactions + 1 }
}
