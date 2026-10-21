import { expect, test } from 'claude-code/testing'
import { PANEL_COLUMNS, buildPanel } from '../hooks/panel/layout.js'
import { initialState } from '../hooks/panel/state.js'
import { stackBar } from '../hooks/panel/draw.js'
import { activeWork } from '../hooks/status/tasks.js'

const NOW = 1_000_000

// ---- helpers -------------------------------------------------------------

const flat = (node): string =>
  typeof node === 'string' ? node : (node?.children ?? []).map(flat).join('')

// Every Text leaf, nested Texts included.
function leaves(node, out: { text: string; props: any }[] = []) {
  if (typeof node === 'string' || node == null) return out
  if (node.type === 'Text' && !(node.children ?? []).some((k) => k?.type === 'Text')) out.push({ text: flat(node), props: node.props ?? {} })
  for (const k of node.children ?? []) leaves(k, out)
  return out
}
const textOf = (tree) => lines(tree).join('\n')
const find = (tree, needle: string) => leaves(tree).find((l) => l.text.includes(needle))

// A line is a Text, or a Box whose children are all Texts; a title row joins with a space.
function lines(node, out: string[] = []) {
  if (!node || typeof node === 'string') return out
  const kids = node.children ?? []
  if (node.type === 'Text') {
    out.push(flat(node))
    return out
  }
  if (node.type === 'Box' && node.props?.flexDirection !== 'column' && kids.length > 0 && kids.every((k) => typeof k !== 'string' && k.type === 'Text')) {
    out.push(kids.map(flat).join(node.props?.justifyContent === 'space-between' ? ' ' : ''))
    return out
  }
  for (const k of kids) lines(k, out)
  return out
}

const agent = (o: any = {}) => ({
  id: 'a1', role: 'odd_worker', type: 'construct:odd-worker', description: '', model: 'sonnet', effort: 'high',
  ctx: 42000, steps: 7, startedMs: NOW - 65_000, endedMs: null, status: 'running', ...o,
})

const usage = {
  context: { window: 1_000_000, tokens: 666_000, percent: 67 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 4, resetsAt: null },
    { kind: 'seven_day', percentUsed: 13, resetsAt: null },
  ],
  cost: { usd: 104.2 },
}
const odd = {
  feature: 'flightdeck-panel', open: 3, task: { id: 'T4', title: 'Card layout' },
  tasks: [{ id: 'T1', done: true }, { id: 'T2', done: true }, { id: 'T3', done: true }, { id: 'T4', done: false }, { id: 'T5', done: false }],
}
const rdd = { mode: 'on', state: 'review due' }
const verdicts = { rule: 4, ask: 0, cleared: 16, deny: 2 }
const buckets = {
  file: { rule: 2, ask: 0, cleared: 1, deny: 1 },
  shell: { rule: 1, ask: 0, cleared: 4, deny: 0 },
  other: { rule: 1, ask: 0, cleared: 11, deny: 1 },
}
const full = () => ({
  ...initialState(),
  agents: [agent(), agent({ id: 'a2', role: 'odd_explorer', status: 'done', endedMs: NOW - 15_000, startedMs: NOW - 30_000 })],
  inline: { count: 3, last: '/home/me/proj/plugins/construct/hooks/register.js' },
  gate: { ...initialState().gate, verdicts, buckets, denied: 2, lastDenied: { tool: 'Bash', detail: 'curl -H token=*** x' } },
  // a receipt left in a stored panel by an older version: the panel ignores it
  receipt: { turnId: 't', startedMs: NOW - 17_000, endedMs: NOW - 1000, agents: 0, edits: 1, errors: 0 },
  compactions: 2,
  main: { steps: 7, model: 'claude-opus-5-5', effort: 'medium', mode: 'auto' },
})

const git = { branch: 'feat/x', dirty: 5, ahead: 2, behind: 1 }
const changes = [
  { path: 'plugins/construct/hooks/panel/layout.js', added: 120, removed: 80 },
  { path: 'README.md', added: 8, removed: 12 },
  { path: 'plugins/construct/hooks/register.js', added: 30, removed: 5 },
  { path: 'assets/logo.png', added: null, removed: null, binary: true },
  { path: 'notes/new-file.md', added: 14, removed: 0, untracked: true },
]

const args = (o: any = {}) => ({ panel: full(), usage, odd, rdd, nowMs: NOW, columns: 66, rows: 60, git, changes, ...o })
const rowsOf = (o: any = {}) => lines(buildPanel(args(o)))
const idx = (rows: string[], needle: string) => rows.findIndex((r) => r.includes(needle))
const lastIdx = (rows: string[], needle: string) => rows.findLastIndex((r) => r.includes(needle))
// the changes card title row: the branch name alone or with ↑N ↓N, never the main card's `⎇ ` row
const isTitle = (r: string) => /^feat\/x( [↑↓]\d+)*$/.test(r)

// ---- header ----------------------------------------------------------------

test('PANEL_COLUMNS is 66', async () => {
  expect(PANEL_COLUMNS).toBe(66)
})

test('no header and no legend: the panel starts with the main card', async () => {
  const rows = rowsOf()
  expect(rows[0]).toBe('Opus 5.5 ○ idle')
  expect(rows.some((r) => r.startsWith('CONSTRUCT'))).toBe(false)
  expect(rows.some((r) => r.includes('■ main'))).toBe(false)
  const tree = buildPanel(args())
  expect(tree.props.width).toBe(66)
  expect(tree.children[0].props.borderStyle).toBe('round')
})

// ---- card order ------------------------------------------------------------

test('cards come in order: main, ODD, REVIEW, GATE, agents, changes', async () => {
  const rows = rowsOf()
  const at = ['Opus 5.5', 'ODD · flightdeck-panel', 'REVIEW', 'GATE · permissions', 'agents 1 running · 2 total', 'feat/x ↑2'].map((n) => idx(rows, n))
  for (const i of at) expect(i).toBeGreaterThanOrEqual(0)
  expect([...at].sort((a, b) => a - b)).toEqual(at)
})

test('one column: the root is a column Box and nothing splits at 140 columns', async () => {
  for (const columns of [40, 66, 140]) {
    const tree = buildPanel(args({ columns }))
    expect(tree.props.flexDirection).toBe('column')
    expect(tree.props.width).toBe(Math.max(40, columns))
  }
})

// ---- main card ---------------------------------------------------------------

test('main card: model, status, effort meter, mode, requests, ctx gauge with tokens, 5h and 7d, no session cost', async () => {
  const rows = rowsOf()
  expect(rows[idx(rows, 'Opus 5.5')]).toBe('Opus 5.5 ○ idle')
  const i = idx(rows, 'Opus 5.5')
  expect(rows[i + 1]).toBe('⎇ feat/x')
  expect(rows[i + 2]).toBe('effort ▮▮▯▯ medium   mode auto   7 req')
  expect(rows[i + 3]).toBe('ctx ▰▰▰▰▰▰▰▱▱▱ 67% 666k/1.0M  ⟲2')
  expect(rows[i + 4]).toBe('5h ▱▱▱▱▱ 4%   7d ▰▱▱▱▱ 13%')
  expect(rows.some((r) => r.includes('$'))).toBe(false)
  const card = buildPanel(args()).children.find((c) => c.props?.borderStyle === 'round')
  expect(card.props.borderColor).toBe('claude')
})

test('main card branch row: first body row, clipped, control-stripped, hidden without a branch', async () => {
  const at = (o) => { const r = rowsOf(o); return r[idx(r, ' idle') + 1] }
  expect(at({})).toBe('⎇ feat/x')
  expect(rowsOf().some((r) => r.includes('· main'))).toBe(false)
  expect(at({ git: { ...git, branch: 'a\u001b[31mb' } })).toBe('⎇ a[31mb')
  const long = at({ git: { ...git, branch: 'x'.repeat(100) }, columns: 40 })
  expect(long.length).toBe(36)
  expect(long.endsWith('…')).toBe(true)
  for (const g of [null, { ...git, branch: '' }, { ...git, branch: undefined }]) expect(at({ git: g }).startsWith('⎇')).toBe(false)
})

test('main card shows without usage or replica, and is busy while a turn is open', async () => {
  const rows = rowsOf({ usage: null, panel: { ...initialState() }, odd: null, rdd: null, model: 'sonnet' })
  expect(rows).toContain('Sonnet ○ idle')
  expect(rows.some((r) => r.startsWith('ctx'))).toBe(false)
  expect(rows.some((r) => r.startsWith('effort ▯▯▯▯ —'))).toBe(true)
  const busy = { ...full(), turn: { turnId: 't' } }
  expect(rowsOf({ panel: busy }).some((r) => r === 'Opus 5.5 ● implementing')).toBe(true)
  expect(rowsOf({ panel: { ...busy, agents: [] } }).some((r) => r === 'Opus 5.5 ● busy')).toBe(true)
  expect(rowsOf({ panel: { ...busy, agents: [agent({ status: 'done', endedMs: NOW })] } })[0]).toBe('Opus 5.5 ● busy')
})

test('a high ctx is flagged in the error color', async () => {
  const hot = { ...usage, context: { window: 200_000, tokens: 180_000, percent: 90 } }
  expect(find(buildPanel(args({ usage: hot })), '▰▰▰▰▰▰▰▰▰')?.props.color).toBe('error')
})

// ---- ODD card ----------------------------------------------------------------

test('ODD card is hidden without a feature', async () => {
  expect(rowsOf({ odd: null }).some((r) => r.startsWith('ODD ·'))).toBe(false)
})

test('ODD card shows the feature, open count, current task and one checkpoint per task', async () => {
  const rows = rowsOf()
  const i = idx(rows, 'ODD · flightdeck-panel')
  expect(rows[i]).toBe('ODD · flightdeck-panel 3 open')
  expect(rows[i + 1]).toBe('T4  Card layout')
  expect(rows[i + 2]).toBe('●━●━●━◆━○')
  expect(leaves(buildPanel(args())).find((l) => l.text === 'T4')?.props.bold).toBe(true)
  expect(find(buildPanel(args()), '◆')?.props.bold).toBe(true)
  // without per-task rows only the title row and the task show
  const bare = rowsOf({ odd: { feature: 'x', open: 1 } })
  expect(bare[idx(bare, 'ODD · x')]).toBe('ODD · x 1 open')
})

// ---- REVIEW ------------------------------------------------------------------

test('REVIEW card shows the RDD state and is hidden when off or empty', async () => {
  const rows = rowsOf()
  expect(rows[idx(rows, 'REVIEW')]).toBe('REVIEW · rdd on review due')
  expect(find(buildPanel(args()), 'review due')?.props.color).toBe('error')
  for (const r of [null, { mode: 'off' }, undefined]) expect(rowsOf({ rdd: r }).some((x) => x.startsWith('REVIEW'))).toBe(false)
  expect(rowsOf({ rdd: { mode: 'on', state: 'clear' } }).find((x) => x.startsWith('REVIEW'))).toBe('REVIEW · rdd on clear')
})

// ---- GATE --------------------------------------------------------------------

test('GATE card: stacked bar, verdict legend by decider, buckets, masked last denied, inline alert', async () => {
  const rows = rowsOf()
  const i = idx(rows, 'GATE · permissions')
  expect(rows[i]).toBe('GATE · permissions 22 checks')
  expect(rows[i + 1]).toMatch(/^█+$/)
  expect(rows[i + 1].length).toBe(62)
  expect(rows[i + 2]).toBe('■ 4 allowed  ■ 16 classifier  ✗ 2 denied')
  expect(rows[i + 3]).toBe('f: file 4  s: shell 5  o: other 13')
  expect(rows[i + 4]).toBe('✗ Bash: curl -H token=*** x')
  expect(rows[i + 5]).toBe('⚠ 3 inline writes · …/hooks/register.js')
  const tree = buildPanel(args())
  expect(find(tree, 'Bash: curl')?.props.color).toBe('error')
  expect(find(tree, '3 inline writes')?.props.color).toBe('error')
  const cols = leaves(tree).filter((l) => /^█+$/.test(l.text)).map((l) => [l.props.color, l.text.length])
  expect(cols).toEqual([['success', 12], ['permission', 44], ['error', 6]])
})

test('GATE says "you" when the mode is not auto, pending asks show, and the card hides when empty', async () => {
  const asked = { ...full(), main: { ...full().main, mode: 'default' }, gate: { ...full().gate, verdicts: { rule: 1, ask: 2, cleared: 3, deny: 0 }, denied: 0, lastDenied: null } }
  const rows = rowsOf({ panel: asked })
  const i = idx(rows, 'GATE · permissions')
  expect(rows[i + 2]).toBe('■ 1 allowed  ■ 3 you  ■ 2 pending  ✗ 0 denied')
  expect(rows.some((r) => r.startsWith('✗ Bash'))).toBe(false)
  const none = { ...initialState() }
  expect(rowsOf({ panel: none }).some((r) => r.startsWith('GATE'))).toBe(false)
  const inlineOnly = { ...initialState(), inline: { count: 1, last: '/a/b/c.js' } }
  const r2 = rowsOf({ panel: inlineOnly })
  expect(r2[idx(r2, 'GATE')]).toBe('GATE · permissions 0 checks')
  expect(r2).toContain('⚠ 1 inline write · …/b/c.js')
})

test('stackBar sums to the width and keeps one cell per non-zero count', async () => {
  expect(stackBar([4, 16, 0, 2], 20)).toEqual([4, 13, 0, 3])
  expect(stackBar([0, 0], 10)).toEqual([0, 0])
  expect(stackBar([1, 1, 1], 2).reduce((a, b) => a + b, 0)).toBe(2)
  for (const w of [5, 33, 62]) expect(stackBar([3, 9, 1, 40], w).reduce((a, b) => a + b, 0)).toBe(w)
})

// ---- agents ------------------------------------------------------------------

test('agents are hidden when there are none and cap at six with +N earlier', async () => {
  expect(rowsOf({ panel: { ...full(), agents: [] } }).some((r) => r.startsWith('agents'))).toBe(false)
  const many = { ...full(), agents: Array.from({ length: 8 }, (_, i) => agent({ id: `x${i}`, status: 'done', startedMs: NOW - 80_000 + i * 1000, endedMs: NOW - 40_000 + i * 1000 })) }
  const rows = rowsOf({ panel: many })
  expect(rows.filter((r) => /^✓ worker/.test(r)).length).toBe(6)
  expect(rows).toContain('+2 earlier')
})

// ---- agents card (S1), no last turn (S2), no Client (S3) -----------------------

test('agents card: bordered, titled agents, short names, routed model with effort meter, static elapsed', async () => {
  const panel = { ...full(), agents: [agent({ model: 'claude-sonnet-5-5' }), agent({ id: 'a2', role: 'odd_explorer', model: 'claude-haiku-4-5', effort: 'low', status: 'done', endedMs: NOW - 15_000, startedMs: NOW - 30_000 })] }
  const tree = buildPanel(args({ panel }))
  const box = (tree.children as any[]).find((c) => c.props?.borderStyle === 'round' && flat(c).startsWith('agents'))
  expect(box).toBeTruthy()
  expect(box.props.width).toBe(66)
  const rows = rowsOf({ panel })
  const squash = (r: string) => r.replace(/\s+/g, ' ')
  expect(rows).toContain('agents 1 running · 2 total')
  expect(rows.some((r) => r.includes('odd_worker') || r.includes('odd-worker'))).toBe(false)
  expect(rows.map(squash)).toContain('◐ worker Sonnet 5.5 ▮▮▮▯ 1:05')
  expect(rows.map(squash)).toContain('✓ explorer Haiku 4.5 ▮▯▯▯ 0:15')
})

test('agents card shows the subagent type for an agent with no construct role, and dashes the role', async () => {
  const panel = { ...full(), agents: [agent({ id: 'g', role: 'Explore', type: 'Explore', model: null, effort: null }), agent({ id: 'r', role: 'review_risk', type: 'construct:review-risk' })] }
  const rows = rowsOf({ panel })
  expect(rows.some((r) => /^◐ Explore\s+— /.test(r))).toBe(true)
  expect(rows.some((r) => r.startsWith('◐ review-risk'))).toBe(true)
})

test('no last turn row even when a receipt is stored in the panel', async () => {
  const rows = rowsOf()
  expect(rows.some((r) => r.includes('last turn') || r.includes('turn '))).toBe(false)
  expect(rows.some((r) => r.includes('◐ turn'))).toBe(false)
})

test('client: true draws no Client element and no rail; every section is a card of the same width', async () => {
  const tree = buildPanel(args({ client: true }))
  const walk = (n): boolean => n?.type === 'Client' || (n?.children ?? []).some?.(walk)
  expect(walk(tree)).toBe(false)
  const kids = tree.children as any[]
  expect(kids.every((c) => c.props?.borderStyle === 'round' && c.props.width === 66)).toBe(true)
  expect(rowsOf({ client: true }).some((r) => /^─+$/.test(r))).toBe(false)
})

// ---- changes card (S9) -----------------------------------------------------------

test('changes card: branch title, ↑N ↓N on the right, rows sorted by changed lines with +added -removed', async () => {
  const rows = rowsOf()
  const i = lastIdx(rows, 'feat/x')
  expect(rows[i]).toBe('feat/x ↑2 ↓1')
  const body = rows.slice(i + 1, i + 6)
  expect(body.map((r) => r.replace(/\s+/g, ' '))).toEqual([
    'plugins/construct/hooks/panel/layout.js +120 -80',
    'plugins/construct/hooks/register.js +30 -5',
    'README.md +8 -12',
    'notes/new-file.md +14',
    'assets/logo.png bin',
  ])
  for (const r of body) expect(r.length).toBe(62)
  expect(rows.some((r) => r.includes('session log'))).toBe(false)
})

test('changes card colors: branch git color, + success, - error; round card', async () => {
  const tree = buildPanel(args())
  expect(leaves(tree).findLast((l) => l.text.includes('feat/x'))?.props).toMatchObject({ bold: true, color: 'remember' })
  expect(leaves(tree).find((l) => l.text === '+120')?.props.color).toBe('success')
  expect(leaves(tree).find((l) => l.text === '-80')?.props.color).toBe('error')
  expect(leaves(tree).find((l) => l.text === 'bin')?.props.dimColor ?? leaves(tree).find((l) => l.text === 'bin')?.props.dim).toBeTruthy()
})

test('changes card status shows only the nonzero side and nothing when in sync', async () => {
  expect(rowsOf({ git: { ...git, ahead: 3, behind: 0 } }).some((r) => r === 'feat/x ↑3')).toBe(true)
  expect(rowsOf({ git: { ...git, ahead: 0, behind: 4 } }).some((r) => r === 'feat/x ↓4')).toBe(true)
  expect(rowsOf({ git: { ...git, ahead: 0, behind: 0 } }).some((r) => r === 'feat/x')).toBe(true)
})

test('untracked files count as added, or show new when the count is unknown', async () => {
  const rows = rowsOf({ changes: [{ path: 'a.txt', added: 3, removed: 0, untracked: true }, { path: 'dir/', added: null, removed: null, untracked: true }] })
  expect(rows.some((r) => /^a\.txt\s+\+3$/.test(r))).toBe(true)
  expect(rows.some((r) => /^dir\/\s+new$/.test(r))).toBe(true)
})

test('a long path is shortened and keeps its basename; control characters are dropped', async () => {
  const long = 'a/very/deep/directory/tree/that/goes/on/and/on/forever/and/ever/amen/final-name.ts'
  const rows = rowsOf({ changes: [{ path: long, added: 1, removed: 1 }, { path: 'x\u001b[31m/ev\nil.ts', added: 2, removed: 0 }] })
  const r = rows.find((x) => x.includes('final-name.ts'))!
  expect(r.startsWith('…/')).toBe(true)
  expect(r.length).toBe(62)
  expect(rows.some((x) => /[\u0000-\u001f]/.test(x))).toBe(false)
  expect(rows.some((x) => x.includes('evil.ts'))).toBe(true)
})

test('rows that do not fit end with +N more', async () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ path: `src/f${i}.ts`, added: 30 - i, removed: 0 }))
  const rows = rowsOf({ changes: many, rows: 200 })
  const i = lastIdx(rows, 'feat/x')
  expect(rows.slice(i + 1).filter((r) => r.startsWith('src/')).length).toBe(9)
  expect(rows.at(-1)).toBe('+21 more')
  expect(rows[i + 1].startsWith('src/f0.ts')).toBe(true)
})

test('the changes card is hidden when clean and in sync, and shown when only ahead or behind', async () => {
  const clean = { branch: 'main', dirty: 0, ahead: 0, behind: 0 }
  expect(rowsOf({ git: clean, changes: [] }).some((r) => r === 'main')).toBe(false)
  expect(rowsOf({ git: { ...clean, ahead: 1 }, changes: [] }).some((r) => r === 'main ↑1')).toBe(true)
  expect(rowsOf({ git: null, changes: undefined }).some((r) => r.includes('feat/x'))).toBe(false)
})

test('a narrow pane keeps one column at 40 columns and long text does not widen a card', async () => {
  const long = { ...odd, feature: 'a-very-long-feature-name-that-cannot-fit-on-a-single-row-of-the-panel', task: { id: 'T12', title: 'x'.repeat(100) } }
  const tree = buildPanel(args({ columns: 40, odd: long }))
  for (const c of tree.children as any[]) if (c.props?.borderStyle) expect(c.props.width).toBe(40)
  // the engine clips the truncating rows; the rest are sized here, so they never pass the inner width
  const rows = rowsOf({ columns: 40, odd: long })
  expect(rows.filter((r) => r.startsWith('T12') || r.startsWith('ODD ·') ).filter((r) => r.length > 40)).toEqual([])
  expect(rows.find((r) => r.startsWith('T12'))!.length).toBe(36)
})

// ---- tasks ---------------------------------------------------------------

const DOC = (rows: string[]) =>
  ['# f', '', '## Tasks', '', '| ID | Specs | Task | Status |', '|---|---|---|---|', ...rows, '', '## Log'].join('\n')

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


test('5h and 7d gauges show the time to reset from an ISO resetsAt', async () => {
  const iso = (min: number) => new Date(NOW + min * 60_000).toISOString()
  const withReset = {
    ...usage,
    rateLimits: [
      { kind: 'five_hour', percentUsed: 4, resetsAt: iso(190) },
      { kind: 'seven_day', percentUsed: 13, resetsAt: iso(4 * 1440 + 125) },
    ],
  }
  const rows = rowsOf({ usage: withReset })
  expect(rows[idx(rows, '5h')]).toBe('5h ▱▱▱▱▱ 4% ↻3h10m   7d ▰▱▱▱▱ 13% ↻4d2h')
  // a past, missing or unparsable reset leaves the gauge as it was
  const none = { ...usage, rateLimits: [{ kind: 'five_hour', percentUsed: 4, resetsAt: 'soon' }, { kind: 'seven_day', percentUsed: 13, resetsAt: iso(-5) }] }
  const rows2 = rowsOf({ usage: none })
  expect(rows2[idx(rows2, '5h')]).toBe('5h ▱▱▱▱▱ 4%   7d ▰▱▱▱▱ 13%')
})

// ---- review fixes ---------------------------------------------------------------

// Rows a tree takes: a Text one, a column Box its children plus border.
function rowsHigh(node): number {
  if (!node || typeof node === 'string') return 0
  if (node.type !== 'Box' || node.props?.flexDirection !== 'column') return 1
  return (node.props.borderStyle ? 2 : 0) + (node.children ?? []).reduce((n, k) => n + rowsHigh(k), 0)
}

test('the panel never takes more rows than the pane has: the changes rows shrink, then the card goes', async () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ path: `src/f${i}.ts`, added: 30 - i, removed: 0 }))
  const lean = { odd: null, rdd: null, panel: initialState(), changes: many }
  for (const rows of [8, 9, 10, 11, 12, 13, 14, 20, 24, 26, 30, 60]) {
    expect(rowsHigh(buildPanel(args({ ...lean, rows })))).toBeLessThanOrEqual(rows)
  }
  const shown = (rows: number) => rowsOf({ ...lean, rows }).filter((r) => r.startsWith('src/')).length
  expect(shown(26)).toBeGreaterThan(0)
  expect(rowsOf({ ...lean, rows: 8 }).some(isTitle)).toBe(false)
  // only the frame fits: the title (branch, ↑↓) stays, the rows go
  expect(rowsOf({ ...lean, rows: 10 }).some(isTitle)).toBe(true)
  expect(shown(10)).toBe(0)
  expect(rowsOf({ ...lean, rows: 11 }).at(-1)).toBe('+30 more')
  expect(rowsOf({ ...lean, rows: 26 }).at(-1)).toMatch(/^\+\d+ more$/)
  // a full panel on a short pane: the changes go, the other cards stay
  for (const rows of [20, 24]) {
    const tree = buildPanel(args({ rows }))
    expect(rowsOf({ rows }).some(isTitle)).toBe(false)
    expect(textOf(tree).includes('agents')).toBe(true)
  }
})

test('GATE masks the inline write path', async () => {
  const panel = { ...full(), inline: { count: 1, last: '/home/me/proj/token=abcdef123456/register.js' } }
  const text = textOf(buildPanel(args({ panel })))
  expect(text).not.toContain('abcdef123456')
})

test('agent rows at 40 columns are truncating Text rows inside a card of the card width', async () => {
  const tree = buildPanel(args({ columns: 40 }))
  const box = (tree.children as any[]).find((c) => c.props?.borderStyle === 'round' && flat(c).startsWith('agents'))
  expect(box.props.width).toBe(40)
  const rows = box.children.slice(1)
  expect(rows.length).toBe(2)
  for (const r of rows) expect(r.props.wrap).toBe('truncate')
})

// ---- S8b blocked indicator ----------------------------------------------------

test('blocked: the main card status reads blocked in place of busy or idle, with no extra row', async () => {
  const plain = rowsOf({ panel: { ...full(), blocked: false } })
  const rows = rowsOf({ panel: { ...full(), blocked: true } })
  expect(rows[0]).toBe('Opus 5.5 ◆ blocked')
  expect(rows.length).toBe(plain.length)
  expect(rows.filter((r) => r.includes('blocked')).length).toBe(1)
  const status = find(buildPanel(args({ panel: { ...full(), blocked: true } })), '◆ blocked')
  expect(status.props.color).toBe('warning')
})

test('not blocked: the status is unchanged', async () => {
  expect(rowsOf({ panel: { ...full(), blocked: false } })[0]).toBe(rowsOf()[0])
  expect(rowsOf()[0]).not.toContain('blocked')
})

test('phase: the busy status names the running agents phase, and blocked wins', async () => {
  const verifying = { ...full(), turn: { turnId: 't' }, agents: [agent(), agent({ id: 'v', role: 'odd_verify' })] }
  expect(rowsOf({ panel: verifying })[0]).toBe('Opus 5.5 ● verifying')
  expect(rowsOf({ panel: { ...verifying, blocked: true } })[0]).toBe('Opus 5.5 ◆ blocked')
  expect(rowsOf({ panel: { ...full(), blocked: false } })[0]).toBe('Opus 5.5 ○ idle')
})
