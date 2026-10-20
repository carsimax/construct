import { expect, test } from 'claude-code/testing'
import { buildPanel } from '../hooks/panel/layout.js'
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

test('buildPanel is null when nothing has anything to show', async () => {
  expect(buildPanel({ panel: initialState(), replica: null, odd: null, rdd: null, nowMs: NOW, columns: 80, rows: 30 })).toBe(null)
})

test('empty sections take no room', async () => {
  const tree = buildPanel({ panel: initialState(), replica: null, odd, rdd: null, nowMs: NOW, columns: 80, rows: 30 })
  const rows = rowsOf(tree).map((r) => r.trim())
  expect(rows[0]).toBe('ODD')
  for (const word of ['alerts', 'inline', 'denied', 'turn', 'agents', 'ctx', 'review', 'gate', 'session']) expect(rows.join('\n')).not.toContain(word)
})

test('session and context follow the replica rule; compactions show only above zero', async () => {
  const without = textOf(buildPanel(args({ replica: null })))
  for (const w of ['ctx', '5h', 'session', 'compactions']) expect(without).not.toContain(w)
  const withR = textOf(buildPanel(args()))
  for (const w of ['ctx', '5h', '7d', '~/proj', 'main', 'opus', '⟲2']) expect(withR).toContain(w)
  expect(textOf(buildPanel(args({ panel: { ...full(), compactions: 0 } })))).not.toContain('⟲')
})

test('ODD block carries feature, task id (bold) and title, and open count; review shows mode and state', async () => {
  const tree = buildPanel(args())
  const text = textOf(tree)
  expect(text).toMatch(/feature\s+construct-panel/)
  expect(text).toMatch(/T2\s+Pure panel layout/)
  expect(text).toMatch(/open\s+2/)
  expect(find(tree, 'T2')?.props.bold).toBe(true)
  expect(text).toMatch(/rdd\s+on/)
  expect(find(tree, 'review due')?.props.color).toBe('error')
  expect(textOf(buildPanel(args({ odd: { feature: 'x', open: 1 } })))).toMatch(/feature\s+x\s+open\s+1/)
})

test('agent cards show role, model, effort, ctx in k, steps, elapsed or done, and a +N more row', async () => {
  const many = { ...full(), agents: [1, 2, 3, 4, 5].map((i) => agent({ id: `a${i}`, status: i === 1 ? 'running' : 'done', endedMs: NOW - i * 10, startedMs: NOW - 61_000 })) }
  const tree = buildPanel(args({ panel: many }))
  const text = textOf(tree)
  expect(find(tree, 'odd-worker')?.props.bold).toBe(true)
  for (const w of ['sonnet', 'high', '42k', '7 steps', '1:01', 'done', '+2 more']) expect(text).toContain(w)
  expect(rowsOf(tree).filter((r) => r.trim().startsWith('odd-worker')).length).toBe(3)
})

test('agent details wrap to a second row when they do not fit beside the role', async () => {
  const rows = rowsOf(buildPanel(args({ columns: 30, rows: 80 }))).map((r) => r.trim())
  const i = rows.indexOf('odd-worker')
  expect(i).toBeGreaterThan(0)
  expect(rows[i + 1]).toContain('sonnet')
})

test('inline writes show count and a shortened last path in the error color, only when > 0', async () => {
  const tree = buildPanel(args())
  expect(find(tree, 'inline writes')?.props.color).toBe('error')
  const path = find(tree, 'register.js')!
  expect(path.text).not.toContain('/home/me/proj/plugins')
  expect(textOf(tree)).toMatch(/inline writes\s+3/)
  expect(textOf(buildPanel(args({ panel: { ...full(), inline: { count: 0, last: null } } })))).not.toContain('inline writes')
})

test('gate strip colors cells by verdict; denied count and masked detail are alerts', async () => {
  const tree = buildPanel(args())
  const cells = leaves(tree).filter((l) => l.text === '●')
  expect(cells.map((c) => c.props.color)).toEqual(['success', 'suggestion', 'error', 'inactive', 'success'])
  const text = textOf(tree)
  expect(text).toMatch(/denied\s+1/)
  expect(text).toContain('Bash: curl -H token=*** x')
  expect(find(tree, 'denied')?.props.color).toBe('error')
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

test('turn shows time, running, counts above zero, errors in error color, and cost', async () => {
  const tree = buildPanel(args())
  const text = textOf(tree)
  expect(text).toContain('running')
  expect(text).toContain('1:30')
  for (const re of [/agents\s+2/, /edits\s+3/, /errors\s+1/, /cost\s+\$0\.50/]) expect(text).toMatch(re)
  expect(find(tree, 'errors')?.props.color).toBe(undefined)
  expect(leaves(tree).find((l) => l.text === '1' && l.props.color === 'error')).toBeTruthy()
  const done = { ...full(), receipt: { ...full().receipt, endedMs: NOW - 30_000, errors: 0, cost: null } }
  const t2 = textOf(buildPanel(args({ panel: done })))
  expect(t2).not.toContain('running')
  expect(t2).toContain('1:00')
  expect(t2).not.toContain('$')
  expect(t2).not.toContain('errors')
})

// ---- widths --------------------------------------------------------------

test('every width draws one column of rows; a wide pane does not split in two', async () => {
  for (const columns of [40, 80, 140]) {
    const tree = buildPanel(args({ columns }))
    expect(tree.props.flexDirection).toBe('column')
    expect((tree.children as any[]).every((c) => c.props?.flexDirection === 'row')).toBe(true)
  }
})

test('narrow widths show the full content too, in block order, within the width', async () => {
  const rows = rowsOf(buildPanel(args({ columns: 40, rows: 80 })))
  expect(rows[0]).toBe('alerts')
  const text = rows.join('\n')
  for (const w of ['ODD', '5h', '7d', '~/proj', 'rdd', 'denied', 'edits']) expect(text).toContain(w)
  for (const r of rows) expect(r.length).toBeLessThanOrEqual(40)
})

test('no fixed row cap: many rows render when rows allows, and rows caps them', async () => {
  expect(rowsOf(buildPanel(args({ columns: 80, rows: 80 }))).length).toBeGreaterThan(8)
  expect(rowsOf(buildPanel(args({ columns: 80, rows: 12 }))).length).toBeLessThanOrEqual(12)
  expect(rowsOf(buildPanel(args({ columns: 80, rows: undefined }))).length).toBeGreaterThan(8)
})

test('the first block may be cut by rows; no row exceeds the width at 40, 56, 80 and 120', async () => {
  for (const columns of [40, 56, 80, 120]) {
    for (const r of rowsOf(buildPanel(args({ columns, rows: 80 })))) expect(r.length).toBeLessThanOrEqual(columns)
  }
  const rows = rowsOf(buildPanel(args({ columns: 80, rows: 3 })))
  expect(rows.length).toBe(3)
  expect(rows[0]).toBe('alerts')
})

test('a long directory and branch never make a row wider than its column', async () => {
  const dir = '/Users/me/' + 'd'.repeat(60)
  const longReplica = { usage, dir, home: '/Users/me', git: { branch: 'feat/' + 'b'.repeat(70), dirty: 2, ahead: 1 }, worktree: null, model: 'claude-opus-4', effort: 'high' }
  for (const columns of [56, 120]) {
    const all = rowsOf(buildPanel(args({ columns, rows: 80, replica: longReplica })))
    expect(all.length).toBeGreaterThan(0)
    for (const r of all) expect(r.length).toBeLessThanOrEqual(columns)
  }
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

// ---- blocks --------------------------------------------------------------

const rows56 = (o: any = {}) => rowsOf(buildPanel(args({ columns: 56, rows: 80, ...o })))

test('blocks are titled, in order, with exactly one blank row between them', async () => {
  const rows = rows56()
  const titles = ['alerts', 'ODD', 'context', 'session', 'review', 'agents', 'gate', 'turn']
  const at = titles.map((t) => rows.findIndex((r) => r.trim() === t))
  for (const i of at) expect(i).toBeGreaterThanOrEqual(0)
  expect([...at].sort((a, b) => a - b)).toEqual(at)
  for (const i of at.slice(1)) expect(rows[i - 1].trim()).toBe('')
  for (let i = 1; i < rows.length; i++) expect(rows[i].trim() === '' && rows[i - 1].trim() === '').toBe(false)
  expect(rows[rows.length - 1].trim()).not.toBe('')
})

test('label left, value right-aligned so it ends at column 56', async () => {
  const rows = rows56()
  const row = rows.find((r) => r.trim().startsWith('open'))!
  expect(row.length).toBe(56)
  expect(row.endsWith('2')).toBe(true)
  const model = rows.find((r) => r.trim().startsWith('model'))!
  expect(model.length).toBe(56)
  expect(model.endsWith('opus high')).toBe(true)
})

test('zero counters are hidden and empty blocks are omitted', async () => {
  const quiet = { ...initialState(), receipt: { turnId: 't', startedMs: NOW - 5000, endedMs: NOW, agents: 0, edits: 0, errors: 0, costStart: 0, cost: null } }
  const text = rows56({ panel: quiet, replica: null, rdd: null }).join('\n')
  for (const w of ['alerts', 'agents', 'edits', 'errors', 'gate', 'context', 'session', 'review', 'inline', 'denied', 'compactions']) expect(text).not.toContain(w)
  expect(text).toContain('turn')
  expect(text).toContain('0:05')
})

test('a long feature name wraps instead of ending in an ellipsis at 56 columns', async () => {
  const feature = 'a-very-long-feature-name-that-cannot-fit-on-a-single-row-of-the-panel'
  const rows = rows56({ odd: { feature, open: 1, task: { id: 'T12', title: 'A task title that is also quite long and has to wrap around' } } })
  const odds = rows.slice(rows.indexOf('ODD'), rows.findIndex((r) => r.trim().startsWith('open')))
  expect(odds.join('')).not.toContain('…')
  expect(odds.map((r) => r.trim()).join('')).toContain(feature)
  expect(odds.map((r) => r.trim()).join(' ')).toContain('around')
  for (const r of rows) expect(r.length).toBeLessThanOrEqual(56)
  expect(find(buildPanel(args({ columns: 56, odd: { feature, open: 1, task: { id: 'T12', title: 'x' } } })), 'T12')?.props.bold).toBe(true)
})

test('rdd mode and state are rows of the review block', async () => {
  const rows = rows56()
  const i = rows.findIndex((r) => r.trim() === 'review')
  expect(rows[i + 1].trim()).toMatch(/^rdd\s+on$/)
  expect(rows[i + 2].trim()).toMatch(/^state\s+review due$/)
  expect(rows[i + 3].trim()).toBe('')
})

test('reset time and effort are never cut at 56 columns', async () => {
  const resetsAt = new Date(NOW + 3 * 3600_000 + 5 * 60_000).toISOString()
  const u = { ...usage, rateLimits: [{ kind: 'five_hour', percentUsed: 40, resetsAt }, { kind: 'seven_day', percentUsed: 85, resetsAt }] }
  const text = rows56({ replica: { ...replica, usage: u }, panel: { ...full(), inline: { count: 0, last: null } } }).join('\n')
  expect(text).not.toContain('…')
  expect(text).toContain('↻')
})

test('rows drops whole trailing blocks instead of cutting one', async () => {
  const all = rows56()
  const idx = all.findIndex((r) => r.trim() === 'review')
  const rows = rows56({ rows: idx + 1 })
  // 'review' needs 3 rows, so it does not fit; the block before it is complete
  expect(rows.some((r) => r.trim() === 'review')).toBe(false)
  expect(rows.length).toBeLessThanOrEqual(idx + 1)
  expect(rows[rows.length - 1].trim()).not.toBe('')
  expect(rows.some((r) => r.trim() === 'session')).toBe(true)
})
