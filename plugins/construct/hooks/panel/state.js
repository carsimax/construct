// Portions adapted from claude-flightdeck (github.com/scasella/claude-flightdeck), MIT License.
//
// MIT License
//
// Copyright (c) 2026 Stephen Casella
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// Adapted here: the file /
// shell / other bucketing of tool calls and the allow / ask / cleared / deny tallies per bucket
// (core.ts bucketOf, recordCheck, settleCheck), the main-thread request count and the permission
// mode note (register.tsx turn.step, agent.spawn).
//
// Pure state for the Construct panel: one reducer per engine event the panel
// observes, plus selectors. No `$` calls live here and nothing throws on odd
// input, so these run (and test) in isolation. The wiring passes plain data
// (ids, usage, a clock); every reducer returns a new state.
//
// Stored shape (SCHEMA_VERSION 3; version 3 dropped the session log, S9 as rewritten by L14):
//   v            schema version
//   agents[]     { id, role, type, description, model, effort, ctx, steps,
//                  startedMs, endedMs, status: 'running' | 'done' }, oldest first, at most 20
//   inline       { count, last }  main-thread writes outside odd/tasks/ (S3)
//   gate         { cells[], counts, denied, lastDenied }  (S4)
//                cells: last 60 of 'allowed' | 'asked' | 'denied' | 'sub'
//                counts: { allowed, asked, denied, sub } totals, never capped
//                lastDenied: { tool, detail } | null, detail masked and short
//   turn         { turnId } while a main turn runs, else null: the busy flag; merge drops a stored `receipt`
//   compactions  session.compact count
//   main         { steps, model, effort, mode }  main-thread vitals (S3): steps counts main requests
//                (turn.step without agentId, index.d.ts:14328-14354), model and effort are the latest
//                request's, mode is the permission mode (agent.spawn permissionMode, index.d.ts:326,
//                set only when the parent is main; classic hook permission_mode, index.d.ts:861)
//   blocked      true while Claude waits on the human (S8b): set by a tool.check ask on a real call or a
//                tool.call open on AskUserQuestion / ExitPlanMode, cleared by a settled tool.call, turn.start, turn.complete
//   gate.verdicts { rule, ask, cleared, deny }  who decided (S6), subagents included. tool.check
//                decision 'allow' | 'ask' | 'deny' (index.d.ts:13642): allow is a rule/allowed pass,
//                ask went to the mode's decider and stays 'ask' until onToolSettle moves it to
//                'cleared' (the call ran: classifier or approval) or 'deny' (it did not), deny is denied
//   gate.pending  { [callId]: bucket }  asks not yet settled, by tool_use_id (capped at 100)
//   gate.buckets { file, shell, other }  each { rule, ask, cleared, deny }

import { roleFor } from '../routing.js'
import { kindOf } from '../scripts/roles.mjs'
import { isNum } from '../status/format.js'

export const SCHEMA_VERSION = 3

const MAX_AGENTS = 20
const MAX_CELLS = 60
const MAX_DETAIL = 80
const MAX_PENDING = 100
const FILE_TOOLS = ['Read', 'Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'Glob', 'Grep']
const SHELL_TOOLS = ['Bash', 'PowerShell']
const WRITE_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']
const CELL_OF = { allow: 'allowed', ask: 'asked', deny: 'denied' }

const zeroVerdicts = () => ({ rule: 0, ask: 0, cleared: 0, deny: 0 })
const zeroBuckets = () => ({ file: zeroVerdicts(), shell: zeroVerdicts(), other: zeroVerdicts() })

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
      verdicts: zeroVerdicts(),
      buckets: zeroBuckets(),
      pending: {},
    },
    turn: null,
    compactions: 0,
    main: { steps: 0, model: null, effort: null, mode: null },
    blocked: false,
  }
}

const isObj = (x) => typeof x === 'object' && x !== null && !Array.isArray(x)
const str = (x) => (typeof x === 'string' && x !== '' ? x : null)

// A stored value merged over the defaults; the defaults when the version is unknown or the shape is off.
// A version 1 value (no main, verdicts or buckets) is read with those sections defaulted; a version 2
// value is read as is and its `log` section is dropped.
export function merge(stored) {
  const base = initialState()
  if (!isObj(stored) || (stored.v !== SCHEMA_VERSION && stored.v !== 2 && stored.v !== 1)) return base
  const { agents, inline, gate, turn, compactions, main, blocked } = stored
  if (agents !== undefined && !Array.isArray(agents)) return base
  if (inline !== undefined && !isObj(inline)) return base
  if (gate !== undefined && !isObj(gate)) return base
  if (gate?.cells !== undefined && !Array.isArray(gate.cells)) return base
  if (gate?.counts !== undefined && !isObj(gate.counts)) return base
  if (turn !== undefined && turn !== null && !isObj(turn)) return base
  if (gate?.verdicts !== undefined && !isObj(gate.verdicts)) return base
  if (gate?.buckets !== undefined && !isObj(gate.buckets)) return base
  if (compactions !== undefined && !isNum(compactions)) return base
  if (main !== undefined && !isObj(main)) return base
  const buckets = isObj(gate?.buckets) ? gate.buckets : {}
  return {
    v: SCHEMA_VERSION,
    agents: (agents ?? base.agents).filter(isObj),
    inline: { ...base.inline, ...inline },
    gate: {
      ...base.gate,
      ...gate,
      pending: isObj(gate?.pending) ? gate.pending : {},
      counts: { ...base.gate.counts, ...gate?.counts },
      verdicts: { ...base.gate.verdicts, ...gate?.verdicts },
      buckets: Object.fromEntries(
        Object.keys(base.gate.buckets).map((k) => [k, { ...base.gate.buckets[k], ...(isObj(buckets[k]) ? buckets[k] : {}) }]),
      ),
    },
    turn: turn ?? null,
    compactions: compactions ?? 0,
    main: { ...base.main, ...main },
    blocked: blocked === true,
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

// ---- main vitals (S3) ----------------------------------------------------

// One request of the main loop: count it, keep its model and effort.
export function onMainStep(state, e) {
  const s = merge(state)
  if (str(e?.agentId)) return s
  const effort = str(e?.effort) ?? (isNum(e?.effort) ? String(e.effort) : null)
  return { ...s, main: { ...s.main, steps: s.main.steps + 1, model: str(e?.model) ?? s.main.model, effort } }
}

// The main thread's permission mode, when one is given.
export function onPermissionMode(state, e) {
  const s = merge(state)
  const mode = str(e?.mode)
  return mode && mode !== s.main.mode ? { ...s, main: { ...s.main, mode } } : s
}

// Busy while a main turn is open.
export function mainBusy(state) {
  return isObj(state) && isObj(state.turn)
}

// ---- blocked (S8b) --------------------------------------------------------
// Port of gentle-agent-state scripts/hook-adapter.sh, from mod events only (the classic hooks never
// reach the mod, L12): a real tool.check ask is the permission prompt, and a tool.call on a tool that
// asks the person stays open while it waits. A settled tool.call, turn.start or turn.complete clears it.
// adapted from gentle-agent-state (https://github.com/Gentleman-Programming/gentle-agent-state), MIT, Copyright (c) 2026 Alan Buscaglia, see LICENSE-gentle-agent-state

const BLOCKING_TOOLS = ['AskUserQuestion', 'ExitPlanMode']

export const isBlockingTool = (tool) => BLOCKING_TOOLS.includes(tool)

export function onBlocked(state) {
  const s = merge(state)
  return s.blocked ? s : { ...s, blocked: true }
}

export function onUnblocked(state) {
  const s = merge(state)
  return s.blocked ? { ...s, blocked: false } : s
}

// ---- agents (S2) -------------------------------------------------------

const patchAgent = (state, id, fn) => {
  if (!state.agents.some((a) => a.id === id)) return state
  return { ...state, agents: state.agents.map((a) => (a.id === id ? fn(a) : a)) }
}

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
  return { ...s, agents }
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

// A turn began: a subagent runs again, a main turn marks the panel busy.
export function onTurnStart(state, e) {
  const s = merge(state)
  const id = str(e?.agentId)
  if (id) return patchAgent(s, id, (a) => ({ ...a, status: 'running', endedMs: null }))
  return { ...s, turn: { turnId: str(e?.turnId) } }
}

// A turn ended: a subagent is done, the main turn stops being busy.
export function onTurnComplete(state, e) {
  const s = merge(state)
  const nowMs = isNum(e?.nowMs) ? e.nowMs : 0
  const id = str(e?.agentId)
  if (id) {
    return patchAgent(s, id, (x) => ({ ...x, status: 'done', endedMs: nowMs }))
  }
  const turnId = str(e?.turnId)
  if (turnId && s.turn?.turnId && s.turn.turnId !== turnId) return s
  return s.turn ? { ...s, turn: null } : s
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

// `worker` / `construct:worker` -> `worker`, `review_risk` -> `review-risk`; an agent with no
// construct role keeps its subagent type.
export function shortName(a) {
  const raw = String(a.role ?? a.type ?? 'agent')
  const name = raw.replace(/^construct:/, '').replaceAll('_', '-')
  return name === '' ? 'agent' : name
}

// The ODD phase the running agents imply (S5); null with none running. The most advanced phase wins.
const PHASES = [
  ['verifying', ['verifier']],
  ['reviewing', ['lens', 'judge']],
  ['implementing', ['writer']],
  ['exploring', ['reader']],
]
export function phaseOf(state) {
  const agents = isObj(state) && Array.isArray(state.agents) ? state.agents.filter((a) => isObj(a) && a.status === 'running') : []
  if (agents.length === 0) return null
  const kinds = agents.map((a) => kindOf(shortName(a)))
  return PHASES.find(([, wanted]) => kinds.some((k) => wanted.includes(k)))?.[0] ?? 'working'
}

// ---- tools: inline writes (S3) -------------------------------------------

// A finished tool call. `path` is the file it targets (filePathOf), `cwd` the project root.
export function onToolCall(state, e) {
  let s = merge(state)
  const tool = str(e?.tool)
  const isWrite = tool !== null && WRITE_TOOLS.includes(tool)
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

export const bucketOf = (tool) => (FILE_TOOLS.includes(tool) ? 'file' : SHELL_TOOLS.includes(tool) ? 'shell' : 'other')

const VERDICT_OF = { allow: 'rule', ask: 'ask', deny: 'deny' }

const bump = (gate, bucket, from, to) => {
  const b = gate.buckets[bucket]
  const v = gate.verdicts
  return {
    verdicts: { ...v, ...(from ? { [from]: Math.max(0, v[from] - 1) } : {}), [to]: v[to] + 1 },
    buckets: { ...gate.buckets, [bucket]: { ...b, ...(from ? { [from]: Math.max(0, b[from] - 1) } : {}), [to]: b[to] + 1 } },
  }
}

// An ask settled by the call that followed it: it ran (cleared) or was refused (deny). The ask moves by
// the call's id (`e.callId`, the tool_use_id both tool.check and tool.call carry): the check recorded
// its bucket under that id, so a run of another call in the same bucket settles nothing here. With
// no id the bucket is the fallback: one pending ask of the tool's bucket moves. Nothing pending
// leaves the state as it is.
export function onToolSettle(state, e) {
  const s = merge(state)
  const id = str(e?.callId)
  let bucket = bucketOf(str(e?.tool))
  let pending = s.gate.pending
  if (id) {
    if (!Object.hasOwn(pending, id)) return s
    bucket = pending[id]
    const { [id]: _, ...rest } = pending
    pending = rest
  }
  if (!s.gate.buckets[bucket] || s.gate.buckets[bucket].ask < 1 || s.gate.verdicts.ask < 1) return { ...s, gate: { ...s.gate, pending } }
  return { ...s, gate: { ...s.gate, pending, ...bump(s.gate, bucket, 'ask', e?.didRun === true ? 'cleared' : 'deny') } }
}

// One verdict: a cell (a subagent's is 'sub'), totals, and the last denied tool.
export function onToolCheck(state, e) {
  const s = merge(state)
  const kind = CELL_OF[e?.decision]
  if (!kind || e?.isQuery) return s
  const cell = str(e?.agentId) ? 'sub' : kind
  const gate = s.gate
  const denied = kind === 'denied'
  const detail = denied ? detailOf(e.input) : ''
  const tool = str(e.tool) ?? 'tool'
  const bucket = bucketOf(str(e.tool))
  const callId = str(e.callId)
  const pending = e.decision === 'ask' && callId ? Object.fromEntries([...Object.entries(gate.pending), [callId, bucket]].slice(-MAX_PENDING)) : gate.pending
  return {
    ...s,
    gate: {
      ...gate,
      pending,
      ...bump(gate, bucket, null, VERDICT_OF[e.decision]),
      cells: [...gate.cells, cell].slice(-MAX_CELLS),
      counts: { ...gate.counts, [cell]: (gate.counts[cell] ?? 0) + 1 },
      denied: gate.denied + (denied ? 1 : 0),
      lastDenied: denied ? { tool, detail } : gate.lastDenied,
    },
  }
}

// ---- session -------------------------------------------------------------

export function onCompact(state) {
  const s = merge(state)
  return { ...s, compactions: s.compactions + 1 }
}
