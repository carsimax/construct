// Pure layout for the Construct panel: element trees per section and per width.
// No `$` calls live here, so these run (and test) in isolation. The wiring passes
// the panel state (hooks/panel/state.js), the data the band gathers, a clock,
// and the Pane's `bodyColumns` / `scroll.bodyRows` as `columns` / `rows`.
// Colors are theme keys only, as in hooks/status/format.js.

import { agentsView } from './state.js'
import {
  budgetSegments,
  clampPct,
  joinSegments,
  meterColor,
  rddLine,
  row,
  segment,
  text,
  whereSegments,
} from '../status/format.js'

const MINI_BELOW = 56
const WIDE_FROM = 110
const MINI_ROWS = 8
const SEP_WIDTH = 3
const CELL_COLOR = { allowed: 'success', asked: 'suggestion', denied: 'error', sub: 'inactive' }

// 'mini' below 56 columns, 'compact' to 109, 'wide' from 110.
export function layoutFor(columns) {
  if (typeof columns !== 'number' || !Number.isFinite(columns)) return 'compact'
  if (columns < MINI_BELOW) return 'mini'
  return columns >= WIDE_FROM ? 'wide' : 'compact'
}

// ---- small helpers ---------------------------------------------------------

const isNum = (x) => typeof x === 'number' && Number.isFinite(x)

function lenOf(node) {
  if (typeof node === 'string') return node.length
  if (!node || !Array.isArray(node.children)) return 0
  return node.children.reduce((n, k) => n + lenOf(k), 0)
}

// `s` cut to `n` characters, with an ellipsis when it was longer.
function fit(s, n) {
  if (n <= 0) return ''
  return s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s
}

const clock = (ms) => {
  if (!isNum(ms)) return '–'
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const kilo = (n) => `${Math.round((isNum(n) ? n : 0) / 1000)}k`

// The last two path parts, so a long path stays readable.
function shortPath(path) {
  const parts = String(path).split('/').filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : parts.join('/')
}

// A row of plain content: no phosphor mark, unlike the band's `row`.
const line = (id, children) => ({ type: 'Box', props: { key: id, flexDirection: 'row' }, children })

const compactionSegment = (n) => (isNum(n) && n > 0 ? segment('compactions', [text(`⟲${n}`, { color: 'inactive' })]) : null)

// A node cut to `n` characters: leaves are kept from the left and the cut one ends in an ellipsis.
function clip(node, n) {
  if (lenOf(node) <= n) return node
  if (typeof node === 'string') return fit(node, n)
  if (!node || !Array.isArray(node.children)) return node
  const kids = []
  let left = n
  for (const k of node.children) {
    if (left <= 0) break
    const w = lenOf(k)
    kids.push(w <= left ? k : clip(k, left))
    left -= Math.min(w, left)
  }
  return { ...node, children: kids }
}

// Segments joined by a faint rail and packed greedily into rows no wider than `width`.
function pack(id, segments, width) {
  const parts = joinSegments(segments).filter((s) => !s.sep)
  const rows = []
  let cur = []
  let used = 0
  for (const raw of parts) {
    const part = clip(raw, width)
    const w = lenOf(part)
    if (cur.length > 0 && used + SEP_WIDTH + w > width) {
      rows.push(cur)
      cur = []
      used = 0
    }
    if (cur.length > 0) {
      cur.push(text(' ┊ ', { color: 'subtle' }))
      used += SEP_WIDTH
    }
    cur.push(part)
    used += w
  }
  if (cur.length > 0) rows.push(cur)
  return rows.map((kids, i) => line(`${id}-${i}`, kids))
}

// ---- sections (each returns rows; an empty array when it has nothing to show) ----

function mainRows({ panel, replica, nowMs }, width, mini) {
  if (mini) {
    // Only the context meter fits a mini panel.
    const ctx = replica ? budgetSegments(replica.usage, nowMs).filter((s) => s.props?.key === 'ctx') : []
    return pack('budget', ctx, width)
  }
  const out = []
  if (replica) out.push(...pack('budget', budgetSegments(replica.usage, nowMs), width))
  const where = replica ? whereSegments(replica) : []
  where.push(compactionSegment(panel.compactions))
  out.push(...pack('where', where, width))
  return out
}

function oddRows(odd, width) {
  if (!odd?.feature) return []
  const tail = ` · ${odd.open} open`
  const task = odd.task?.id ? odd.task : null
  let mid = ''
  if (task) {
    const lead = ` · ${task.id}`
    const avail = width - 4 - odd.feature.length - lead.length - 1 - tail.length
    mid = task.title && avail >= 4 ? `${lead} ${fit(task.title, avail)}` : lead
  }
  const feature = fit(odd.feature, Math.max(1, width - 4 - mid.length - tail.length))
  return [
    line(
      'odd',
      [text('ODD ', { color: 'claude' }), text(feature, { bold: true }), mid ? text(mid) : null, text(tail, { dim: true })].filter(Boolean),
    ),
  ]
}

function rddRows(rdd, width) {
  const segs = rddLine(rdd)
  return segs ? pack('rdd', segs, width) : []
}

function agentRows(panel, nowMs, width) {
  const { cards, rest } = agentsView(panel, nowMs, 3)
  const out = cards.map((a, i) => {
    const role = fit(String(a.role ?? 'agent'), width)
    const model = a.model ? ` ${a.model}${a.effort ? ` ${a.effort}` : ''} ·` : ''
    const tail = a.status === 'running' ? clock(a.elapsedMs) : 'done'
    const detail = `${model} ${kilo(a.ctx)} · ${a.steps ?? 0} steps · ${tail}`
    return line(`agent-${i}`, [text(role, { bold: true }), text(fit(detail, width - role.length), { dim: true })])
  })
  if (rest > 0) out.push(line('agents-more', [text(`+${rest} more`, { dim: true })]))
  return out
}

// One summary row for the mini layout.
function agentSummaryRows(panel, nowMs) {
  const { cards, rest, running } = agentsView(panel, nowMs, 0)
  const total = rest + cards.length
  if (total === 0) return []
  const parts = [text('agents ', { dim: true }), text(`${running} running`, running > 0 ? { color: 'suggestion', bold: true } : {})]
  if (total - running > 0) parts.push(text(` · ${total - running} done`, { dim: true }))
  return [line('agents-summary', parts)]
}

function inlineRows(inline, width) {
  if (!inline || !(inline.count > 0)) return []
  const path = inline.last ? ` · ${shortPath(inline.last)}` : ''
  return [line('inline', [text(fit(`inline writes ${inline.count}${path}`, width), { color: 'error', bold: true })])]
}

function deniedRows(gate, width) {
  if (!gate || !(gate.denied > 0)) return []
  const head = `denied ${gate.denied}`
  const last = gate.lastDenied
  const detail = last?.tool ? ` ${fit(`${last.tool}${last.detail ? `: ${last.detail}` : ''}`, width - head.length - 1)}` : ''
  return [line('gate-denied', [text(fit(head, width), { color: 'error', bold: true }), detail ? text(detail, { dim: true }) : null].filter(Boolean))]
}

function gateRows(gate, width) {
  if (!gate) return []
  const out = []
  const cells = Array.isArray(gate.cells) ? gate.cells.slice(-Math.max(0, width)) : []
  if (cells.length > 0) out.push(line('gate-cells', cells.map((c) => text('●', { color: CELL_COLOR[c] ?? 'inactive' }))))
  out.push(...deniedRows(gate, width))
  return out
}

function receiptRows(receipt, nowMs, width) {
  if (!receipt) return []
  const running = receipt.endedMs === null || receipt.endedMs === undefined
  const span = (running ? nowMs : receipt.endedMs) - receipt.startedMs
  const segs = [
    segment('turn', [text('turn ', { dim: true }), running ? text('running ', { color: 'suggestion' }) : null, text(clock(span), { bold: true })]),
    segment('agents', [text(`${receipt.agents ?? 0} agents`)]),
    segment('edits', [text(`${receipt.edits ?? 0} edits`)]),
    segment('errors', [text(`${receipt.errors ?? 0} errors`, receipt.errors > 0 ? { color: 'error', bold: true } : {})]),
    isNum(receipt.cost) ? segment('cost', [text(`$${receipt.cost.toFixed(2)}`, { dim: true })]) : null,
  ]
  return pack('receipt', segs, width)
}

// ---- the panel -------------------------------------------------------------

const column = (children, width) => ({ type: 'Box', props: { flexDirection: 'column', ...(width ? { width } : {}) }, children })

// Builds the panel body, or null when no section has anything to show. `columns`
// and `rows` are the Pane's bodyColumns and scroll.bodyRows.
export function buildPanel({ panel, replica, odd, rdd, nowMs, columns, rows }) {
  const state = panel ?? {}
  const kind = layoutFor(columns)
  const total = isNum(columns) && columns > 0 ? Math.floor(columns) : 80
  const cap = isNum(rows) && rows > 0 ? Math.floor(rows) : Infinity
  const data = { panel: state, replica, nowMs }
  const sections = (w, mini) => ({
    main: mainRows(data, w, mini),
    odd: oddRows(odd, w),
    rdd: rddRows(rdd, w),
    agents: mini ? agentSummaryRows(state, nowMs) : agentRows(state, nowMs, w),
    inline: inlineRows(state.inline, w),
    gate: gateRows(state.gate, w),
    receipt: receiptRows(state.receipt, nowMs, w),
  })

  if (kind === 'wide') {
    const left = Math.floor(total / 2)
    const l = sections(left - 2, false)
    const r = sections(total - left - 2, false)
    const leftRows = [...l.main, ...l.odd, ...l.rdd, ...l.receipt].slice(0, cap)
    const rightRows = [...r.agents, ...r.inline, ...r.gate].slice(0, cap)
    if (leftRows.length > 0 && rightRows.length > 0) {
      return { type: 'Box', props: { flexDirection: 'row' }, children: [column(leftRows, left), column(rightRows, total - left)] }
    }
  }

  let all
  if (kind === 'mini') {
    const s = sections(total, true)
    all = [...s.inline, ...s.odd, ...s.agents, ...s.main, ...s.rdd, ...s.gate, ...s.receipt].slice(0, Math.min(MINI_ROWS, cap))
  } else {
    const s = sections(total, false)
    all = [...s.main, ...s.odd, ...s.rdd, ...s.agents, ...s.inline, ...s.gate, ...s.receipt].slice(0, cap)
  }
  return all.length === 0 ? null : column(all)
}

// ---- the one-line summary for the shrunk AbovePrompt band -------------------

// ctx %, running agents, the active ODD task id, the RDD state, and an inline-write alert; null when none apply.
export function buildSummary({ panel, usage, odd, rdd, nowMs }) {
  const segs = []
  const ctx = clampPct(usage?.context?.percent)
  if (ctx !== null) segs.push(segment('ctx', [text('ctx ', { dim: true }), text(`${ctx}%`, { color: meterColor(ctx), bold: true })]))
  const running = agentsView(panel, nowMs, 0).running
  if (running > 0) segs.push(segment('agents', [text(`⚙ ${running} ${running === 1 ? 'agent' : 'agents'}`, { color: 'suggestion' })]))
  if (odd?.task?.id) segs.push(segment('odd', [text('ODD ', { color: 'claude' }), text(String(odd.task.id), { bold: true })]))
  const state = rdd && rdd.mode === 'on' ? rddLine(rdd)?.[1] : null
  if (state) segs.push(state)
  const writes = panel?.inline?.count
  if (isNum(writes) && writes > 0) segs.push(segment('inline', [text(`inline ${writes}`, { color: 'error', bold: true })]))
  return row('summary', segs)
}
