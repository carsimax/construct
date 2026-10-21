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

// Pure drawing primitives for the Construct panel: gauges, the effort meter, the
// changes row clamp and the bordered card. They return strings, numbers and plain
// element objects ({ type, props, children }, as layout.js and hooks/status/format.js
// build them), so they run and test without `$`.
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
  git: 'remember',
  amber: 'warning',
  warn: 'error',
  dim: 'inactive',
  faint: 'subtle',
  text: 'text',
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x)

// Time left until a window resets, its two largest units: 25m, 3h10m, 4d2h. Empty when unknown or past.
// Adapted from claude-flightdeck's fmtResetIn (core.ts).
export function fmtResetIn(resetsAt, nowMs) {
  if (!isNum(resetsAt) || !isNum(nowMs) || resetsAt <= nowMs) return ''
  const m = Math.max(1, Math.floor((resetsAt - nowMs) / 60_000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d > 0) return `${d}d${h}h`
  return h > 0 ? `${h}h${String(m % 60).padStart(2, '0')}m` : `${m}m`
}

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

// How many file rows the changes card may show: what the other cards leave less its frame
// (border 2 + title 1 = 3 rows), at most 10. -1 when not even the frame fits (the caller drops the card),
// 0 when only the title fits.
export const CHANGES_FRAME_ROWS = 3
export const MAX_CHANGE_ROWS = 10
export const changeRows = (bodyRows, used) => {
  const free = Math.floor(bodyRows - used - CHANGES_FRAME_ROWS)
  return free < 0 || Number.isNaN(free) ? -1 : Math.min(MAX_CHANGE_ROWS, free)
}

// Largest-remainder split of `width` cells among `counts` (an array of numbers, in drawing order):
// each non-zero count gets at least one cell and the cells sum to `width` (none when every count is 0
// or width is 0). Returns an array of cell counts, one per input count.
export function stackBar(counts, width) {
  const list = (Array.isArray(counts) ? counts : []).map((n) => (isNum(n) && n > 0 ? n : 0))
  const w = Math.max(0, Math.floor(isNum(width) ? width : 0))
  const total = list.reduce((a, b) => a + b, 0)
  if (total === 0 || w === 0) return list.map(() => 0)
  const nonZero = list.filter((n) => n > 0).length
  if (nonZero >= w) {
    // No room for a cell each: the largest counts keep one.
    const keep = [...list.keys()].filter((i) => list[i] > 0).sort((a, b) => list[b] - list[a]).slice(0, w)
    return list.map((_, i) => (keep.includes(i) ? 1 : 0))
  }
  const spare = w - nonZero
  const exact = list.map((n) => (n > 0 ? (n / total) * spare : 0))
  const cells = list.map((n, i) => (n > 0 ? 1 + Math.floor(exact[i]) : 0))
  let left = w - cells.reduce((a, b) => a + b, 0)
  const order = [...list.keys()].filter((i) => list[i] > 0).sort((a, b) => exact[b] - Math.floor(exact[b]) - (exact[a] - Math.floor(exact[a])))
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) cells[order[k]]++
  return cells
}

function textNode(content, props) {
  return { type: 'Text', props, children: [content] }
}

// A round bordered column: `dim` dims the border, `marginTop` and `width` are optional.
export function panelBox({ color, dim, width, marginTop, children = [] }) {
  const props = { flexDirection: 'column', borderStyle: 'round', borderColor: color, paddingX: 1 }
  if (dim) props.borderDimColor = true
  if (isNum(width)) props.width = width
  if (isNum(marginTop) && marginTop > 0) props.marginTop = marginTop
  return { type: 'Box', props, children }
}

// A round bordered card: a bold title on the left and the status on the right of one
// row, then `children` (element objects). `status` is a string (in the card color) or
// { text, color, dim }; `width` is omitted to let the pane size the card; `dim` dims the border.
export function card({ title, status, color, children = [], width, dim, marginTop }) {
  const head = [textNode(title, { color, bold: true })]
  if (status !== undefined && status !== null) {
    const s = typeof status === 'string' ? { text: status, color } : status
    const props = {}
    if (s.dim) props.dimColor = true
    else if (s.color) props.color = s.color
    head.push(textNode(s.text, props))
  }
  return panelBox({ color, dim, width, marginTop, children: [{ type: 'Box', props: { justifyContent: 'space-between' }, children: head }, ...children] })
}
