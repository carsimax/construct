import { expect, test } from 'claude-code/testing'
import { card, effortMeter, fmtResetIn, gauge, changeRows, PALETTE } from '../hooks/panel/draw.js'

// Pure drawing primitives adapted from claude-flightdeck (S2, S7, S10; harness-extras S3 dropped lanes and the Client modules).

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

// ---- changes clamp -------------------------------------------------------------

test('changeRows leaves what other cards use and the card frame (3 rows), up to 10, -1 when the frame does not fit', () => {
  expect(changeRows(40, 10)).toBe(10)
  expect(changeRows(20, 10)).toBe(7)
  expect(changeRows(13, 10)).toBe(0)
  expect(changeRows(12, 10)).toBe(-1)
  expect(changeRows(0, 30)).toBe(-1)
  expect(changeRows(Infinity, 30)).toBe(10)
})
// ---- card --------------------------------------------------------------------

test('card is a round bordered column with a space-between title row', () => {
  const body = { type: 'Text', props: {}, children: ['hello'] }
  const c = card({ title: 'Opus · main', status: '● working', color: 'claude', children: [body], width: 40 })
  expect(c.type).toBe('Box')
  expect(c.props).toMatchObject({ flexDirection: 'column', borderStyle: 'round', borderColor: 'claude', paddingX: 1, width: 40 })
  const [head, ...rest] = c.children
  expect(head.props.justifyContent).toBe('space-between')
  expect(head.children[0]).toEqual({ type: 'Text', props: { color: 'claude', weight: 'semibold' }, children: ['Opus · main'] })
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
  expect(PALETTE).toMatchObject({ git: 'remember', main: 'claude', agent: 'suggestion', gate: 'success', dim: 'inactive', faint: 'subtle' })
  for (const v of Object.values(PALETTE)) expect(String(v).startsWith('#')).toBe(false)
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
