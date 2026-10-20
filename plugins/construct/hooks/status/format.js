// Pure formatting for the status band: meters, reset times, segments, and the
// element tree. No `$` calls live here, so these run (and test) in isolation.

const BAR_WIDTH = 8
const SEP = { sep: true }
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// A finite number floored into 0..100, or null for anything else.
export function clampPct(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(100, Math.max(0, Math.floor(value)))
}

// Green below 50, yellow below 80, red otherwise.
export function meterColor(pct) {
  if (pct < 50) return 'green'
  if (pct < 80) return 'yellow'
  return 'red'
}

export function bar(pct, width = BAR_WIDTH) {
  const filled = Math.min(width, Math.floor((pct * width) / 100))
  return { filled: '█'.repeat(filled), empty: '░'.repeat(width - filled) }
}

const two = (n) => String(n).padStart(2, '0')

function futureDate(iso, nowMs) {
  if (typeof iso !== 'string') return null
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) || at.getTime() <= nowMs ? null : at
}

// "HH:MM" local time of a reset still ahead, else "".
export function formatReset5h(iso, nowMs) {
  const at = futureDate(iso, nowMs)
  return at ? `${two(at.getHours())}:${two(at.getMinutes())}` : ''
}

// "Day HH:MM": a weekly reset needs the day, the time alone is ambiguous.
export function formatResetWeek(iso, nowMs) {
  const at = futureDate(iso, nowMs)
  return at ? `${WEEKDAYS[at.getDay()]} ${two(at.getHours())}:${two(at.getMinutes())}` : ''
}

// Joins the non-empty segments with a separator marker, so a missing one leaves no stray "│".
export function joinSegments(segments) {
  const out = []
  for (const segment of segments) {
    if (segment === undefined || segment === null || segment === '') continue
    if (out.length > 0) out.push(SEP)
    out.push(segment)
  }
  return out
}

export function shortDir(dir, home) {
  if (!home) return dir
  if (dir === home) return '~'
  return dir.startsWith(`${home}/`) ? `~${dir.slice(home.length)}` : dir
}

// ---- element tree -----------------------------------------------------------

// A Text leaf; props with no value are left out, since a prop must be plain data.
function text(content, { color, dim, bold } = {}) {
  const props = {}
  if (color) props.color = color
  if (dim) props.dimColor = true
  if (bold) props.bold = true
  return { type: 'Text', props, children: [content] }
}

const segment = (key, parts) => ({ type: 'Box', props: { key }, children: parts.filter(Boolean) })

function meter(key, label, pct, resetText) {
  const color = meterColor(pct)
  const cells = bar(pct)
  return segment(key, [
    text(label, { dim: true }),
    text(' '),
    cells.filled ? text(cells.filled, { color }) : null,
    text(cells.empty, { dim: true }),
    text(` ${String(pct).padStart(3)}%`, { color, bold: true }),
    resetText ? text(` ↻${resetText}`, { dim: true }) : null,
  ])
}

// The budget line: context, then the 5h and 7d plan limits. A segment without data is left out.
function budgetSegments(usage, nowMs) {
  const out = []
  const ctx = clampPct(usage?.context?.percent)
  if (ctx !== null) out.push(meter('ctx', 'ctx', ctx, ''))
  for (const limit of Array.isArray(usage?.rateLimits) ? usage.rateLimits : []) {
    const pct = clampPct(limit?.percentUsed)
    if (pct === null) continue
    if (limit.kind === 'five_hour') out.push(meter('h5', '5h', pct, formatReset5h(limit.resetsAt, nowMs)))
    if (limit.kind === 'seven_day') out.push(meter('d7', '7d', pct, formatResetWeek(limit.resetsAt, nowMs)))
  }
  return out
}

function gitSegment(git, worktree) {
  if (!git?.branch) return null
  return segment('git', [
    text(`⎇ ${git.branch}`, { color: 'magenta' }),
    git.dirty > 0 ? text(` ±${git.dirty}`, { color: 'yellow' }) : null,
    git.ahead > 0 ? text(` ↑${git.ahead}`, { color: 'cyan' }) : null,
    git.behind > 0 ? text(` ↓${git.behind}`, { color: 'red' }) : null,
    worktree ? text(` wt:${worktree}`, { color: 'cyan' }) : null,
  ])
}

function whereSegments({ dir, home, git, worktree, model, effort, style, agent }) {
  const out = []
  if (dir) out.push(segment('dir', [text(shortDir(dir, home), { color: 'blue', bold: true })]))
  out.push(gitSegment(git, worktree))
  if (model) {
    out.push(
      segment('model', [
        text(`◆ ${model}`, { bold: true }),
        effort ? text(` ${effort}`, { dim: true }) : null,
        style ? text(`  ✎ ${style}`, { color: 'cyan' }) : null,
      ]),
    )
  } else if (style) {
    out.push(segment('model', [text(`✎ ${style}`, { color: 'cyan' })]))
  }
  if (agent) out.push(segment('agent', [text(`@${agent}`, { color: 'cyan' })]))
  return out
}

const STATE_COLOR = { 'review due': 'red', reviewed: 'green', clear: undefined }

function oddLine(odd) {
  if (!odd) return null
  return [segment('odd', [text('ODD ', { dim: true }), text(odd.feature, { bold: true }), text(` · ${odd.open} open`, { dim: true })])]
}

function rddLine(rdd) {
  if (!rdd || (rdd.mode !== 'on' && rdd.mode !== 'off')) return null
  const mode = segment('rdd', [text('RDD ', { dim: true }), text(rdd.mode, { bold: true })])
  const state =
    rdd.mode === 'on' && rdd.state
      ? segment('rdd-state', [text(rdd.state, { color: STATE_COLOR[rdd.state], bold: rdd.state === 'review due', dim: rdd.state === 'clear' })])
      : null
  return [mode, state]
}

const row = (key, segments) => {
  const kids = joinSegments(segments).map((s) => (s.sep ? text(' │ ', { dim: true }) : s))
  return kids.length === 0 ? null : { type: 'Box', props: { key, flexDirection: 'row' }, children: kids }
}

// Builds the band: the replica (budget, then where) when `replica` is given, then the ODD and RDD lines.
// Returns null when there is nothing to draw. When rows are short the replica goes first.
export function buildBand({ replica, odd, rdd, nowMs, maxRows }) {
  const lines = []
  if (replica) {
    lines.push(row('line-budget', budgetSegments(replica.usage, nowMs)))
    lines.push(row('line-where', whereSegments(replica)))
  }
  lines.push(row('line-odd', oddLine(odd) ?? []))
  lines.push(row('line-rdd', rddLine(rdd) ?? []))
  let kept = lines.filter(Boolean)
  if (typeof maxRows === 'number' && maxRows > 0 && kept.length > maxRows) kept = kept.slice(kept.length - maxRows)
  if (kept.length === 0) return null
  return { type: 'Box', props: { flexDirection: 'column' }, children: kept }
}
