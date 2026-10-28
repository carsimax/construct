import { expect, test } from 'claude-code/testing'
import { BAND_COLUMNS, PALETTE, buildBand, clock } from '../hooks/band/layout.js'
import { VERSION } from '../hooks/status/version.js'
import { initialState } from '../hooks/band/state.js'
import { activeWork } from '../hooks/status/tasks.js'

// Pure tests of the band above the prompt (hooks/band/layout.js) and the feature reader it shows.

const NOW = 1_000_000

const flat = (node): string => (typeof node === 'string' ? node : (node?.children ?? []).map(flat).join(''))
// Every Text leaf with its props.
function leaves(node, out: { text: string; props: any }[] = []) {
  if (typeof node === 'string' || node == null) return out
  if (node.type === 'Text' && !(node.children ?? []).some((k) => k?.type === 'Text')) out.push({ text: flat(node), props: node.props ?? {} })
  for (const k of node.children ?? []) leaves(k, out)
  return out
}
// The band's rows: each child of the root column is one row.
const rawRowsOf = (tree) => (tree?.children ?? []).map(flat)
// The same rows without the version tag at the right edge.
const rowsOf = (tree) => rawRowsOf(tree).map((r) => r.replace(/\s+v\d+\.\d+\.\d+$/, ''))

const agent = (o: any = {}) => ({ id: 'a1', role: 'worker', type: 'construct:worker', model: 'claude-sonnet-5-5', startedMs: NOW - 102_000, endedMs: null, status: 'running', ...o })
const odd = {
  feature: 'engram-only-memory', open: 2, task: { id: 'T3', title: 'Explorer recall tools' },
  tasks: [{ id: 'T1', done: true }, { id: 'T2', done: true }, { id: 'T3', done: false }, { id: 'T4', done: false }],
}
const busy = (o: any = {}) => ({
  ...initialState(),
  turn: { turnId: 't' },
  agents: [agent(), agent({ id: 'a2', role: 'explorer', type: 'construct:explorer', model: 'claude-haiku-5-5', startedMs: NOW - 20_000 })],
  ...o,
})
const band = (o: any = {}) => buildBand({ state: busy(), odd, nowMs: NOW, columns: 140, ...o })

test('nothing to show draws nothing: idle, no feature, no agents', () => {
  for (const state of [undefined, null, initialState()]) expect(buildBand({ state, odd: null, nowMs: NOW, columns: 100 })).toBe(null)
})

test('one row: phase, feature with checkpoints, running agents; no task id or title', () => {
  expect(rowsOf(band())).toEqual(['● building · ADD engram-only-memory ●━●━◆━○ · 2 agents 1:42'])
  expect(flat(band())).not.toContain('T3')
  expect(flat(band())).not.toContain('Explorer recall tools')
})

test('one row even with agents running; a stored gate or inline count is never drawn', () => {
  expect(band().children).toHaveLength(1)
  const stale = band({ state: busy({ turn: null, gate: { verdicts: { rule: 1, ask: 2, cleared: 3, deny: 4 }, pending: {} }, inline: { count: 3 } }) })
  const text = flat(stale)
  for (const w of ['gate', 'pending', 'inline', '✗', '⚠', '✓']) expect(text).not.toContain(w)
})

test('the band draws nothing the status line shows: no model of the main thread, branch, context or limits', () => {
  const text = rowsOf(band()).join('\n')
  for (const w of ['⎇', 'ctx', '5h', '7d', 'Opus', '%']) expect(text).not.toContain(w)
})

test('status reads ready when idle, the phase while a turn runs, and waiting on you when blocked', () => {
  expect(rowsOf(band({ state: busy({ turn: null, agents: [] }) }))[0]).toMatch(/^○ ready · ADD/)
  expect(rowsOf(band({ state: busy({ agents: [] }) }))[0]).toMatch(/^● busy · /)
  expect(rowsOf(band({ state: busy({ agents: [agent({ role: 'verifier', type: 'construct:verifier' })] }) }))[0]).toMatch(/^● verifying · /)
  expect(rowsOf(band({ state: busy({ blocked: true }) }))[0]).toMatch(/^◆ waiting on you · /)
  expect(leaves(band({ state: busy({ blocked: true }) }))[0].props.color).toBe(PALETTE.amber)
})

test('a blocked or busy session shows its status even with nothing else', () => {
  expect(rowsOf(buildBand({ state: { ...initialState(), blocked: true }, odd: null, nowMs: NOW }))).toEqual(['◆ waiting on you'])
  expect(rowsOf(buildBand({ state: { ...initialState(), turn: { turnId: 't' } }, odd: null, nowMs: NOW }))).toEqual(['● busy'])
})

test('a single agent shows glyph, short name and clock; several show a count and the oldest clock', () => {
  expect(rowsOf(band({ state: busy({ agents: [agent()] }) }))).toEqual(['● building · ADD engram-only-memory ●━●━◆━○ · ⚒ worker 1:42'])
  expect(rowsOf(band({ odd: null, state: busy({ agents: [agent(), agent({ id: 'b', startedMs: NOW - 5_000 }), agent({ id: 'c', startedMs: NOW - 9_000 })] }) }))).toEqual(['● building · 3 agents 1:42'])
})

test('only running agents count, oldest first; a done agent leaves the band', () => {
  const agents = [agent({ id: 'b', startedMs: NOW - 5_000 }), agent({ id: 'c', role: 'explorer', status: 'done', endedMs: NOW }), agent({ id: 'a', role: 'review_risk', type: 'construct:review-risk', startedMs: NOW - 9_000 })]
  expect(rowsOf(band({ odd: null, state: busy({ agents }) }))).toEqual(['● reviewing · 2 agents 0:09'])
  expect(rowsOf(band({ odd: null, state: busy({ agents: [agent({ id: 'c', role: 'review_risk', type: 'construct:review-risk', startedMs: NOW - 9_000 })] }) }))).toEqual(['● reviewing · ◎ review-risk 0:09'])
  expect(rowsOf(band({ state: busy({ agents: [agent({ status: 'done', endedMs: NOW })] }) }))[0]).not.toContain('⚒')
})

test('an agent with no construct role shows its type with the plain look; no model is drawn', () => {
  const row = rowsOf(band({ odd: null, state: busy({ agents: [agent({ role: 'my-agent', type: 'my-agent' })] }) }))[0]
  expect(row).toBe('● working · • my-agent 1:42')
  expect(row).not.toContain('Sonnet')
})

test('a narrow band clips the one row with an ellipsis', () => {
  const rows = rowsOf(band({ columns: 40 }))
  expect(rows).toEqual(['● building · ADD engram-only-memory ●━●…'])
  expect(cellsOf(rows[0])).toBeLessThanOrEqual(40)
})

test('an unknown width falls back to BAND_COLUMNS', () => {
  const long = { ...odd, feature: 'x'.repeat(200) }
  for (const r of rowsOf(band({ columns: undefined, odd: long }))) expect(cellsOf(r)).toBeLessThanOrEqual(BAND_COLUMNS)
})

test('every color the band draws is a theme key', () => {
  const keys = Object.values(PALETTE)
  for (const l of leaves(band())) if (l.props.color) expect(keys).toContain(l.props.color)
})

test('agent names and features with control characters render no control bytes', () => {
  for (const name of ['wor\u001b[31mker', 'x\u0007y', 'a\u009bb']) {
    const text = rowsOf(band({ state: busy({ agents: [agent({ role: name, type: name })] }), odd: { ...odd, feature: name } })).join('')
    expect(/[\u0000-\u001f\u007f-\u009f]/.test(text)).toBe(false)
  }
})

test('many tasks keep the latest checkpoints behind a leading ellipsis', () => {
  const tasks = Array.from({ length: 20 }, (_, i) => ({ id: `T${i + 1}`, done: i < 15 }))
  const row = rowsOf(band({ odd: { ...odd, tasks } }))[0]
  expect(row).toContain('…━●━')
})

test('many tasks keep the open checkpoint in view', () => {
  const tasks = Array.from({ length: 30 }, (_, i) => ({ id: `T${i + 1}`, done: i < 4 }))
  const row = rowsOf(band({ odd: { ...odd, tasks } }))[0]
  expect(row).toContain('●━◆━○')
})

test('an agent of another plugin named like a construct role is drawn as a plain agent', () => {
  const row = rowsOf(band({ state: busy({ agents: [agent({ role: 'worker', type: 'worker' })] }) }))[0]
  expect(row).toContain('• worker 1:42')
  expect(row).not.toContain('⚒')
})

test('clock shows m:ss, then XhYY from an hour on', () => {
  expect(clock(65_000)).toBe('1:05')
  expect(clock(3_725_000)).toBe('1h02')
  expect(clock(undefined)).toBe('0:00')
})

// ---- S4: wide characters count as two columns -----------------------------------

// Display width by grapheme cluster: a wide first code point, or a ZWJ / VS16 emoji sequence, takes two columns.
const WIDE_RE = /[ᄀ-ᅟ⺀-꓏가-힣＀-｠￠-￦\p{Emoji_Presentation}]/u
const cellsOf = (s: string) =>
  [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].reduce((n, { segment: g }) => {
    const wide =
      WIDE_RE.test(String.fromCodePoint(g.codePointAt(0)!)) ||
      (/[\u200d\ufe0f]/.test(g) && /\p{Extended_Pictographic}/u.test(g)) ||
      /[\p{Emoji_Modifier}\u20e3]/u.test(g)
    return n + (wide ? 2 : 1)
  }, 0)

test('S4 wide text in the feature and agent names never overflows the band at 40, 41, 60 and 80 columns', () => {
  for (const columns of [40, 41, 60, 80]) {
    for (const w of ['検索エージェント検索エージェント', '🚀🚀🚀', 'ＡＢＣＤＥＦＧＨ', '👨‍👩‍👧 ❤️ e\u0301', '☝🏽'.repeat(8)]) {
      const rows = rowsOf(band({ columns, odd: { ...odd, feature: w }, state: busy({ agents: [agent({ role: w, type: w }), agent({ id: 'x', role: w, type: w })] }) }))
      expect(rows.join('')).toContain([...new Intl.Segmenter().segment(w)][0].segment) // wide text is really rendered
      for (const r of rows) expect(cellsOf(r), `${columns} cols: ${r}`).toBeLessThanOrEqual(columns)
    }
  }
})

test('S4 a clipped name never ends in a broken cluster', () => {
  for (const unit of ['a👨‍👩‍👧', 'e\u0301x', '❤️b', 'ab👨‍👩‍👧c']) {
    const role = unit.repeat(8)
    const row = rowsOf(band({ columns: 40, odd: null, state: busy({ agents: [agent({ role, type: role })] }) }))[0]
    const before = row.slice(0, row.indexOf('…'))
    expect(before, unit).not.toMatch(/\u200d$/)
    expect(before, unit).not.toMatch(/^\p{M}|\s\p{M}/u)
    expect(cellsOf(row), unit).toBeLessThanOrEqual(40)
  }
})

// ---- the feature reader ------------------------------------------------------------

const DOC = (rows: string[]) =>
  ['# f', '', '## Tasks', '', '| ID | Specs | Task | Status |', '|---|---|---|---|', ...rows, '', '## Log'].join('\n')

test('activeWork counts a status whose first word is done or dropped as finished', async () => {
  const text = DOC(['| T1 | S1 | a | done (RED 4 fail; GREEN 24/24) |', '| T2 | S1 | b | Done. |', '| T3 | S1 | c | dropped — reason |', '| T4 | S1 | d | undone |'])
  expect(activeWork([{ name: 'f.md', mtimeMs: 1, text }])).toEqual({
    feature: 'f',
    open: 1,
    task: { id: 'T4', title: 'd' },
    tasks: [{ id: 'T1', done: true }, { id: 'T2', done: true }, { id: 'T3', done: true }, { id: 'T4', done: false }],
  })
})

test('activeWork adds the first unfinished task id and title', async () => {
  const text = DOC(['| T1 | S1 | first | done |', '| T2 | S1 | second one | in progress |', '| T3 | S2 | third | pending |'])
  expect(activeWork([{ name: 'f.md', mtimeMs: 1, text }])).toEqual({
    feature: 'f',
    open: 2,
    task: { id: 'T2', title: 'second one' },
    tasks: [{ id: 'T1', done: true }, { id: 'T2', done: false }, { id: 'T3', done: false }],
  })
  expect(activeWork([{ name: 'f.md', mtimeMs: 1, text: DOC(['| T1 | S1 | a | done |']) }])).toBe(null)
  expect(activeWork([])).toBe(null)
})


test('activeWork joins surplus cells from an unescaped pipe into the task column', async () => {
  const text = DOC(['| T1 | S1 | a | b | done |', '| T2 | S1 | x | y | pending |'])
  expect(activeWork([{ name: 'f.md', mtimeMs: 1, text }])).toEqual({
    feature: 'f',
    open: 1,
    task: { id: 'T2', title: 'x|y' },
    tasks: [{ id: 'T1', done: true }, { id: 'T2', done: false }],
  })
})

test('the plugin version sits at the right edge of the row, dim', () => {
  const [row] = rawRowsOf(band({ columns: 140 }))
  expect(row.length).toBe(140)
  expect(row.endsWith(` v${VERSION}`)).toBe(true)
  expect(leaves(band({ columns: 140 })).at(-1)).toEqual({ text: `v${VERSION}`, props: expect.objectContaining({ dimColor: true }) })
})

test('the version is not drawn when the band is null', () => {
  expect(buildBand({ state: initialState(), odd: null, nowMs: NOW, columns: 140 })).toBe(null)
})

test('the version is the first thing dropped when the row is narrow', () => {
  const content = '● building · ADD engram-only-memory ●━●━◆━○ · 2 agents 1:42'
  const w = [...content].length
  expect(rawRowsOf(band({ columns: w + 8 }))).toEqual([`${content} v${VERSION}`])
  expect(rawRowsOf(band({ columns: w + 7 }))).toEqual([content])
  expect(rawRowsOf(band({ columns: w }))).toEqual([content])
})
