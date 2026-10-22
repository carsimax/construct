// The panel layout: turns the stored panel state and the live data (usage, ODD feature, memory,
// git) into one column of bordered cards. Each card is built by a small function of its own;
// buildPanel only decides which cards show and how many rows the changes card may take.

import { kindOf } from '../scripts/roles.mjs'
import { isNum, text } from '../status/format.js'
import { PALETTE, card, changeRows, effortMeter, fmtResetIn, gauge, panelBox, stackBar } from './draw.js'
import { agentsView, mainBusy, maskSecrets, phaseOf } from './state.js'

export const PANEL_COLUMNS = 66

const MAX_AGENT_ROWS = 6
const MAX_NAME = 18
const SEP = ' · '
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g

// ---- text helpers ---------------------------------------------------------

const clean = (s) => (typeof s === 'string' ? s.replace(CONTROL, '') : '')
const count = (n) => (isNum(n) && n > 0 ? Math.floor(n) : 0)
const cut = (s, max) => (s.length <= max ? s : max > 1 ? `${s.slice(0, max - 1)}…` : s.slice(0, max))

// `m:ss`, or `XhYY` from an hour on.
export function clock(ms) {
  const s = isNum(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0
  const pad = (n) => String(n).padStart(2, '0')
  if (s >= 3600) return `${Math.floor(s / 3600)}h${pad(Math.floor((s % 3600) / 60))}`
  return `${Math.floor(s / 60)}:${pad(s % 60)}`
}

// `claude-opus-5-5` gives `Opus 5.5`; a family alone (`opus[1m]`) gives `Opus`; a date suffix is dropped.
export function prettyModel(model) {
  if (typeof model !== 'string') return 'Claude'
  const parts = model.replace(/\[.*$/, '').split('-').filter((p) => p && p !== 'claude')
  const family = parts.find((p) => /^[a-z]/i.test(p))
  if (!family) return 'Claude'
  const version = parts.filter((p) => /^\d{1,2}$/.test(p)).slice(0, 2).join('.')
  const name = family[0].toUpperCase() + family.slice(1).toLowerCase()
  return version ? `${name} ${version}` : name
}

// 666_000 gives `666k`, 1_000_000 gives `1.0M`, below a thousand the integer.
function tokens(n) {
  if (n < 1000) return String(Math.round(n))
  const k = Math.round(n / 1000)
  return k >= 1000 ? `${(n / 1e6).toFixed(1)}M` : `${k}k`
}

// "5 minutes ago" as the shortest unit: `<1m`, `5m`, `3h`, `2d`.
function age(ms) {
  const m = Math.floor(ms / 60_000)
  if (m < 1) return '<1m'
  if (m < 60) return `${m}m`
  return m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`
}

// ---- rows: a row is a list of segments `{ t, color?, dim?, bold? }`, clipped to one line -------

const seg = (t, o = {}) => ({ t, ...o })
const sep = () => seg(SEP, { dim: true })
const width = (segs) => segs.reduce((n, s) => n + s.t.length, 0)

// The segments that fit in `max` cells, the cut one ending in `…`.
function clip(segs, max) {
  if (width(segs) <= max) return segs
  const out = []
  let left = Math.max(0, max - 1)
  for (const s of segs) {
    if (left <= 0) break
    out.push(s.t.length <= left ? s : { ...s, t: s.t.slice(0, left) })
    left -= s.t.length
  }
  const last = out.at(-1)
  if (last) last.t += '…'
  else out.push(seg('…'))
  return out
}

function row(segs, max) {
  const children = clip(segs, max).map((s) => text(s.t, s))
  return { type: 'Text', props: { wrap: 'truncate' }, children }
}

const dimRow = (t, max, color) => row([seg(t, color ? { color } : { dim: true })], max)

// gauge cells as two segments; the filled part turns to the warn color from 80%
function gaugeSegs(pct, cells) {
  const g = gauge(pct, cells)
  const on = pct >= 80 ? PALETTE.warn : PALETTE.main
  return [...(g.on ? [seg(g.on, { color: on })] : []), ...(g.off ? [seg(g.off, { color: PALETTE.faint })] : [])]
}

function meterSegs(effort, on = PALETTE.main, off = PALETTE.faint) {
  const m = effortMeter(effort)
  return [...(m.on ? [seg(m.on, { color: on })] : []), seg(m.off, { color: off })]
}

// ---- main card ---------------------------------------------------------------

// The phase words of state.js as the voice the main status uses.
const PHASE_VERB = { implementing: 'building', exploring: 'mapping' }

function mainStatus(panel) {
  if (panel.blocked) return { text: '◆ waiting on you', color: PALETTE.amber }
  if (!mainBusy(panel)) return { text: '○ ready', color: PALETTE.dim }
  const phase = phaseOf(panel)
  return `● ${phase ? (PHASE_VERB[phase] ?? phase) : 'busy'}`
}

function branchRow({ panel, git, effort }, max) {
  const branch = clean(git?.branch)
  const word = typeof effort === 'string' && effort ? effort : '—'
  const mode = typeof panel.main?.mode === 'string' && panel.main.mode ? panel.main.mode : ''
  const join = (parts) => parts.flatMap((p, i) => (i ? [sep(), ...p] : p))
  const tail = [[...meterSegs(effort, PALETTE.main, PALETTE.main), seg(` ${word}`, { color: PALETTE.main })], [seg(`${count(panel.main?.steps)} req`, { dim: true })]]
  const build = (b, withMode) =>
    join([...(b ? [[seg('⎇ ', { dim: true }), seg(b)]] : []), ...tail, ...(withMode && mode ? [[seg(mode, { dim: true })]] : [])])
  // the branch gives way first (keeping 8 characters), then the mode; effort and requests stay
  const room = (withMode) => max - width(build('', withMode)) - (branch ? 2 + SEP.length : 0)
  const fit = (withMode) => {
    const r = room(withMode)
    return branch.length <= r ? branch : r > 8 ? cut(branch, r) : null
  }
  const withMode = fit(true)
  if (withMode !== null) return row(build(withMode, true), max)
  return row(build(fit(false) ?? cut(branch, 9), false), max)
}

function ctxRow(context, panel, max) {
  const pct = Math.round(context.percent)
  const segs = [seg('ctx ', { dim: true }), ...gaugeSegs(pct, 10), seg(' '), seg(`${pct}%`, { bold: true })]
  if (isNum(context.tokens) && isNum(context.window)) segs.push(seg(` ${tokens(context.tokens)}/${tokens(context.window)}`, { dim: true }))
  if (count(panel.compactions) > 0) segs.push(seg(`  ⟲${count(panel.compactions)}`, { color: PALETTE.amber }))
  return row(segs, max)
}

function limitsRow(usage, nowMs, max) {
  const limits = Array.isArray(usage?.rateLimits) ? usage.rateLimits : []
  const parts = [['five_hour', '5h'], ['seven_day', '7d']].flatMap(([kind, label]) => {
    const l = limits.find((x) => x?.kind === kind)
    if (!isNum(l?.percentUsed)) return []
    const left = fmtResetIn(l.resetsAt, nowMs)
    return [[seg(`${label} `, { dim: true }), ...gaugeSegs(l.percentUsed, 5), seg(` ${Math.round(l.percentUsed)}%`), ...(left ? [seg(` ↻${left}`, { dim: true })] : [])]]
  })
  return parts.length ? row(parts.flatMap((p, i) => (i ? [seg('   '), ...p] : p)), max) : null
}

function mainCard({ panel, usage, model, effort, git, nowMs }, w) {
  const inner = w - 4
  const live = { panel, git, effort: panel.main?.effort ?? effort }
  const body = [branchRow(live, inner)]
  if (isNum(usage?.context?.percent)) body.push(ctxRow(usage.context, panel, inner))
  const limits = limitsRow(usage, nowMs, inner)
  if (limits) body.push(limits)
  return card({ title: prettyModel(panel.main?.model ?? model), status: mainStatus(panel), color: PALETTE.main, children: body, width: w })
}

// ---- ODD card ------------------------------------------------------------------

// One glyph per task joined by `━`; too many keep the latest behind a leading `…`.
function checkpoints(tasks, max) {
  const open = tasks.findIndex((t) => !t.done)
  const glyphs = tasks.map((t, i) => (t.done ? seg('●', { color: PALETTE.odd }) : i === open ? seg('◆', { color: PALETTE.odd, bold: true }) : seg('○', { dim: true })))
  const fits = Math.floor((max + 1) / 2)
  const shown = glyphs.length <= fits ? glyphs : glyphs.slice(-Math.floor((max - 1) / 2))
  const joint = (g, i) => seg('━', { color: PALETTE.faint })
  const joined = shown.flatMap((g, i) => (i ? [joint(g, i), g] : [g]))
  return shown === glyphs ? joined : [seg('…━', { dim: true }), ...joined]
}

function oddCard(odd, w) {
  const inner = w - 4
  const status = `${count(odd.open)} open`
  const body = []
  if (odd.task) {
    const id = clean(String(odd.task.id ?? ''))
    body.push(row([seg(id, { bold: true }), seg(`  ${clean(String(odd.task.title ?? ''))}`)], inner))
  }
  const tasks = (Array.isArray(odd.tasks) ? odd.tasks : []).filter((t) => t && typeof t === 'object')
  if (tasks.length) body.push(row(checkpoints(tasks, inner), inner))
  const title = cut(`ODD · ${clean(String(odd.feature))}`, inner - status.length - 1)
  return card({ title, status: { text: status, dim: true }, color: PALETTE.odd, children: body, width: w })
}

// ---- GATE card -----------------------------------------------------------------

const sumOf = (o) => Object.values(o ?? {}).reduce((n, v) => n + count(v), 0)

function gateStatus({ ask, deny }, total) {
  if (ask > 0) return { text: `${ask} waiting on you`, color: PALETTE.amber }
  return { text: deny === 0 ? 'all clear' : `${total} checks`, dim: true }
}

function gateBody(panel, v, inner) {
  const classifier = panel.main?.mode === 'auto' ? 'classifier' : 'you'
  const items = [
    ['■', `${v.rule} allowed`, PALETTE.gate],
    ['■', `${v.cleared} ${classifier}`, PALETTE.cleared],
    ...(v.ask > 0 ? [['■', `${v.ask} pending`, PALETTE.amber]] : []),
    ['✗', `${v.deny} denied`, v.deny > 0 ? PALETTE.warn : PALETTE.dim],
  ]
  const counts = [v.rule, v.cleared, v.ask, v.deny]
  const colors = [PALETTE.gate, PALETTE.cleared, PALETTE.amber, PALETTE.warn]
  const bar = stackBar(counts, inner).flatMap((n, i) => (n ? [seg('█'.repeat(n), { color: colors[i] })] : []))
  const legend = items.flatMap(([glyph, label, color], i) => [...(i ? [seg('  ')] : []), seg(`${glyph} `, { color }), seg(label, [PALETTE.amber, PALETTE.warn, PALETTE.dim].includes(color) ? { color } : { dim: true })])
  const buckets = [['f', 'file'], ['s', 'shell'], ['o', 'other']].flatMap(([key, name], i) => {
    const n = sumOf(panel.gate?.buckets?.[name])
    return [...(i ? [seg('  ')] : []), seg(`${key}: ${name} ${n}`, n === 0 ? { dim: true } : {})]
  })
  return [row(bar, inner), row(legend, inner), row(buckets, inner)]
}

function inlineTail(path) {
  const parts = clean(maskSecrets(path)).split('/').filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : parts.join('/')
}

function gateCard(panel, w) {
  const inner = w - 4
  const v = { rule: count(panel.gate?.verdicts?.rule), ask: count(panel.gate?.verdicts?.ask), cleared: count(panel.gate?.verdicts?.cleared), deny: count(panel.gate?.verdicts?.deny) }
  const total = v.rule + v.ask + v.cleared + v.deny
  const inline = count(panel.inline?.count)
  if (total === 0 && inline === 0) return null
  const body = total === 0 ? [dimRow('nothing waiting on you', inner)] : gateBody(panel, v, inner)
  const denied = panel.gate?.lastDenied
  if (total > 0 && denied && typeof denied === 'object') {
    const detail = cut(clean(maskSecrets(String(denied.detail ?? ''))), 80)
    body.push(row([seg(`✗ ${clean(String(denied.tool ?? 'tool'))}${detail ? `: ${detail}` : ''}`, { color: PALETTE.warn })], inner))
  }
  if (inline > 0) {
    const tail = typeof panel.inline?.last === 'string' ? inlineTail(panel.inline.last) : ''
    body.push(row([seg(`⚠ ${inline} inline write${inline === 1 ? '' : 's'}${tail ? ` · ${tail}` : ''}`, { color: PALETTE.warn })], inner))
  }
  return card({ title: 'GATE · permissions', status: gateStatus(v, total), color: PALETTE.gate, children: body, width: w })
}

// ---- MEMORY card ---------------------------------------------------------------

const AMBER_REASON = /newer|read-?only/i

function memoryCard(memory, nowMs, w) {
  const inner = w - 4
  const color = PALETTE.cleared
  if (typeof memory.off === 'string') {
    const reason = clean(memory.off)
    return card({ title: 'MEMORY', color, children: [dimRow(reason, inner, AMBER_REASON.test(reason) ? PALETTE.amber : undefined)], width: w })
  }
  const n = count(memory.memories)
  if (n === 0) return card({ title: 'MEMORY', status: { text: '0 memories', dim: true }, color, children: [dimRow('nothing remembered yet', inner)], width: w })
  const review = count(memory.review)
  const body = [row([seg(`${review} to review`, review > 0 ? { color: PALETTE.amber } : { dim: true }), seg(` · ${count(memory.pinned)} pinned · ${count(memory.pending)} pending`, { dim: true })], inner)]
  const saved = Date.parse(memory.lastSaveAt)
  const facts = [
    ...(Number.isFinite(saved) ? [`last save ${age(Math.max(0, nowMs - saved))} ago`] : []),
    ...(isNum(memory.sessionSaves) ? [`+${count(memory.sessionSaves)} this session`] : []),
  ]
  if (facts.length) body.push(row([seg(facts.join(SEP), { dim: true })], inner))
  return card({ title: 'MEMORY', status: `${n} memories`, color, children: body, width: w })
}

// ---- agents card ---------------------------------------------------------------

// Glyph, running verb, done verb by role kind (roles.mjs); anything else is a plain worker.
const LOOKS = {
  reader: ['⌕', 'mapping', 'mapped'],
  writer: ['⚒', 'building', 'built'],
  verifier: ['⊨', 'verifying', 'verified'],
  runner: ['◇', 'working', 'done'],
  judge: ['⚖', 'judging', 'judged'],
  lens: ['◎', 'reviewing', 'reviewed'],
}
const OTHER_LOOK = ['•', 'working', 'done']

function agentsCard(panel, nowMs, w) {
  const { cards, rest, running } = agentsView(panel, nowMs, MAX_AGENT_ROWS)
  if (cards.length === 0) return null
  const inner = w - 4
  const shown = [...cards].sort((a, b) => (isNum(a.startedMs) ? a.startedMs : 0) - (isNum(b.startedMs) ? b.startedMs : 0))
  const looks = shown.map((a) => {
    const [glyph, now, done] = LOOKS[kindOf(a.name)] ?? OTHER_LOOK
    return { a, glyph, verb: a.status === 'running' ? now : done, model: typeof a.model === 'string' && a.model ? prettyModel(a.model) : '—' }
  })
  const pad = (key, cap = Infinity) => Math.min(cap, Math.max(...looks.map((l) => (key === 'name' ? l.a.name : l[key]).length)))
  const [nameW, verbW, modelW] = [pad('name', MAX_NAME), pad('verb'), pad('model')]
  // glyph, name, verb, model, meter and clock with their spaces; the model goes first when the row does not fit, then the meter
  const clockW = 1 + Math.max(...shown.map((a) => clock(a.elapsedMs).length))
  const base = 2 + nameW + 1 + verbW + clockW
  const showMeter = base + 5 <= inner
  const showModel = base + 5 + 1 + modelW <= inner
  const body = looks.map(({ a, glyph, verb, model }) => {
    const live = a.status === 'running'
    const tone = live ? { color: PALETTE.agent } : { dim: true }
    // the clock stays; name and verb are clipped with `…` when even they do not fit
    const room = inner - 2 - clockW - nameW - 1
    const cells = verb.length <= room ? Math.min(verbW, room) : verbW // pad, never clip, a verb that fits
    const left = clip([seg(cut(a.name, MAX_NAME).padEnd(nameW), tone), seg(' '), seg(verb.padEnd(cells), tone)], inner - 2 - clockW)
    return row(
      [
        seg(glyph, live ? tone : { color: PALETTE.gate }),
        seg(' '),
        ...left,
        ...(showModel ? [seg(' '), seg(model.padEnd(modelW), { dim: true })] : []),
        ...(showMeter ? [seg(' '), ...meterSegs(a.effort, live ? PALETTE.agent : PALETTE.dim, live ? PALETTE.agent : PALETTE.faint)] : []),
        seg(` ${clock(a.elapsedMs)}`, { color: PALETTE.dim }),
      ],
      inner,
    )
  })
  if (rest > 0) body.unshift(row([seg(`+${rest} earlier`, { color: PALETTE.faint })], inner))
  const total = cards.length + rest
  const status = { text: running > 0 ? `${running} at work · ${total}` : `all done · ${total}`, dim: true }
  return card({ title: 'agents', status, color: PALETTE.agent, children: body, width: w })
}

// ---- changes card --------------------------------------------------------------

// The path shortened to `…/dir/name`, then `…/name`, then clipped, to fit `max` cells.
function fitPath(path, max) {
  if (path.length <= max) return path
  const parts = path.split('/').filter(Boolean)
  for (const keep of [2, 1]) {
    const short = `…/${parts.slice(-keep).join('/')}`
    if (short.length <= max) return short
  }
  return cut(parts.at(-1) ?? path, max)
}

const lines = (f) => (f.binary ? 0 : count(f.added) + count(f.removed))

function statSegs(f) {
  if (f.binary) return [seg('bin', { dim: true })]
  if (f.untracked) return isNum(f.added) ? [seg(`+${count(f.added)}`, { color: PALETTE.gate })] : [seg('new', { dim: true })]
  return [seg(`+${count(f.added)}`, { color: PALETTE.gate }), seg(' '), seg(`-${count(f.removed)}`, { color: PALETTE.warn })]
}

function changeRow(f, inner) {
  const stat = statSegs(f)
  const path = fitPath(clean(f.path), inner - width(stat) - 1)
  return row([seg(path.padEnd(inner - width(stat))), ...stat], inner)
}

function changesCard({ git, changes }, budget, w) {
  const inner = w - 4
  const files = (Array.isArray(changes) ? changes : []).filter((f) => f && typeof f.path === 'string')
  const ahead = count(git?.ahead)
  const behind = count(git?.behind)
  if (budget < 0 || (files.length === 0 && ahead === 0 && behind === 0)) return null
  const status = [...(ahead ? [`↑${ahead}`] : []), ...(behind ? [`↓${behind}`] : [])].join(' ')
  const title = cut(clean(git?.branch) || 'changes', inner - status.length - 1)
  const sorted = [...files].sort((a, b) => lines(b) - lines(a))
  const fit = sorted.length <= budget ? sorted : sorted.slice(0, Math.max(0, budget - 1))
  const body = budget === 0 ? [] : fit.map((f) => changeRow(f, inner))
  if (budget > 0 && fit.length < sorted.length) body.push(dimRow(`+${sorted.length - fit.length} more`, inner, PALETTE.faint))
  return card({ title, status: status || undefined, color: PALETTE.git, children: body, width: w })
}

// ---- the panel -----------------------------------------------------------------

// Rows a card takes: its border, then the title row and the body rows.
const heightOf = (c) => c.children.length + 2

export function buildPanel({ panel, usage, odd, memory, nowMs, columns, rows, model, effort, git, changes }) {
  const w = isNum(columns) ? Math.max(40, Math.floor(columns)) : PANEL_COLUMNS
  const now = isNum(nowMs) ? nowMs : Date.now()
  const cards = [
    mainCard({ panel, usage, model, effort, git, nowMs: now }, w),
    odd?.feature ? oddCard(odd, w) : null,
    gateCard(panel, w),
    memory ? memoryCard(memory, now, w) : null,
    agentsCard(panel, now, w),
  ].filter(Boolean)
  const used = cards.reduce((n, c) => n + heightOf(c), 0)
  const last = changesCard({ git, changes }, changeRows(isNum(rows) && rows > 0 ? rows : Infinity, used), w)
  return panelBox({ width: w, rows, children: last ? [...cards, last] : cards })
}
