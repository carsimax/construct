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

// Pure layout for the Construct panel: flightdeck's card layout with the ODD cycle.
//
// One column at any width (S1), asked at PANEL_COLUMNS (66) through `$.ui.open({ columns })`.
// That is a request: a width the user dragged or kept wins, so the layout reads the real width from
// `columns` (never below 40). Top to bottom:
//
//   header   CONSTRUCT · <MODEL> <IDLE|BUSY> · ODD <task id>, then the five-item color legend
//   main     round card: model, idle/busy, effort meter, mode, requests, ctx gauge, cost, 5h and 7d
//   rail
//   ODD      hidden without a feature: feature, current task, one checkpoint per task
//   REVIEW   hidden unless RDD is on: its state word
//   rail
//   GATE     stacked verdict bar, allowed / decider / pending / denied, buckets, last denied, inline alert
//   agents   one row per agent: mark, role, timeline bar on the session span, clock
//   turn     round card: last (or running) turn duration, agents, edits, errors, cost added
//   log      round `session log` card, rows clamped by logRows
//
// Cards that have nothing to show are left out; the main card always shows (it does not depend on
// a statusLine, S3). Colors are theme keys only (draw.js PALETTE). Rows are `Text` elements with
// `wrap: 'truncate'` holding nested `Text` pieces, so the pane clips a long row and nothing here pads
// to the width except the timeline and the stacked bar, which are sized from it.
//
// `client: true` lets the tree carry `Client` elements: `./rail.tsx` for the rails and
// `./elapsed.tsx` for running clocks. A `Client` module path is a string literal relative to the file
// that holds the element (index.d.ts: ClientProps.module); the elements are plain objects here, built
// in this file next to rail.tsx and elapsed.tsx, so the literals below are relative to this file.
// Without `client` (a surface with no `Client`) the rails are a static `─` line and clocks are static.
//
// No `$` calls live here, so these run (and test) in isolation. The wiring passes the panel state
// (hooks/panel/state.js), the session usage, a clock and the Pane's `bodyColumns` / `scroll.bodyRows`.

import { agentsView, mainBusy, maskSecrets } from './state.js'
import { PALETTE, card, effortMeter, fmtResetIn, gauge, laneBar, lanes, logRows, panelBox, stackBar } from './draw.js'
import { STATE_COLOR, text } from '../status/format.js'

export const PANEL_COLUMNS = 66

const MIN_COLUMNS = 40
const MAX_AGENT_ROWS = 6
const WHO_WIDTH = 14

// ---- small helpers ---------------------------------------------------------

const isNum = (x) => typeof x === 'number' && Number.isFinite(x)
const two = (n) => String(n).padStart(2, '0')

// `s` clipped to `w` cells, with an ellipsis when it was cut.
const fit = (s, w) => (s.length <= w ? s : w <= 1 ? s.slice(0, Math.max(0, w)) : `${s.slice(0, w - 1)}…`)

// m:ss, or XhYY from an hour on (the Elapsed client's format).
function clock(ms) {
  const s = Math.max(0, Math.floor((isNum(ms) ? ms : 0) / 1000))
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}:${two(s % 60)}` : `${Math.floor(m / 60)}h${two(m % 60)}`
}

// 17s, 1m05s.
function duration(ms) {
  const s = Math.max(0, Math.floor((isNum(ms) ? ms : 0) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${two(s % 60)}s`
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// 666000 -> 666k, 1000000 -> 1.0M.
function kTokens(n) {
  if (!isNum(n)) return ''
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(Math.round(n))
}

const money = (usd) => `$${usd >= 100 ? Math.round(usd) : usd.toFixed(2)}`

// The last two path parts, so a long path stays readable.
function shortPath(path) {
  const parts = String(path).split('/').filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : parts.join('/')
}

// 'claude-opus-5-5' -> 'Opus 5.5', 'opus[1m]' -> 'Opus', 'claude-opus-4-1-20250805' -> 'Opus 4.1'.
export function prettyModel(model) {
  if (typeof model !== 'string' || model === '') return 'Claude'
  const parts = model.replace(/^claude-/, '').replace(/\[.*\]$/, '').split('-').filter(Boolean)
  const family = parts.find((p) => !/^\d+$/.test(p))
  if (!family) return 'Claude'
  const version = parts.filter((p) => /^\d{1,2}$/.test(p)).slice(0, 2)
  return `${family[0].toUpperCase()}${family.slice(1)}${version.length > 0 ? ` ${version.join('.')}` : ''}`
}

// HH:MM:SS of an epoch time. A number `tzOffsetMin` formats in UTC plus that many minutes (tests, a
// fixed zone); otherwise the machine's local time.
export function formatClock(ms, tzOffsetMin) {
  if (!isNum(ms)) return '--:--:--'
  if (isNum(tzOffsetMin)) {
    const d = new Date(ms + tzOffsetMin * 60_000)
    return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}`
  }
  const d = new Date(ms)
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}

// ---- elements --------------------------------------------------------------

// A one-row piece list: Texts inside a truncating Text, as flightdeck draws its rows.
const line = (...pieces) => ({ type: 'Text', props: { wrap: 'truncate' }, children: pieces.flat().filter(Boolean) })
const row = (children) => ({ type: 'Box', props: { flexDirection: 'row' }, children: children.filter(Boolean) })
const faint = (s) => text(s, { color: PALETTE.faint })
const dim = (s) => text(s, { dim: true })

// Rows an element takes: Text and Client one, a column Box the sum of its children plus border and margin.
function height(node) {
  if (!node || typeof node === 'string') return 0
  if (node.type !== 'Box' || node.props?.flexDirection !== 'column') return 1
  const own = (node.props.borderStyle ? 2 : 0) + (node.props.marginTop ?? 0)
  return own + (node.children ?? []).reduce((n, k) => n + height(k), 0)
}

let seq = 0
const key = (name) => `${name}-${seq++}`

// ---- header ----------------------------------------------------------------

const LEGEND = [
  ['main', PALETTE.main],
  ['agents', PALETTE.agent],
  ['gate', PALETTE.gate],
  ['odd', PALETTE.odd],
  ['review', PALETTE.cleared],
]

function headerRows(model, busy, odd) {
  const task = odd?.feature ? (odd.task?.id ?? odd.feature) : null
  const title = {
    type: 'Text',
    props: { bold: true, wrap: 'truncate' },
    children: [
      text('CONSTRUCT'),
      text(' · ', { color: PALETTE.dim }),
      text(model.toUpperCase(), { color: PALETTE.main }),
      text(busy ? ' BUSY' : ' IDLE'),
      task ? text(' · ', { color: PALETTE.dim }) : null,
      task ? text('ODD', { color: PALETTE.odd }) : null,
      task ? text(` ${task}`) : null,
    ].filter(Boolean),
  }
  return [
    { type: 'Box', props: { justifyContent: 'center' }, children: [title] },
    {
      type: 'Box',
      props: { justifyContent: 'center', columnGap: 2 },
      children: LEGEND.map(([label, color]) => line(text('■', { color }), dim(` ${label}`))),
    },
  ]
}

// ---- main card (S3) ------------------------------------------------------------

// A gauge with its percent and, when the window's ISO `resetsAt` is in the future, `↻` and the time left.
function limitPiece(label, pct, resetsAt, nowMs) {
  const g = gauge(pct, 5)
  const at = typeof resetsAt === 'string' ? Date.parse(resetsAt) : NaN
  const left = fmtResetIn(at, nowMs)
  return [dim(`${label} `), text(g.on, { color: pct >= 80 ? PALETTE.warn : PALETTE.main }), faint(g.off), dim(` ${Math.round(pct)}%${left ? ` ↻${left}` : ''}`)]
}

function mainCard({ main, usage, model, busy, compactions, width, nowMs }) {
  const effort = main?.effort ?? null
  const meter = effortMeter(effort)
  const ctx = usage?.context
  const pct = isNum(ctx?.percent) ? Math.max(0, Math.min(100, ctx.percent)) : null
  const rows = [
    line(
      dim('effort '),
      text(`${meter.on}${meter.off} `, { color: PALETTE.main }),
      text(effort ?? '—', { color: PALETTE.main, bold: true }),
      main?.mode ? dim(`   mode ${main.mode}`) : null,
      dim(`   ${main?.steps ?? 0} req`),
    ),
  ]
  if (pct !== null) {
    const g = gauge(pct, 10)
    rows.push(
      line(
        dim('ctx '),
        text(g.on, { color: pct >= 80 ? PALETTE.warn : PALETTE.main }),
        faint(g.off),
        text(` ${Math.round(pct)}%`, { bold: true }),
        isNum(ctx?.tokens) ? dim(` ${kTokens(ctx.tokens)}/${kTokens(ctx.window)}`) : null,
        compactions > 0 ? text(`  ⟲${compactions}`, { color: PALETTE.amber }) : null,
      ),
    )
  }
  const limits = (Array.isArray(usage?.rateLimits) ? usage.rateLimits : [])
    .filter((l) => isNum(l?.percentUsed) && (l.kind === 'five_hour' || l.kind === 'seven_day'))
    .map((l) => limitPiece(l.kind === 'five_hour' ? '5h' : '7d', l.percentUsed, l.resetsAt, nowMs))
  const usd = usage?.cost?.usd
  if (isNum(usd) || limits.length > 0) {
    const parts = [isNum(usd) ? [text(money(usd), { color: PALETTE.text })] : null, ...limits].filter(Boolean)
    rows.push(line(parts.flatMap((p, i) => (i === 0 ? p : [text('   '), ...p]))))
  }
  return card({
    title: `${model} · main`,
    status: busy ? '● busy' : { text: '○ idle', color: PALETTE.dim },
    color: PALETTE.main,
    children: rows,
    width,
  })
}

// ---- ODD card (S4) ------------------------------------------------------------

// One checkpoint per task: done filled, the first unfinished one highlighted, the rest hollow.
function checkpoints(tasks, room) {
  const firstOpen = tasks.findIndex((t) => !t.done)
  const marks = tasks.map((t, i) =>
    t.done ? text('●', { color: PALETTE.odd }) : i === firstOpen ? text('◆', { color: PALETTE.odd, bold: true }) : text('○', { dim: true }),
  )
  // Too many to fit: keep the latest ones.
  const keep = Math.max(1, Math.floor((room + 1) / 2))
  const shown = marks.slice(-keep)
  const first = tasks.length - shown.length
  return line(
    first > 0 ? [dim('…')] : null,
    shown.flatMap((m, i) => (i === 0 ? [m] : [text('━', { color: tasks[first + i - 1].done && tasks[first + i].done ? PALETTE.odd : PALETTE.faint }), m])),
  )
}

function oddCard(odd, width) {
  if (!odd?.feature) return null
  const iw = width - 4
  const status = `${odd.open ?? 0} open`
  const rows = []
  if (odd.task?.id) {
    const lead = odd.task.id.length + 2
    rows.push(line(text(odd.task.id, { bold: true }), odd.task.title ? text(`  ${fit(odd.task.title, iw - lead)}`) : null))
  }
  if (Array.isArray(odd.tasks) && odd.tasks.length > 0) rows.push(checkpoints(odd.tasks, iw))
  return card({
    title: `ODD · ${fit(odd.feature, Math.max(8, iw - status.length - 6))}`,
    status: { text: status, dim: true },
    color: PALETTE.odd,
    children: rows,
    width,
  })
}

// ---- REVIEW card (S5) ---------------------------------------------------------

function reviewCard(rdd, width) {
  if (rdd?.mode !== 'on') return null
  const state = rdd.state
  const color = state ? STATE_COLOR[state] : undefined
  return card({
    title: 'REVIEW · rdd on',
    status: state ? (color ? { text: state, color } : { text: state, dim: true }) : null,
    color: PALETTE.cleared,
    width,
  })
}

// ---- GATE card (S6) ------------------------------------------------------------

const bucketTotal = (b) => (b ? (b.rule ?? 0) + (b.ask ?? 0) + (b.cleared ?? 0) + (b.deny ?? 0) : 0)

function gateCard({ gate, inline, mode, width }) {
  const v = gate?.verdicts ?? { rule: 0, ask: 0, cleared: 0, deny: 0 }
  const total = v.rule + v.ask + v.cleared + v.deny
  const hasInline = inline?.count > 0
  if (total === 0 && !hasInline) return null
  const iw = width - 4
  const rows = []
  if (total === 0) {
    rows.push(line(faint('no checks yet')))
  } else {
    const order = [
      ['rule', PALETTE.gate],
      ['cleared', PALETTE.cleared],
      ['ask', PALETTE.amber],
      ['deny', PALETTE.warn],
    ]
    const cells = stackBar(order.map(([k]) => v[k]), iw)
    rows.push(row(order.map(([, color], i) => (cells[i] > 0 ? text('█'.repeat(cells[i]), { color }) : null))))
    const decider = mode === 'auto' ? 'classifier' : 'you'
    rows.push(
      line(
        text('■', { color: PALETTE.gate }),
        dim(` ${v.rule} allowed  `),
        text('■', { color: PALETTE.cleared }),
        dim(` ${v.cleared} ${decider}  `),
        v.ask > 0 ? text(`■ ${v.ask} pending  `, { color: PALETTE.amber }) : null,
        text(`✗ ${v.deny} denied`, { color: v.deny > 0 ? PALETTE.warn : PALETTE.dim }),
      ),
    )
    const b = gate.buckets ?? {}
    rows.push(
      line(
        ['file', 'shell', 'other'].flatMap((name, i) => {
          const n = bucketTotal(b[name])
          return [i > 0 ? text('  ') : null, text(`${name[0]}: ${name} ${n}`, { dim: n === 0 })]
        }),
      ),
    )
  }
  const last = gate?.lastDenied
  if (last?.tool) {
    rows.push(line(text(`✗ ${maskSecrets(`${last.tool}${last.detail ? `: ${last.detail}` : ''}`)}`, { color: PALETTE.warn })))
  }
  if (hasInline) {
    const where = inline.last ? ` · ${shortPath(maskSecrets(inline.last))}` : ''
    rows.push(line(text(`⚠ ${plural(inline.count, 'inline write')}${where}`, { color: PALETTE.warn })))
  }
  return card({ title: 'GATE · permissions', status: { text: `${total} checks`, dim: true }, color: PALETTE.gate, children: rows, width })
}

// ---- agents (S7) -----------------------------------------------------------------

const AGENT_MARK = { running: ['◐', PALETTE.agent], done: ['✓', PALETTE.gate], failed: ['✗', PALETTE.warn] }

// A clock: static text, or a Client elapsed element for a running one when the pane has Clients.
function clockPiece(name, since, endAt, color, nowMs, client) {
  if (!isNum(since) || since <= 0) return text('—', { color })
  if (client && endAt === null) {
    return { type: 'Client', props: { key: name, module: './elapsed.tsx', props: { since, now: nowMs, endAt, color } } }
  }
  return text(clock((endAt ?? nowMs) - since), { color })
}

function agentsRows(panel, nowMs, width, client) {
  const view = agentsView(panel, nowMs, MAX_AGENT_ROWS)
  if (view.cards.length === 0) return []
  const shown = [...view.cards].sort((a, b) => (a.startedMs ?? 0) - (b.startedMs ?? 0))
  const geo = lanes(shown, nowMs, Math.max(8, width - 28))
  const total = Array.isArray(panel.agents) ? panel.agents.length : shown.length
  const out = [line(text(`agents · ${view.running} running · ${total} total`, { bold: true }))]
  if (view.rest > 0) out.push(line(faint(`+${view.rest} earlier`)))
  shown.forEach((a, i) => {
    const [mark, color] = AGENT_MARK[a.status] ?? AGENT_MARK.done
    const bar = laneBar(geo[i])
    const label = fit(`${i + 1}: ${a.role ?? 'agent'}`, 16).padEnd(17)
    const end = a.status === 'running' ? null : isNum(a.endedMs) ? a.endedMs : nowMs
    out.push(
      row([
        text(`${mark} `, { color }),
        text(label),
        faint(` ${bar.before}`),
        text(bar.bar, { color }),
        faint(`${bar.after} `),
        clockPiece(`agent-clock-${a.id}`, a.startedMs, end, PALETTE.dim, nowMs, client),
      ]),
    )
  })
  return out
}

// ---- last turn (S8) ----------------------------------------------------------------

const TURN_LABEL = '◐ turn '
const CLOCK_ROOM = 6 // m:ss up to 59:59, XhYY after

function turnCard(receipt, nowMs, width, client) {
  if (!receipt) return null
  const running = receipt.endedMs === null || receipt.endedMs === undefined
  const counts = ` · ${plural(receipt.agents ?? 0, 'agent')} · ${plural(receipt.edits ?? 0, 'edit')} · ${plural(receipt.errors ?? 0, 'error')}`
  const body = running
    ? line(
        text(TURN_LABEL, { color: PALETTE.main }),
        clockPiece('turn-clock', receipt.startedMs, null, PALETTE.main, nowMs, client),
        // The row loses `wrap: 'truncate'` when it holds a Client (register.js realize), so its static
        // parts are sized here: the card interior less the label and the clock's room.
        dim(client ? fit(counts, Math.max(0, width - 4 - TURN_LABEL.length - CLOCK_ROOM)) : counts),
      )
    : line(
        text('✓ ', { color: PALETTE.gate }),
        text(`last turn ${duration(receipt.endedMs - receipt.startedMs)}${counts}`),
        isNum(receipt.cost) ? text(` · +${money(receipt.cost)}`, { color: PALETTE.main }) : null,
      )
  return panelBox({ color: PALETTE.main, dim: !running, width, children: [body] })
}

// ---- session log (S9) ----------------------------------------------------------------

function whoColor(who) {
  if (who === 'main') return PALETTE.main
  if (who === 'gate') return PALETTE.gate
  if (who === 'odd') return PALETTE.odd
  if (who === 'review') return PALETTE.cleared
  if (who === 'you') return PALETTE.text
  return PALETTE.agent
}

function logCard({ log, bodyRows, used, width, tzOffsetMin }) {
  const n = logRows(isNum(bodyRows) && bodyRows > 0 ? bodyRows : Infinity, used)
  if (n < 1) return null
  const rows = (Array.isArray(log) ? log : []).slice(-n)
  const body = rows.map((r) =>
    row([
      faint(`${formatClock(r.atMs, tzOffsetMin)} `),
      text(fit(r.who, WHO_WIDTH - 1).padEnd(WHO_WIDTH), { color: whoColor(r.who), bold: true }),
      text(fit(r.what, Math.max(1, width - 4 - 9 - WHO_WIDTH))),
    ]),
  )
  return panelBox({
    color: PALETTE.faint,
    marginTop: 1,
    width,
    children: [line(dim('session log')), ...(body.length > 0 ? body : [line(faint('nothing yet'))])],
  })
}

// ---- rail ------------------------------------------------------------------------------

function rail(name, active, width, client) {
  if (!client) return line(faint('─'.repeat(width)))
  return {
    type: 'Client',
    props: {
      key: name,
      module: './rail.tsx',
      width,
      height: 1,
      props: { active, width, color: PALETTE.main, dim: PALETTE.faint, marks: [], isMerge: false },
    },
  }
}

// ---- the panel -------------------------------------------------------------------------

// Builds the panel body; the main card always shows, so it is never null. `columns` and `rows` are
// the Pane's bodyColumns and scroll.bodyRows. `usage` is `$.session.usage()`, `model` and `effort` are
// the fallbacks for a main thread that has not made a request yet (the state's `main` wins). `client`
// says the surface can draw `Client` elements. `tzOffsetMin` fixes the log's time zone (UTC plus
// minutes); omitted, the log shows local time.
export function buildPanel({ panel, usage, odd, rdd, nowMs, columns, rows, model, effort, client = false, tzOffsetMin }) {
  const state = panel ?? {}
  const width = isNum(columns) && columns > 0 ? Math.max(MIN_COLUMNS, Math.floor(columns)) : PANEL_COLUMNS
  const busy = mainBusy(state)
  const main = { ...state.main, effort: state.main?.effort ?? effort ?? null }
  const name = prettyModel(state.main?.model ?? model)
  const showClient = client === true

  const children = headerRows(name, busy, odd)
  const push = (el) => {
    if (el) children.push(el)
    return Boolean(el)
  }
  push(mainCard({ main, usage, model: name, busy, compactions: state.compactions ?? 0, width, nowMs }))
  const above = [oddCard(odd, width), reviewCard(rdd, width)].filter(Boolean)
  const gate = gateCard({ gate: state.gate, inline: state.inline, mode: state.main?.mode, width })
  if (above.length > 0) {
    children.push(rail('rail-main', busy, width, showClient), ...above)
  }
  if (gate) children.push(rail('rail-gate', busy, width, showClient), gate)
  children.push(...agentsRows(state, nowMs, width, showClient))
  push(turnCard(state.receipt, nowMs, width, showClient))
  const used = children.reduce((n, k) => n + height(k), 0)
  push(logCard({ log: state.log, bodyRows: rows, used, width, tzOffsetMin }))
  return { type: 'Box', props: { flexDirection: 'column', width }, children }
}
