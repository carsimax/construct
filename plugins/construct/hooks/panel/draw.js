// Drawing primitives of the panel: the color palette, gauges and meters, the stacked bar,
// time formats, and the bordered card. Everything is a pure function over plain data that
// returns `{ type, props, children }` elements, so layout.js can compose them and the tests
// can read them without a renderer.

import { isNum, text } from '../status/format.js'

// Roles to theme keys (never raw colors, so the panel follows the user's theme).
export const PALETTE = {
  main: 'claude',
  agent: 'suggestion',
  gate: 'success',
  cleared: 'permission',
  odd: 'merged',
  git: 'remember',
  amber: 'warning',
  warn: 'error',
  dim: 'inactive',
  faint: 'subtle',
}

// A card's frame is its border plus the title row.
export const CHANGES_FRAME_ROWS = 3
export const MAX_CHANGE_ROWS = 10

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

// Cells of a fixed-width gauge: `on` filled, `off` empty.
export function gauge(pct, width) {
  const w = isNum(width) ? Math.max(0, Math.floor(width)) : 0
  const filled = isNum(pct) ? clamp(Math.round((pct * w) / 100), 0, w) : 0
  return { on: '▰'.repeat(filled), off: '▱'.repeat(w - filled) }
}

const EFFORT_SLOTS = { low: 1, medium: 2, high: 3, xhigh: 4, max: 4 }

// Four slots; an unknown effort fills none.
export function effortMeter(effort) {
  const filled = Object.hasOwn(EFFORT_SLOTS, effort) ? EFFORT_SLOTS[effort] : 0
  return { on: '▮'.repeat(filled), off: '▯'.repeat(4 - filled) }
}

// Time left until a reset (epoch ms or an ISO string): the two largest units, '' when unknown or past.
export function fmtResetIn(resetsAt, nowMs) {
  const at = typeof resetsAt === 'string' ? Date.parse(resetsAt) : resetsAt
  if (!isNum(at) || !isNum(nowMs) || at <= nowMs) return ''
  const mins = Math.ceil((at - nowMs) / 60_000)
  if (mins >= 1440) return `${Math.floor(mins / 1440)}d${Math.floor((mins % 1440) / 60)}h`
  if (mins >= 60) return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}m`
  return `${mins}m`
}

// Rows the changes card may fill: what is left after the other cards and its own frame, at most
// MAX_CHANGE_ROWS; -1 when not even the frame fits.
export function changeRows(bodyRows, used) {
  const left = bodyRows - used - CHANGES_FRAME_ROWS
  return left < 0 ? -1 : Math.min(MAX_CHANGE_ROWS, left)
}

// Splits `width` cells over `counts`: every non-zero count keeps one cell, the rest goes by
// largest remainder. With fewer cells than non-zero counts, the largest counts get one each.
export function stackBar(counts, width) {
  const c = counts.map((n) => (isNum(n) ? Math.max(0, n) : 0))
  const w = isNum(width) ? Math.max(0, Math.floor(width)) : 0
  const total = c.reduce((a, b) => a + b, 0)
  const cells = c.map(() => 0)
  if (total === 0 || w === 0) return cells
  const nonZero = c.map((n, i) => i).filter((i) => c[i] > 0)
  if (w <= nonZero.length) {
    nonZero.sort((a, b) => c[b] - c[a] || a - b).slice(0, w).forEach((i) => (cells[i] = 1))
    return cells
  }
  const spare = w - nonZero.length
  const quota = c.map((n) => (n / total) * spare)
  for (const i of nonZero) cells[i] = 1 + Math.floor(quota[i])
  const left = w - cells.reduce((a, b) => a + b, 0)
  nonZero
    .sort((a, b) => (quota[b] % 1) - (quota[a] % 1) || a - b)
    .slice(0, left)
    .forEach((i) => cells[i]++)
  return cells
}

// The panel root: one column, `minHeight` fills the pane body when its rows are known.
export function panelBox({ width, rows, children }) {
  const props = { flexDirection: 'column', width }
  if (isNum(rows) && rows > 0) props.minHeight = Math.floor(rows)
  return { type: 'Box', props, children }
}

// A bordered card: bold title on the left, status on the right. A string status takes the
// card color; `{ text, color, dim }` styles it on its own.
export function card({ title, status, color, children = [], width, dim, marginTop }) {
  const props = { flexDirection: 'column', borderStyle: 'round', borderColor: color, paddingX: 1 }
  if (width !== undefined) props.width = width
  if (marginTop) props.marginTop = marginTop
  const head = [text(title, { color, bold: true, dim })]
  if (typeof status === 'string') head.push(text(status, { color }))
  else if (status) head.push(text(status.text, { color: status.color, dim: status.dim }))
  return {
    type: 'Box',
    props,
    children: [{ type: 'Box', props: { justifyContent: 'space-between' }, children: head }, ...children],
  }
}
