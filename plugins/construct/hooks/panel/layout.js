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
// `columns` (never below 40). Every section is a `card()` of that width (round border, bold title
// left, status right); the borders separate the sections, there are no rails. Top to bottom:
//
//   main     model, idle/busy, effort meter, mode, requests, ctx gauge, 5h and 7d
//   ODD      hidden without a feature: feature, current task, one checkpoint per task
//   REVIEW   hidden unless RDD is on: its state word
//   GATE     stacked verdict bar, allowed / decider / pending / denied, buckets, last denied, inline alert
//   agents   `N running · M total`; one row per agent: mark, short name, routed model and effort, elapsed
//   changes  titled with the branch, `↑N ↓N` on the right, one row per changed file
//            (`+added -removed`), rows clamped by changeRows with a `+N more` row when cut
//
// Cards that have nothing to show are left out; the main card always shows (it does not depend on
// a statusLine, S3). Colors are theme keys only (draw.js PALETTE). Rows are `Text` elements with
// `wrap: 'truncate'` holding nested `Text` pieces, so the pane clips a long row and nothing here pads
// to the width except the stacked bar, which is sized from it. Clocks are static text computed at
// each redraw; no `Client` element is built here.
//
// No `$` calls live here, so these run (and test) in isolation. The wiring passes the panel state
// (hooks/panel/state.js), the session usage, a clock and the Pane's `bodyColumns` / `scroll.bodyRows`.

import { agentsView, mainBusy, maskSecrets, phaseOf, shortName } from './state.js'
import { PALETTE, card, changeRows, effortMeter, fmtResetIn, gauge, stackBar } from './draw.js'
import { STATE_COLOR, text } from '../status/format.js'

export const PANEL_COLUMNS = 66

const MIN_COLUMNS = 40
const MAX_AGENT_ROWS = 6

// ---- small helpers ---------------------------------------------------------

const isNum = (x) => typeof x === 'number' && Number.isFinite(x)
const two = (n) => String(n).padStart(2, '0')

// `s` clipped to `w` cells, with an ellipsis when it was cut.
const fit = (s, w) => (s.length <= w ? s : w <= 1 ? s.slice(0, Math.max(0, w)) : `${s.slice(0, w - 1)}…`)

// m:ss, or XhYY from an hour on.
export function clock(ms) {
  const s = Math.max(0, Math.floor((isNum(ms) ? ms : 0) / 1000))
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}:${two(s % 60)}` : `${Math.floor(m / 60)}h${two(m % 60)}`
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// 666000 -> 666k, 1000000 -> 1.0M.
function kTokens(n) {
  if (!isNum(n)) return ''
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(Math.round(n))
}


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

// ---- elements --------------------------------------------------------------

// A one-row piece list: Texts inside a truncating Text, as flightdeck draws its rows.
const line = (...pieces) => ({ type: 'Text', props: { wrap: 'truncate' }, children: pieces.flat().filter(Boolean) })
const row = (children) => ({ type: 'Box', props: { flexDirection: 'row' }, children: children.filter(Boolean) })
const faint = (s) => text(s, { color: PALETTE.faint })
const dim = (s) => text(s, { dim: true })

// Rows an element takes: a Text one, a column Box the sum of its children.
function height(node) {
  if (!node || typeof node === 'string') return 0
  if (node.type !== 'Box' || node.props?.flexDirection !== 'column') return 1
  const own = (node.props.borderStyle ? 2 : 0) + (node.props.marginTop ?? 0)
  return own + (node.children ?? []).reduce((n, k) => n + height(k), 0)
}

let seq = 0
const key = (name) => `${name}-${seq++}`

// ---- main card (S3) ------------------------------------------------------------

// A gauge with its percent and, when the window's ISO `resetsAt` is in the future, `↻` and the time left.
function limitPiece(label, pct, resetsAt, nowMs) {
  const g = gauge(pct, 5)
  const at = typeof resetsAt === 'string' ? Date.parse(resetsAt) : NaN
  const left = fmtResetIn(at, nowMs)
  return [dim(`${label} `), text(g.on, { color: pct >= 80 ? PALETTE.warn : PALETTE.main }), faint(g.off), dim(` ${Math.round(pct)}%${left ? ` ↻${left}` : ''}`)]
}

function mainCard({ main, usage, model, busy, phase, blocked, compactions, branch, width, nowMs }) {
  const effort = main?.effort ?? null
  const meter = effortMeter(effort)
  const ctx = usage?.context
  const pct = isNum(ctx?.percent) ? Math.max(0, Math.min(100, ctx.percent)) : null
  const name = stripControl(branch ?? '')
  const rows = [
    name ? line(dim('⎇ '), text(fit(name, width - 4 - 2))) : null,
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
  if (limits.length > 0) {
    rows.push(line(limits.flatMap((p, i) => (i === 0 ? p : [text('   '), ...p]))))
  }
  return card({
    title: model,
    // Waiting on the human outranks busy and idle: one indicator, no extra row (S8b).
    status: blocked ? { text: '◆ blocked', color: PALETTE.amber } : busy ? `● ${phase ?? 'busy'}` : { text: '○ idle', color: PALETTE.dim },
    color: PALETTE.main,
    children: rows.filter(Boolean),
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

// ---- agents (S1) -----------------------------------------------------------------

const AGENT_MARK = { running: ['◐', PALETTE.agent], done: ['✓', PALETTE.gate], failed: ['✗', PALETTE.warn] }
const MAX_NAME = 18

// A clock: static text, `—` when the start is unknown.
function clockPiece(since, endAt, color, nowMs) {
  if (!isNum(since) || since <= 0) return text('—', { color })
  return text(clock((endAt ?? nowMs) - since), { color })
}

function agentsCard(panel, nowMs, width) {
  const view = agentsView(panel, nowMs, MAX_AGENT_ROWS)
  if (view.cards.length === 0) return null
  const shown = [...view.cards].sort((a, b) => (a.startedMs ?? 0) - (b.startedMs ?? 0))
  const total = Array.isArray(panel.agents) ? panel.agents.length : shown.length
  const names = shown.map((a) => fit(stripControl(shortName(a)), MAX_NAME))
  const pad = Math.max(...names.map((n) => n.length))
  const body = []
  if (view.rest > 0) body.push(line(faint(`+${view.rest} earlier`)))
  shown.forEach((a, i) => {
    const [mark, color] = AGENT_MARK[a.status] ?? AGENT_MARK.done
    const meter = a.effort ? effortMeter(a.effort) : null
    const end = a.status === 'running' ? null : isNum(a.endedMs) ? a.endedMs : nowMs
    body.push(
      line(
        text(`${mark} `, { color }),
        text(names[i].padEnd(pad)),
        dim(`  ${a.model ? prettyModel(a.model) : '—'}`),
        meter ? text(` ${meter.on}${meter.off}`, { color: PALETTE.agent }) : null,
        text('  '),
        clockPiece(a.startedMs, end, PALETTE.dim, nowMs),
      ),
    )
  })
  return card({ title: 'agents', status: { text: `${view.running} running · ${total} total`, dim: true }, color: PALETTE.agent, children: body, width })
}

// ---- changes card (S9) ----------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const stripControl = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f]/g, '')

// `path` in `w` cells with its basename kept: leading directories fall away as `…/dir/name`, and a
// basename longer than the room is itself clipped.
function fitPath(path, w) {
  if (path.length <= w) return path
  const parts = path.split('/').filter(Boolean)
  const base = parts.at(-1) ?? path
  if (w <= 2 || base.length + 2 > w) return fit(base, w)
  let out = base
  for (let i = parts.length - 2; i >= 0; i--) {
    const next = `${parts[i]}/${out}`
    if (next.length + 2 > w) break
    out = next
  }
  return `…/${out}`
}

const linesOf = (f) => (isNum(f.added) ? f.added : 0) + (isNum(f.removed) ? f.removed : 0)

// The stat pieces of one file: `+added -removed`, `bin` for a binary file, `+added` for an untracked
// file with a known count and `new` without one.
function statPieces(f) {
  if (f.binary) return { len: 3, pieces: [dim('bin')] }
  if (f.untracked && !isNum(f.added)) return { len: 3, pieces: [dim('new')] }
  const add = `+${f.added ?? 0}`
  if (f.untracked) return { len: add.length, pieces: [text(add, { color: PALETTE.gate })] }
  const del = `-${f.removed ?? 0}`
  return { len: add.length + 1 + del.length, pieces: [text(add, { color: PALETTE.gate }), text(' '), text(del, { color: PALETTE.warn })] }
}

function changeRow(f, iw) {
  const { len, pieces } = statPieces(f)
  const room = Math.max(1, iw - len - 1)
  return line(text(fitPath(stripControl(f.path), room).padEnd(room)), text(' '), pieces)
}

// Branch, ahead and behind, and the changed files (working tree against HEAD, untracked included),
// biggest change first. Hidden when nothing changed and the branch is in sync; its rows fit
// `changeRows`, the last one `+N more` when some are cut.
function changesCard({ git, changes, rows, used, width }) {
  const files = (Array.isArray(changes) ? changes : [])
    .filter((f) => f && typeof f.path === 'string' && stripControl(f.path) !== '')
    .sort((a, b) => linesOf(b) - linesOf(a))
  const ahead = isNum(git?.ahead) && git.ahead > 0 ? git.ahead : 0
  const behind = isNum(git?.behind) && git.behind > 0 ? git.behind : 0
  if (files.length === 0 && ahead === 0 && behind === 0) return null
  const room = changeRows(isNum(rows) && rows > 0 ? rows : Infinity, used)
  if (room < 0) return null
  const iw = width - 4
  const status = [ahead > 0 ? `↑${ahead}` : null, behind > 0 ? `↓${behind}` : null].filter(Boolean).join(' ')
  const name = stripControl(git?.branch ?? '') || 'changes'
  let shown = files
  let more = 0
  if (files.length > room) {
    shown = room >= 2 ? files.slice(0, room - 1) : []
    more = files.length - shown.length
    if (room === 0) more = 0
  }
  const body = shown.map((f) => changeRow(f, iw))
  if (more > 0) body.push(line(faint(`+${more} more`)))
  return card({
    title: fit(name, Math.max(8, iw - status.length - 1)),
    status: status === '' ? null : status,
    color: PALETTE.git,
    children: room === 0 ? [] : body,
    width,
  })
}

// ---- the panel -------------------------------------------------------------------------

// Builds the panel body; the main card always shows, so it is never null. `columns` and `rows` are
// the Pane's bodyColumns and scroll.bodyRows. `usage` is `$.session.usage()`, `model` and `effort` are
// the fallbacks for a main thread that has not made a request yet (the state's `main` wins). `git` is parseGitStatus's result (branch, ahead, behind)
// and `changes` the changed files ({ path, added, removed, binary, untracked }) for the changes card.
export function buildPanel({ panel, usage, odd, rdd, nowMs, columns, rows, model, effort, git, changes }) {
  const state = panel ?? {}
  const width = isNum(columns) && columns > 0 ? Math.max(MIN_COLUMNS, Math.floor(columns)) : PANEL_COLUMNS
  const busy = mainBusy(state)
  const phase = phaseOf(state)
  const main = { ...state.main, effort: state.main?.effort ?? effort ?? null }
  const name = prettyModel(state.main?.model ?? model)

  const children = []
  const push = (el) => {
    if (el) children.push(el)
    return Boolean(el)
  }
  push(mainCard({ main, usage, model: name, busy, phase, blocked: state.blocked === true, compactions: state.compactions ?? 0, branch: git?.branch, width, nowMs }))
  push(oddCard(odd, width))
  push(reviewCard(rdd, width))
  push(gateCard({ gate: state.gate, inline: state.inline, mode: state.main?.mode, width }))
  push(agentsCard(state, nowMs, width))
  const used = children.reduce((n, k) => n + height(k), 0)
  push(changesCard({ git, changes, rows, used, width }))
  return { type: 'Box', props: { flexDirection: 'column', width }, children }
}
