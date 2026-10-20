import { expect, test } from 'claude-code/testing'
import { buildPanel, buildSummary, layoutFor } from '../hooks/panel/layout.js'
import { initialState } from '../hooks/panel/state.js'
import { buildBand } from '../hooks/status/format.js'
import { activeWork } from '../hooks/status/tasks.js'

const NOW = 1_000_000

// ---- helpers -------------------------------------------------------------

function leaves(node, out: { text: string; props: any }[] = []) {
  if (typeof node === 'string' || node == null) return out
  if (node.type === 'Text') out.push({ text: (node.children ?? []).filter((k) => typeof k === 'string').join(''), props: node.props ?? {} })
  else for (const k of node.children ?? []) leaves(k, out)
  return out
}
const textOf = (tree) => leaves(tree).map((l) => l.text).join('')
const find = (tree, needle: string) => leaves(tree).find((l) => l.text.includes(needle))

// Rows are the direct Box rows; a row's text is the concatenation of its leaves.
function rowsOf(node, out: string[] = []) {
  if (!node || typeof node === 'string') return out
  const kids = node.children ?? []
  if (node.type === 'Box' && node.props?.flexDirection === 'row' && kids.every((k) => typeof k === 'string' || k.type === 'Text' || k.props?.flexDirection !== 'column')) {
    out.push(textOf(node))
    return out
  }
  for (const k of kids) rowsOf(k, out)
  return out
}

const agent = (o: any = {}) => ({
  id: 'a1', role: 'odd-worker', type: 'construct:odd-worker', description: '', model: 'sonnet', effort: 'high',
  ctx: 42000, steps: 7, startedMs: NOW - 65_000, endedMs: null, status: 'running', ...o,
})

const usage = {
  context: { window: 200000, percent: 12 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 40, resetsAt: null },
    { kind: 'seven_day', percentUsed: 85, resetsAt: null },
  ],
}
const replica = { usage, dir: '/home/me/proj', home: '/home/me', git: { branch: 'main', dirty: 2, ahead: 0, behind: 0 }, worktree: null, model: 'opus', effort: 'high', style: null, agent: null }
const odd = { feature: 'construct-panel', open: 2, task: { id: 'T2', title: 'Pure panel layout' } }
const rdd = { mode: 'on', state: 'review due' }

const full = () => ({
  ...initialState(),
  agents: [agent(), agent({ id: 'a2', role: 'odd-explorer', status: 'done', endedMs: NOW - 1000, startedMs: NOW - 30_000 })],
  inline: { count: 3, last: '/home/me/proj/plugins/construct/hooks/register.js' },
  gate: {
    cells: ['allowed', 'asked', 'denied', 'sub', 'allowed'],
    counts: { allowed: 2, asked: 1, denied: 1, sub: 1 },
    denied: 1,
    lastDenied: { tool: 'Bash', detail: 'curl -H token=*** x' },
  },
  receipt: { turnId: 't', startedMs: NOW - 90_000, endedMs: null, agents: 2, edits: 3, errors: 1, costStart: 1, cost: 0.5 },
  compactions: 2,
})

const args = (o: any = {}) => ({ panel: full(), replica, odd, rdd, nowMs: NOW, columns: 80, rows: 40, ...o })

// ---- layout --------------------------------------------------------------

test('layoutFor picks mini below 56, compact to 109, wide from 110', async () => {
  expect(layoutFor(40)).toBe('mini')
  expect(layoutFor(55)).toBe('mini')
  expect(layoutFor(56)).toBe('compact')
  expect(layoutFor(109)).toBe('compact')
  expect(layoutFor(110)).toBe('wide')
  expect(layoutFor(undefined)).toBe('compact')
})

test('buildPanel is null when nothing has anything to show', async () => {
  expect(buildPanel({ panel: initialState(), replica: null, odd: null, rdd: null, nowMs: NOW, columns: 80, rows: 30 })).toBe(null)
})

test('empty sections take no room', async () => {
  const tree = buildPanel({ panel: initialState(), replica: null, odd, rdd: null, nowMs: NOW, columns: 80, rows: 30 })
  const text = textOf(tree)
  expect(text).toContain('ODD')
  for (const word of ['inline', 'denied', 'turn', 'agents', 'ctx', 'RDD']) expect(text).not.toContain(word)
  expect(rowsOf(tree).length).toBe(1)
})

test('main section follows the replica rule and shows the compaction counter', async () => {
  const without = textOf(buildPanel(args({ replica: null })))
  expect(without).not.toContain('ctx')
  expect(without).not.toContain('5h')
  const withR = textOf(buildPanel(args()))
  for (const w of ['ctx', '5h', '7d', '~/proj', 'main', 'opus', '⟲2']) expect(withR).toContain(w)
  expect(textOf(buildPanel(args({ panel: { ...full(), compactions: 0 } })))).not.toContain('⟲')
})

test('ODD row carries feature, task id and title, and open count; RDD shows mode and state', async () => {
  const text = textOf(buildPanel(args()))
  expect(text).toContain('ODD construct-panel · T2 Pure panel layout · 2 open')
  expect(text).toContain('RDD on')
  expect(find(buildPanel(args()), 'review due')?.props.color).toBe('error')
  expect(textOf(buildPanel(args({ odd: { feature: 'x', open: 1 } })))).toContain('ODD x · 1 open')
})

test('agent cards show role, model, effort, ctx in k, steps, elapsed or done, and a +N more row', async () => {
  const many = { ...full(), agents: [1, 2, 3, 4, 5].map((i) => agent({ id: `a${i}`, status: i === 1 ? 'running' : 'done', endedMs: NOW - i * 10, startedMs: NOW - 61_000 })) }
  const tree = buildPanel(args({ panel: many }))
  const text = textOf(tree)
  expect(find(tree, 'odd-worker')?.props.bold).toBe(true)
  for (const w of ['sonnet', 'high', '42k', '7', '1:01', 'done', '+2 more']) expect(text).toContain(w)
  expect(rowsOf(tree).filter((r) => r.startsWith('odd-worker')).length).toBe(3)
})

test('inline writes show count and a shortened last path in the error color, only when > 0', async () => {
  const tree = buildPanel(args())
  const hit = find(tree, 'inline writes 3')!
  expect(hit.props.color).toBe('error')
  expect(hit.text).toContain('register.js')
  expect(hit.text).not.toContain('/home/me/proj/plugins')
  expect(textOf(buildPanel(args({ panel: { ...full(), inline: { count: 0, last: null } } })))).not.toContain('inline writes')
})

test('gate strip colors cells by verdict and shows the denied count with the masked detail', async () => {
  const tree = buildPanel(args())
  const cells = leaves(tree).filter((l) => l.text === '●')
  expect(cells.map((c) => c.props.color)).toEqual(['success', 'suggestion', 'error', 'inactive', 'success'])
  const text = textOf(tree)
  expect(text).toContain('denied 1')
  expect(text).toContain('Bash: curl -H token=*** x')
})

test('gate cells fit the width and keep the latest ones', async () => {
  const cells = Array.from({ length: 60 }, (_, i) => (i === 59 ? 'denied' : 'allowed'))
  const panel = { ...full(), gate: { ...full().gate, cells } }
  for (const columns of [40, 80]) {
    const drawn = leaves(buildPanel(args({ panel, columns }))).filter((l) => l.text === '●')
    expect(drawn.length).toBeGreaterThan(5)
    expect(drawn.length).toBeLessThanOrEqual(columns)
    expect(drawn[drawn.length - 1].props.color).toBe('error')
  }
})

test('receipt shows duration, agents, edits, errors in error color, cost, and running', async () => {
  const tree = buildPanel(args())
  const text = textOf(tree)
  for (const w of ['running', '1:30', '2 agents', '3 edits', '1 errors', '$0.50']) expect(text).toContain(w)
  expect(find(tree, '1 errors')?.props.color).toBe('error')
  const done = { ...full(), receipt: { ...full().receipt, endedMs: NOW - 30_000, errors: 0, cost: null } }
  const t2 = buildPanel(args({ panel: done }))
  expect(textOf(t2)).not.toContain('running')
  expect(textOf(t2)).toContain('1:00')
  expect(textOf(t2)).not.toContain('$')
  expect(find(t2, '0 errors')?.props.color).toBe(undefined)
})

// ---- widths --------------------------------------------------------------

test('120 columns puts sections in two columns; 80 stacks them', async () => {
  const wide = buildPanel(args({ columns: 120 }))
  const cols = (wide.children as any[]).filter((c) => c.props?.flexDirection === 'column')
  expect(cols.length).toBe(2)
  expect(textOf(cols[0])).toContain('ODD')
  expect(textOf(cols[0])).toContain('running')
  expect(textOf(cols[1])).toContain('odd-worker')
  expect(textOf(cols[1])).toContain('inline writes')
  expect(textOf(cols[1])).toContain('denied')
  const compact = buildPanel(args({ columns: 80 }))
  expect(compact.props.flexDirection).toBe('column')
  expect((compact.children as any[]).every((c) => c.props?.flexDirection !== 'column')).toBe(true)
})

test('40 columns is mini: at most 8 rows, inline alert and ODD first, none wider than 40', async () => {
  const tree = buildPanel(args({ columns: 40, rows: 40 }))
  const rows = rowsOf(tree)
  expect(rows.length).toBeLessThanOrEqual(8)
  expect(rows[0]).toContain('inline writes')
  expect(rows[1]).toContain('ODD')
  expect(rows.join('\n')).toContain('ctx')
  for (const r of rows) expect(r.length).toBeLessThanOrEqual(40)
})

test('rows caps the output and no row exceeds the width at 80 and 120', async () => {
  for (const columns of [56, 80, 120]) {
    for (const r of rowsOf(buildPanel(args({ columns, rows: 60 })))) expect(r.length).toBeLessThanOrEqual(columns)
  }
  expect(rowsOf(buildPanel(args({ columns: 80, rows: 5 }))).length).toBeLessThanOrEqual(5)
})

// ---- summary -------------------------------------------------------------

test('buildSummary is one row with ctx, running agents, ODD task id, RDD state, and inline alert', async () => {
  const tree = buildSummary({ panel: full(), usage, odd, rdd, nowMs: NOW })
  const text = textOf(tree)
  for (const w of ['12%', '1 agent', 'T2', 'review due', 'inline 3']) expect(text).toContain(w)
  expect(find(tree, 'inline 3')?.props.color).toBe('error')
  expect(rowsOf(tree).length).toBe(1)
})

test('buildSummary leaves out what is absent and is null when nothing shows', async () => {
  expect(buildSummary({ panel: initialState(), usage: null, odd: null, rdd: null, nowMs: NOW })).toBe(null)
  const text = textOf(buildSummary({ panel: initialState(), usage, odd: null, rdd: { mode: 'off' }, nowMs: NOW }))
  expect(text).toContain('12%')
  for (const w of ['agent', 'inline', 'review']) expect(text).not.toContain(w)
})

// ---- band stays as it was ------------------------------------------------

test('buildBand output is unchanged by the helper exports', async () => {
  const tree = buildBand({ replica: null, odd: { feature: 'f', open: 1 }, rdd: { mode: 'off' }, nowMs: NOW })
  expect(textOf(tree)).toBe('▌ ODD f · 1 open▌ RDD off')
})

// ---- tasks ---------------------------------------------------------------

const DOC = (rows: string[]) =>
  ['# f', '', '## Tasks', '', '| ID | Specs | Task | Status |', '|---|---|---|---|', ...rows, '', '## Log'].join('\n')

test('activeWork adds the first unfinished task id and title; activeFeature is unchanged', async () => {
  const text = DOC(['| T1 | S1 | first | done |', '| T2 | S1 | second one | in progress |', '| T3 | S2 | third | pending |'])
  expect(activeWork([{ name: 'f.md', mtimeMs: 1, text }])).toEqual({ feature: 'f', open: 2, task: { id: 'T2', title: 'second one' } })
  expect(activeWork([{ name: 'f.md', mtimeMs: 1, text: DOC(['| T1 | S1 | a | done |']) }])).toBe(null)
  expect(activeWork([])).toBe(null)
})
