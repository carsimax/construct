// Pure layout for the Construct panel: titled blocks in one column, built for
// PANEL_COLUMNS (56) and degrading gracefully when the pane is narrower.
//
// Each block is a title row (`ODD`, `context`, ...), its item rows indented two
// spaces, and one blank row between blocks (none at the end). An item row has a
// dim label on the left and its value right-aligned to the pane width. A long
// value (feature, task title, path, details) wraps onto indented rows rather
// than being cut; an ellipsis is never drawn. Zero or empty counters are hidden
// and a block with no items is omitted. Block order: alerts, ODD, context,
// session, review, agents, gate, turn. When `rows` (scroll.bodyRows) would cut
// the panel, whole blocks are dropped from the bottom; only the first block may
// be cut.
//
// The pane is asked for PANEL_COLUMNS through `$.ui.open({ columns })`. That is a
// request: a width the user dragged or kept wins, so the layout reads the real
// width from `columns`. No `$` calls live here, so these run (and test) in
// isolation. The wiring passes the panel state (hooks/panel/state.js), the data
// the mod gathers, a clock, and the Pane's `bodyColumns` / `scroll.bodyRows`.
// Colors are theme keys only, as in hooks/status/format.js.

import { agentsView } from './state.js'
import { STATE_COLOR, bar, budgetMeters, meterColor, rddLine, shortDir, text } from '../status/format.js'

export const PANEL_COLUMNS = 56

const CELL_COLOR = { allowed: 'success', asked: 'suggestion', denied: 'error', sub: 'inactive' }
const INDENT = 2
const WRAP_INDENT = 4

// ---- small helpers ---------------------------------------------------------

const isNum = (x) => typeof x === 'number' && Number.isFinite(x)

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

// `s` in lines of at most `w` characters. Breaks fall at spaces, and after `-`, `/`, `_` or `.`
// inside a word; a piece longer than `w` is broken hard, so nothing is lost.
function wrap(s, w) {
  const width = Math.max(1, w)
  const pieces = String(s).match(/[^\s\-/_.]*[\-/_.]*\s*/g)?.filter(Boolean) ?? []
  const lines = []
  let cur = ''
  for (let piece of pieces) {
    while (piece.trimEnd().length > width) {
      if (cur) {
        lines.push(cur.trimEnd())
        cur = ''
      }
      lines.push(piece.slice(0, width))
      piece = piece.slice(width)
    }
    if ((cur + piece).trimEnd().length > width) {
      lines.push(cur.trimEnd())
      cur = ''
    }
    cur += piece
  }
  if (cur.trim()) lines.push(cur.trimEnd())
  return lines.length > 0 ? lines : ['']
}

// ---- rows ------------------------------------------------------------------

let seq = 0
// A row of nodes; keys only need to be unique inside one tree.
const line = (children) => ({ type: 'Box', props: { key: `r${seq++}`, flexDirection: 'row' }, children })
const blank = () => line([text(' ')])
const pad = (n) => text(' '.repeat(Math.max(0, n)))
const title = (name, color = 'claude') => line([text(name, { color, bold: true })])

// A value piece: { s, o } is a string and its text options.
const piece = (s, o = {}) => ({ s, o })
const plainLen = (pieces) => pieces.reduce((n, p) => n + p.s.length, 0)
const nodes = (pieces) => pieces.map((p) => text(p.s, p.o))

// Continuation rows for a long value, indented `by` columns, in the style `o`.
const wrapped = (s, o, width, by = WRAP_INDENT) => wrap(s, width - by).map((l) => line([pad(by), text(l, o)]))

// A label/value item. The value is right-aligned when it shares the row with the label;
// otherwise the label stands alone and the value wraps below it.
function item(label, pieces, width, labelOpts = { dim: true }) {
  const vs = pieces.filter(Boolean)
  const lead = INDENT + label.length
  if (lead + 2 + plainLen(vs) <= width) {
    return [line([pad(INDENT), text(label, labelOpts), pad(width - lead - plainLen(vs)), ...nodes(vs)])]
  }
  return [line([pad(INDENT), text(label, labelOpts)]), ...wrapped(vs.map((p) => p.s).join(''), vs[0]?.o ?? {}, width)]
}

// A free-form item: `head` bold on the left, `detail` wrapped (hanging indent) after it, right-aligned when it fits.
function entry(head, detail, width, { headOpts = { bold: true }, detailOpts = { dim: true } } = {}) {
  const lead = INDENT + head.length
  if (!detail) return [line([pad(INDENT), text(head, headOpts)])]
  if (lead + 2 + detail.length <= width) return [line([pad(INDENT), text(head, headOpts), pad(width - lead - detail.length), text(detail, detailOpts)])]
  return [line([pad(INDENT), text(head, headOpts)]), ...wrapped(detail, detailOpts, width)]
}

// ---- blocks (each returns rows; an empty array when it has nothing to show) ----

function alertsBlock(panel, width) {
  const err = { color: 'error', bold: true }
  const out = []
  const inline = panel.inline
  if (inline?.count > 0) {
    out.push(...item('inline writes', [piece(String(inline.count), err)], width, err))
    if (inline.last) out.push(...wrapped(shortPath(inline.last), { dim: true }, width))
  }
  const gate = panel.gate
  if (gate?.denied > 0) {
    out.push(...item('denied', [piece(String(gate.denied), err)], width, err))
    const last = gate.lastDenied
    if (last?.tool) out.push(...wrapped(`${last.tool}${last.detail ? `: ${last.detail}` : ''}`, { dim: true }, width))
  }
  return out.length > 0 ? [title('alerts', 'error'), ...out] : []
}

function oddBlock(odd, width) {
  if (!odd?.feature) return []
  const out = [title('ODD'), ...item('feature', [piece(odd.feature, { bold: true })], width)]
  const task = odd.task?.id ? odd.task : null
  if (task) {
    const lead = INDENT + task.id.length + 2
    const lines = task.title ? wrap(task.title, width - lead) : []
    out.push(line([pad(INDENT), text(task.id, { bold: true }), ...(lines.length > 0 ? [pad(2), text(lines[0])] : [])]))
    for (const l of lines.slice(1)) out.push(line([pad(lead), text(l)]))
  }
  out.push(...item('open', [piece(String(odd.open ?? 0), { bold: true })], width))
  return out
}

// ctx / 5h / 7d: label, bar and percent in aligned columns, the reset right-aligned.
function contextBlock(replica, nowMs, width) {
  if (!replica) return []
  const meters = budgetMeters(replica.usage, nowMs)
  if (meters.length === 0) return []
  const labelW = Math.max(...meters.map((m) => m.label.length))
  const rows = meters.map((m) => {
    const color = meterColor(m.pct)
    const cells = bar(m.pct)
    const left = [
      pad(INDENT),
      text(m.label.padEnd(labelW), { dim: true }),
      pad(2),
      cells.filled ? text(cells.filled, { color }) : null,
      text(cells.empty, { dim: true }),
      text(`${m.pct}%`.padStart(5), { color, bold: true }),
    ].filter(Boolean)
    const used = INDENT + labelW + 2 + cells.filled.length + cells.empty.length + 5
    if (!m.reset) return line(left)
    const reset = `↻${m.reset}`
    return line([...left, pad(Math.max(2, width - used - reset.length)), text(reset, { dim: true })])
  })
  return [title('context'), ...rows]
}

function sessionBlock(panel, replica, width) {
  if (!replica) return []
  const out = []
  if (replica.dir) out.push(...item('dir', [piece(shortDir(replica.dir, replica.home), { color: 'claude', bold: true })], width))
  const git = replica.git
  if (git?.branch) {
    const o = (color) => ({ color })
    out.push(
      ...item(
        'git',
        [
          piece(`⎇ ${git.branch}`, o('suggestion')),
          git.dirty > 0 ? piece(` ±${git.dirty}`, o('warning')) : null,
          git.ahead > 0 ? piece(` ↑${git.ahead}`, o('success')) : null,
          git.behind > 0 ? piece(` ↓${git.behind}`, o('error')) : null,
          replica.worktree ? piece(` wt:${replica.worktree}`, o('inactive')) : null,
        ],
        width,
      ),
    )
  }
  if (replica.model) {
    out.push(...item('model', [piece(replica.model, { bold: true }), replica.effort ? piece(` ${replica.effort}`, { dim: true }) : null], width))
  }
  if (replica.style) out.push(...item('style', [piece(String(replica.style), { color: 'inactive' })], width))
  if (replica.agent) out.push(...item('agent', [piece(`@${replica.agent}`, { color: 'suggestion' })], width))
  if (panel.compactions > 0) out.push(...item('compactions', [piece(`⟲${panel.compactions}`, { color: 'inactive' })], width))
  return out.length > 0 ? [title('session'), ...out] : []
}

function reviewBlock(rdd, width) {
  if (!rddLine(rdd)) return []
  const out = [title('review'), ...item('rdd', [piece(rdd.mode, { bold: true })], width)]
  if (rdd.mode === 'on' && rdd.state) {
    out.push(...item('state', [piece(rdd.state, { color: STATE_COLOR[rdd.state], bold: rdd.state === 'review due', dim: rdd.state === 'clear' })], width))
  }
  return out
}

function agentsBlock(panel, nowMs, width) {
  const { cards, rest } = agentsView(panel, nowMs, 3)
  if (cards.length === 0) return []
  const out = cards.flatMap((a) => {
    const model = a.model ? `${a.model}${a.effort ? ` ${a.effort}` : ''} · ` : ''
    const tail = a.status === 'running' ? clock(a.elapsedMs) : 'done'
    return entry(String(a.role ?? 'agent'), `${model}${kilo(a.ctx)} · ${a.steps ?? 0} steps · ${tail}`, width)
  })
  if (rest > 0) out.push(line([pad(INDENT), text(`+${rest} more`, { dim: true })]))
  return [title('agents'), ...out]
}

function gateBlock(gate, width) {
  const cells = Array.isArray(gate?.cells) ? gate.cells.slice(-Math.max(0, width - INDENT)) : []
  if (cells.length === 0) return []
  return [title('gate'), line([pad(INDENT), ...cells.map((c) => text('●', { color: CELL_COLOR[c] ?? 'inactive' }))])]
}

function turnBlock(receipt, nowMs, width) {
  if (!receipt) return []
  const running = receipt.endedMs === null || receipt.endedMs === undefined
  const span = (running ? nowMs : receipt.endedMs) - receipt.startedMs
  const count = (n) => (n > 0 ? n : 0)
  const out = [
    ...item('time', [running ? piece('running ', { color: 'suggestion' }) : null, piece(clock(span), { bold: true })], width),
    ...(count(receipt.agents) ? item('agents', [piece(String(receipt.agents), { bold: true })], width) : []),
    ...(count(receipt.edits) ? item('edits', [piece(String(receipt.edits), { bold: true })], width) : []),
    ...(count(receipt.errors) ? item('errors', [piece(String(receipt.errors), { color: 'error', bold: true })], width) : []),
    ...(isNum(receipt.cost) ? item('cost', [piece(`$${receipt.cost.toFixed(2)}`, { dim: true })], width) : []),
  ]
  return [title('turn'), ...out]
}

// ---- the panel -------------------------------------------------------------

// Builds the panel body, or null when no block has anything to show. `columns`
// and `rows` are the Pane's bodyColumns and scroll.bodyRows.
export function buildPanel({ panel, replica, odd, rdd, nowMs, columns, rows }) {
  const state = panel ?? {}
  const width = isNum(columns) && columns > 0 ? Math.floor(columns) : PANEL_COLUMNS
  const cap = isNum(rows) && rows > 0 ? Math.floor(rows) : Infinity
  const blocks = [
    alertsBlock(state, width),
    oddBlock(odd, width),
    contextBlock(replica, nowMs, width),
    sessionBlock(state, replica, width),
    reviewBlock(rdd, width),
    agentsBlock(state, nowMs, width),
    gateBlock(state.gate, width),
    turnBlock(state.receipt, nowMs, width),
  ].filter((b) => b.length > 0)
  const all = []
  for (const block of blocks) {
    if (all.length === 0) {
      all.push(...block.slice(0, cap))
    } else if (all.length + 1 + block.length <= cap) {
      all.push(blank(), ...block)
    } else {
      break
    }
  }
  return all.length === 0 ? null : { type: 'Box', props: { flexDirection: 'column' }, children: all }
}
