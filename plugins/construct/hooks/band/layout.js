// The band above the prompt: turns the stored band state and the active ODD feature into at most
// two rows. Row one is the main status, the feature with its tasks, and the gate; row two lists the
// running agents. Nothing the user's own status line shows (model, effort, branch, diff, context,
// plan limits) is drawn here.

import { isNum, text } from '../status/format.js'
import { agentsView, initialState, kindOfAgent, mainBusy, phaseOf } from './state.js'

// Roles to theme keys (never raw colors, so the band follows the user's theme).
export const PALETTE = {
  main: 'claude',
  agent: 'suggestion',
  gate: 'success',
  odd: 'merged',
  amber: 'warning',
  warn: 'error',
  faint: 'subtle',
}

// The width used when the band does not say how wide it is.
export const BAND_COLUMNS = 100

const MAX_FEATURE = 32
const MAX_CHECKPOINT_COLS = 23
const MAX_NAME = 18
const SEP = ' · '
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g

// ---- text helpers ---------------------------------------------------------

const clean = (s) => (typeof s === 'string' ? s.replace(CONTROL, '') : '')
const count = (n) => (isNum(n) && n > 0 ? Math.floor(n) : 0)
// Screen columns, counted by grapheme cluster: a cluster is two wide when its first code point is East Asian
// wide, fullwidth or emoji-presentation, when it joins an emoji with ZWJ or VS16, or when it holds a skin-tone
// modifier or a keycap mark (U+20E3); every other cluster is one.
const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6\u{20000}-\u{3FFFD}\p{Emoji_Presentation}]/u
const EMOJI_JOIN = /(?=.*[\u200D\uFE0F])(?=.*\p{Extended_Pictographic})/su
const EMOJI_MARK = /[\p{Emoji_Modifier}⃣]/u
const PLAIN =/^[\x20-\x7e]*$/
const SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const clusterWidth = (g) => (WIDE.test(String.fromCodePoint(g.codePointAt(0))) || EMOJI_JOIN.test(g) || EMOJI_MARK.test(g) ? 2 : 1)
const cols = (s) => (PLAIN.test(s) ? s.length : [...SEGMENTER.segment(s)].reduce((n, { segment }) => n + clusterWidth(segment), 0))
// The longest prefix of `s` within `max` columns; a cluster is never split.
function head(s, max) {
  if (PLAIN.test(s)) return s.slice(0, Math.max(0, max))
  let out = ''
  let used = 0
  for (const { segment } of SEGMENTER.segment(s)) {
    const w = clusterWidth(segment)
    if (used + w > max) break
    out += segment
    used += w
  }
  return out
}
const cut = (s, max) => (cols(s) <= max ? s : max > 1 ? `${head(s, max - 1)}…` : head(s, max))

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


// ---- rows: a row is a list of segments `{ t, color?, dim?, bold? }`, clipped to one line -------

const seg = (t, o = {}) => ({ t, ...o })
const sep = () => seg(SEP, { dim: true })
const width = (segs) => segs.reduce((n, s) => n + cols(s.t), 0)

// The segments that fit in `max` cells, the cut one ending in `…`.
function clip(segs, max) {
  if (width(segs) <= max) return segs
  const out = []
  let left = Math.max(0, max - 1)
  for (const s of segs) {
    if (left <= 0) break
    out.push(cols(s.t) <= left ? s : { ...s, t: head(s.t, left) })
    left -= cols(s.t)
  }
  const last = out.pop()
  out.push(last ? { ...last, t: last.t + '…' } : seg('…')) // a copy: the caller's segment stays as it was
  return out
}

function row(segs, max) {
  const children = clip(segs, max).map((s) => text(s.t, s))
  return { type: 'Text', props: { wrap: 'truncate' }, children }
}

// ---- row one: status, ODD feature, gate --------------------------------------

// The phase words of state.js as the voice the main status uses.
const PHASE_VERB = { implementing: 'building', exploring: 'mapping' }

function statusSeg(state) {
  if (state.blocked) return seg('◆ waiting on you', { color: PALETTE.amber, bold: true })
  if (!mainBusy(state)) return seg('○ ready', { dim: true })
  const phase = phaseOf(state)
  return seg(`● ${phase ? (PHASE_VERB[phase] ?? phase) : 'busy'}`, { color: PALETTE.main, bold: true })
}

// One glyph per task joined by `━`; too many keep a window from the last done task on, behind a leading `…`.
function checkpoints(tasks, max) {
  const open = tasks.findIndex((t) => !t.done)
  const glyphs = tasks.map((t, i) => (t.done ? seg('●', { color: PALETTE.odd }) : i === open ? seg('◆', { color: PALETTE.odd, bold: true }) : seg('○', { dim: true })))
  const fits = Math.floor((max + 1) / 2)
  const count = Math.floor((max - 1) / 2)
  const from = Math.max(0, Math.min((open < 0 ? glyphs.length : open) - 1, glyphs.length - count))
  const shown = glyphs.length <= fits ? glyphs : glyphs.slice(from, from + count)
  const joined = shown.flatMap((g, i) => (i ? [seg('━', { color: PALETTE.faint }), g] : [g]))
  return shown === glyphs ? joined : [seg('…━', { dim: true }), ...joined]
}

function oddSegs(odd, withTitle) {
  const segs = [seg('ODD ', { dim: true }), seg(cut(clean(String(odd.feature)), MAX_FEATURE), { color: PALETTE.odd })]
  const tasks = (Array.isArray(odd.tasks) ? odd.tasks : []).filter((t) => t && typeof t === 'object')
  if (tasks.length) segs.push(seg(' '), ...checkpoints(tasks, MAX_CHECKPOINT_COLS))
  if (odd.task) {
    segs.push(seg(' '), seg(clean(String(odd.task.id ?? '')), { bold: true }))
    if (withTitle) segs.push(seg(` ${clean(String(odd.task.title ?? ''))}`))
  }
  return segs
}

// Pending asks, else the calls that passed; denials and main-thread writes outside odd/tasks after them.
function gateSegs(state) {
  const v = state.gate?.verdicts ?? {}
  const ask = count(v.ask)
  const deny = count(v.deny)
  const passed = count(v.rule) + count(v.cleared)
  const inline = count(state.inline?.count)
  const parts = []
  if (ask > 0) parts.push(seg(`gate ${ask} pending`, { color: PALETTE.amber }))
  else if (passed > 0 || deny > 0) parts.push(seg(`gate ✓ ${passed}`, { color: PALETTE.gate }))
  if (deny > 0) parts.push(seg(`✗ ${deny}`, { color: PALETTE.warn }))
  if (inline > 0) parts.push(seg(`⚠ ${inline} inline`, { color: PALETTE.warn }))
  return parts.flatMap((p, i) => (i ? [seg(' '), p] : [p]))
}

const join = (parts) => parts.flatMap((p, i) => (i ? [sep(), ...p] : p))

// The task title gives way first; whatever still does not fit is clipped with `…`.
function statusRow(state, odd, gate, max) {
  const build = (withTitle) => join([[statusSeg(state)], ...(odd ? [oddSegs(odd, withTitle)] : []), ...(gate.length ? [gate] : [])])
  const full = build(true)
  return row(width(full) <= max ? full : build(false), max)
}

// ---- row two: running agents --------------------------------------------------

// Glyph and running verb by role kind (roles.mjs); anything else is a plain worker.
const LOOKS = {
  reader: ['⌕', 'mapping'],
  writer: ['⚒', 'building'],
  verifier: ['⊨', 'verifying'],
  runner: ['◇', 'working'],
  judge: ['⚖', 'judging'],
  lens: ['◎', 'reviewing'],
}
const OTHER_LOOK = ['•', 'working']

function agentSegs(a, withModel) {
  const [glyph, verb] = LOOKS[kindOfAgent(a)] ?? OTHER_LOOK
  const model = withModel && typeof a.model === 'string' && a.model ? [seg(` ${prettyModel(a.model)}`, { dim: true })] : []
  return [seg(`${glyph} ${cut(clean(a.name), MAX_NAME)} ${verb}`, { color: PALETTE.agent }), ...model, seg(` ${clock(a.elapsedMs)}`, { dim: true })]
}

// Oldest first, so a row keeps its place while later agents join; the models go first when it does not fit.
function agentsRow(running, max) {
  const build = (withModel) => join(running.map((a) => agentSegs(a, withModel)))
  const full = build(true)
  return row(width(full) <= max ? full : build(false), max)
}

// ---- the band ------------------------------------------------------------------

// The band's tree, or null when there is nothing to show: idle, no open feature, no gate activity.
export function buildBand({ state: stored, odd, nowMs, columns, maxRows }) {
  const state = stored ?? initialState()
  const max = isNum(columns) && columns > 0 ? Math.floor(columns) : BAND_COLUMNS
  const now = isNum(nowMs) ? nowMs : Date.now()
  const feature = odd?.feature ? odd : null
  const gate = gateSegs(state)
  const running = agentsView(state, now)
  if (!state.blocked && !mainBusy(state) && !feature && gate.length === 0 && running.length === 0) return null
  const rows = [statusRow(state, feature, gate, max)]
  if (running.length > 0 && !(isNum(maxRows) && maxRows < 2)) rows.push(agentsRow(running, max))
  return { type: 'Box', props: { flexDirection: 'column' }, children: rows }
}
