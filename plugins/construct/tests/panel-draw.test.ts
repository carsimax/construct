import { expect, test } from 'claude-code/testing'
import { card, effortMeter, fmtResetIn, gauge, laneBar, lanes, logRows, PALETTE } from '../hooks/panel/draw.js'
import Rail from '../hooks/panel/rail.tsx'
import Elapsed from '../hooks/panel/elapsed.tsx'

// Pure drawing primitives adapted from claude-flightdeck (S2, S7, S10).

const NOW = 100_000
const agent = (o: any = {}) => ({ id: 'a', startedMs: NOW - 50_000, endedMs: null, status: 'running', ...o })

// ---- gauge / effort meter ----------------------------------------------------

test('gauge fills round(pct * width / 100) cells and clamps', () => {
  expect(gauge(0, 10)).toEqual({ on: '', off: '▱▱▱▱▱▱▱▱▱▱' })
  expect(gauge(33, 10)).toEqual({ on: '▰▰▰', off: '▱▱▱▱▱▱▱' })
  expect(gauge(50, 4)).toEqual({ on: '▰▰', off: '▱▱' })
  expect(gauge(100, 6)).toEqual({ on: '▰▰▰▰▰▰', off: '' })
  expect(gauge(250, 5).on).toBe('▰▰▰▰▰')
  expect(gauge(-10, 5).on).toBe('')
  expect(gauge(Number.NaN, 5)).toEqual({ on: '', off: '▱▱▱▱▱' })
})

test('effort meter has four slots: low 1, medium 2, high 3, xhigh and max 4, unknown 0', () => {
  expect(effortMeter('low')).toEqual({ on: '▮', off: '▯▯▯' })
  expect(effortMeter('medium')).toEqual({ on: '▮▮', off: '▯▯' })
  expect(effortMeter('high')).toEqual({ on: '▮▮▮', off: '▯' })
  expect(effortMeter('xhigh')).toEqual({ on: '▮▮▮▮', off: '' })
  expect(effortMeter('max')).toEqual({ on: '▮▮▮▮', off: '' })
  expect(effortMeter(null)).toEqual({ on: '', off: '▯▯▯▯' })
  expect(effortMeter('weird')).toEqual({ on: '', off: '▯▯▯▯' })
})

// ---- lanes -----------------------------------------------------------------

test('lanes put overlapping agents on one shared axis that sums to width', () => {
  const l = lanes([agent({ id: 'a', startedMs: 10_000, endedMs: 60_000, status: 'done' }), agent({ id: 'b', startedMs: 35_000 })], 110_000, 20)
  expect(l).toEqual([
    { id: 'a', before: 0, bar: 10, after: 10 },
    { id: 'b', before: 5, bar: 15, after: 0 },
  ])
  for (const x of l) expect(x.before + x.bar + x.after).toBe(20)
})

test('lanes keep sequential agents apart and every bar at least one cell', () => {
  const l = lanes([agent({ id: 'a', startedMs: 10_000, endedMs: 50_000, status: 'done' }), agent({ id: 'b', startedMs: 70_000, endedMs: 70_100, status: 'done' })], 110_000, 10)
  expect(l[0]).toEqual({ id: 'a', before: 0, bar: 4, after: 6 })
  expect(l[1].before).toBe(6)
  expect(l[1].bar).toBe(1)
  expect(l[1].before + l[1].bar + l[1].after).toBe(10)
})

test('lanes ignore unknown start times and survive empty input and width 0', () => {
  expect(lanes([], NOW, 10)).toEqual([])
  const l = lanes([agent({ id: 'x', startedMs: null }), agent({ id: 'y', startedMs: NOW - 10 })], NOW, 8)
  expect(l.every((x) => x.before + x.bar + x.after === 8)).toBe(true)
  expect(lanes([agent()], NOW, 0)).toEqual([{ id: 'a', before: 0, bar: 0, after: 0 }])
})

test('laneBar draws · padding around a ━ run', () => {
  expect(laneBar({ before: 2, bar: 3, after: 1 })).toEqual({ before: '··', bar: '━━━', after: '·' })
  expect(laneBar(undefined)).toEqual({ before: '', bar: '━', after: '' })
})

// ---- log clamp ---------------------------------------------------------------

test('logRows leaves what other cards use, between 4 and 8 rows', () => {
  expect(logRows(40, 10)).toBe(8)
  expect(logRows(20, 10)).toBe(7)
  expect(logRows(14, 10)).toBe(4)
  expect(logRows(0, 30)).toBe(4)
})

// ---- card --------------------------------------------------------------------

test('card is a round bordered column with a space-between title row', () => {
  const body = { type: 'Text', props: {}, children: ['hello'] }
  const c = card({ title: 'Opus · main', status: '● working', color: 'claude', children: [body], width: 40 })
  expect(c.type).toBe('Box')
  expect(c.props).toMatchObject({ flexDirection: 'column', borderStyle: 'round', borderColor: 'claude', paddingX: 1, width: 40 })
  const [head, ...rest] = c.children
  expect(head.props.justifyContent).toBe('space-between')
  expect(head.children[0]).toEqual({ type: 'Text', props: { color: 'claude', bold: true }, children: ['Opus · main'] })
  expect(head.children[1]).toEqual({ type: 'Text', props: { color: 'claude' }, children: ['● working'] })
  expect(rest).toEqual([body])
})

test('card status can carry its own color and dim, and may be absent', () => {
  const c = card({ title: 'gate', status: { text: '3 checks', dim: true }, color: 'success', children: [] })
  expect(c.children[0].children[1].props).toEqual({ dimColor: true })
  expect(c.props.width).toBeUndefined()
  const bare = card({ title: 'gate', color: 'success', children: [] })
  expect(bare.children[0].children.length).toBe(1)
})

test('palette maps flightdeck roles to theme keys only', () => {
  expect(PALETTE).toMatchObject({ main: 'claude', agent: 'suggestion', gate: 'success', dim: 'inactive', faint: 'subtle' })
  for (const v of Object.values(PALETTE)) expect(String(v).startsWith('#')).toBe(false)
})

// ---- Client modules (called directly with a fake surface) ----------------------

function fakeSurface(columns = 0) {
  const timers: (() => void)[] = []
  const s: any = {
    columns,
    state: undefined,
    elements: { Box: 'Box', Text: 'Text' },
    setState: (v) => { s.state = v },
    every: (_ms, fn) => { timers.push(fn) },
  }
  return { s, tick: () => timers.forEach((f) => f()) }
}
const textsOf = (node, out: string[] = []) => {
  if (node == null) return out
  if (typeof node === 'string') out.push(node)
  else for (const k of [].concat(node.children ?? node.props?.children ?? [])) textsOf(k, out)
  return out
}

test('Rail idle draws a plain line with marks and no timer work', () => {
  const { s } = fakeSurface()
  const out = Rail({ active: false, width: 8, color: 'claude', dim: 'subtle', marks: [2], isMerge: false }, s)
  expect(textsOf(out).join('')).toBe('──┬─────')
})

test('Rail active shows a packet head that moves on each tick', () => {
  const { s, tick } = fakeSurface()
  const p = { active: true, width: 30, color: 'claude', dim: 'subtle', marks: [], isMerge: false }
  const first = textsOf(Rail(p, s)).join('')
  expect(first.length).toBe(30)
  expect(first).toContain('●')
  tick()
  const second = textsOf(Rail(p, s)).join('')
  expect(second).not.toBe(first)
  expect(second.indexOf('●')).toBe(first.indexOf('●') + 1)
})

test('Elapsed renders m:ss and adds a second per tick while running', () => {
  const { s, tick } = fakeSurface()
  const p = { since: 0, now: 65_000, endAt: null, color: 'suggestion' }
  expect(textsOf(Elapsed(p, s)).join('')).toBe('1:05')
  tick()
  expect(textsOf(Elapsed(p, s)).join('')).toBe('1:06')
})

test('Elapsed stops at its end time and shows hours past 60 minutes', () => {
  const { s, tick } = fakeSurface()
  const p = { since: 1000, now: 11_000, endAt: 11_000, color: 'inactive' }
  expect(textsOf(Elapsed(p, s)).join('')).toBe('0:10')
  tick()
  expect(textsOf(Elapsed(p, s)).join('')).toBe('0:10')
  const g = fakeSurface()
  expect(textsOf(Elapsed({ since: 0, now: 3_900_000, endAt: null, color: 'x' }, g.s)).join('')).toBe('1h05')
})

test('fmtResetIn shows the two largest units, or nothing when unknown or past', async () => {
  const now = 1_000_000
  const min = 60_000
  expect(fmtResetIn(now + 25 * min, now)).toBe('25m')
  expect(fmtResetIn(now + 190 * min, now)).toBe('3h10m')
  expect(fmtResetIn(now + 60 * min, now)).toBe('1h00m')
  expect(fmtResetIn(now + (4 * 1440 + 125) * min, now)).toBe('4d2h')
  expect(fmtResetIn(now + 5_000, now)).toBe('1m')
  expect(fmtResetIn(now - 1, now)).toBe('')
  expect(fmtResetIn(null, now)).toBe('')
  expect(fmtResetIn(undefined, now)).toBe('')
})
