// Portions adapted from claude-flightdeck, Copyright (c) 2026 Stephen Casella, MIT License. See LICENSE-flightdeck.

// Pure drawing primitives for the Construct panel: gauges, the effort meter, the
// agent timeline geometry, the log row clamp and the bordered card. They return
// strings, numbers and plain element objects ({ type, props, children }, as
// layout.js and hooks/status/format.js build them), so they run and test without
// `$`. The rail and the elapsed clock are Client modules next to this file.
//
// Colors are theme keys only. Flightdeck's "theme" palette maps onto ours as:
//   main -> claude, agent -> suggestion, gate -> success, cleared -> permission,
//   arch -> merged (our ODD card), amber -> warning, warn -> error,
//   dim -> inactive, faint -> subtle, text -> text.
// Flightdeck's "pastel" palette (fixed hex) is not adopted.

export const PALETTE = {
  main: 'claude',
  agent: 'suggestion',
  gate: 'success',
  cleared: 'permission',
  odd: 'merged',
  amber: 'warning',
  warn: 'error',
  dim: 'inactive',
  faint: 'subtle',
  text: 'text',
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x)

// A gauge of `width` cells: ▰ filled, ▱ empty. An unknown or out-of-range pct is clamped.
export function gauge(pct, width) {
  const w = Math.max(0, Math.floor(isNum(width) ? width : 0))
  const full = Math.max(0, Math.min(w, Math.round(((isNum(pct) ? pct : 0) / 100) * w)))
  return { on: '▰'.repeat(full), off: '▱'.repeat(w - full) }
}

// The effort meter, four slots: low 1, medium 2, high 3, xhigh and max 4; unknown 0.
const EFFORT_SLOTS = { low: 1, medium: 2, high: 3, xhigh: 4, max: 4 }
export function effortMeter(effort) {
  const n = Object.hasOwn(EFFORT_SLOTS, effort) ? EFFORT_SLOTS[effort] : 0
  return { on: '▮'.repeat(n), off: '▯'.repeat(4 - n) }
}

// Swimlane geometry: each agent's bar on one shared axis from the earliest known
// start to `nowMs`, `width` cells wide. Agents carry startedMs / endedMs (state.js);
// an unknown start sits at the axis start, a running agent ends at `nowMs`, and every
// bar is at least one cell (none when width is 0). before + bar + after equals width.
export function lanes(agents, nowMs, width) {
  const list = Array.isArray(agents) ? agents : []
  const w = Math.max(0, Math.floor(isNum(width) ? width : 0))
  const starts = list.map((a) => a?.startedMs).filter((n) => isNum(n) && n > 0)
  const start = Math.min(...starts, nowMs)
  const span = Math.max(1, nowMs - start)
  return list.map((a) => {
    const begin = isNum(a?.startedMs) && a.startedMs > 0 ? Math.max(a.startedMs, start) : start
    const end = isNum(a?.endedMs) ? a.endedMs : nowMs
    const from = Math.min(w, Math.floor(((begin - start) * w) / span))
    const to = Math.min(w, Math.max(from + 1, Math.ceil(((end - start) * w) / span)))
    return { id: a?.id, before: from, bar: to - from, after: w - to }
  })
}

// The strings of one lane: · padding either side of a ━ run (one ━ when no geometry).
export function laneBar(geo) {
  if (!geo) return { before: '', bar: '━', after: '' }
  return { before: '·'.repeat(geo.before), bar: '━'.repeat(geo.bar), after: '·'.repeat(geo.after) }
}

// How many session log rows fit: what the other cards leave, never fewer than 4 nor more than 8.
export const logRows = (bodyRows, used) => Math.max(4, Math.min(8, Math.floor(bodyRows - used - 3)))

function textNode(content, props) {
  return { type: 'Text', props, children: [content] }
}

// A round bordered card: a bold title on the left and the status on the right of one
// row, then `children` (element objects). `status` is a string (in the card color) or
// { text, color, dim }; `width` is omitted to let the pane size the card.
export function card({ title, status, color, children = [], width }) {
  const head = [textNode(title, { color, bold: true })]
  if (status !== undefined && status !== null) {
    const s = typeof status === 'string' ? { text: status, color } : status
    const props = {}
    if (s.dim) props.dimColor = true
    else if (s.color) props.color = s.color
    head.push(textNode(s.text, props))
  }
  const props = { flexDirection: 'column', borderStyle: 'round', borderColor: color, paddingX: 1 }
  if (isNum(width)) props.width = width
  return {
    type: 'Box',
    props,
    children: [{ type: 'Box', props: { justifyContent: 'space-between' }, children: head }, ...children],
  }
}
