import { expect, test } from 'claude-code/testing'
import { PANEL_COLUMNS, buildPanel } from '../hooks/panel/layout.js'
import { initialState } from '../hooks/panel/state.js'
import { stackBar } from '../hooks/panel/draw.js'
import { buildBand } from '../hooks/status/format.js'
import { activeFeature, activeWork } from '../hooks/status/tasks.js'

const NOW = 1_000_000

// ---- helpers -------------------------------------------------------------

const flat = (node): string =>
  typeof node === 'string' ? node : node?.type === 'Client' ? `[${node.props.module}]` : (node?.children ?? []).map(flat).join('')

// Every Text leaf, nested Texts included.
function leaves(node, out: { text: string; props: any }[] = []) {
  if (typeof node === 'string' || node == null) return out
  if (node.type === 'Text' && !(node.children ?? []).some((k) => k?.type === 'Text')) out.push({ text: flat(node), props: node.props ?? {} })
  for (const k of node.children ?? []) leaves(k, out)
  return out
}
const textOf = (tree) => lines(tree).join('\n')
const find = (tree, needle: string) => leaves(tree).find((l) => l.text.includes(needle))

// A line is a Text, a Client, or a Box whose children are all Texts and Clients; a title row joins with a space.
function lines(node, out: string[] = []) {
  if (!node || typeof node === 'string') return out
  const kids = node.children ?? []
  if (node.type === 'Text' || node.type === 'Client') {
    out.push(flat(node))
    return out
  }
  if (node.type === 'Box' && node.props?.flexDirection !== 'column' && kids.length > 0 && kids.every((k) => typeof k !== 'string' && (k.type === 'Text' || k.type === 'Client'))) {
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
const at = (h, m, s) => Date.UTC(2026, 9, 20, h, m, s)

const full = () => ({
  ...initialState(),
  agents: [agent(), agent({ id: 'a2', role: 'odd_explorer', status: 'done', endedMs: NOW - 15_000, startedMs: NOW - 30_000 })],
  inline: { count: 3, last: '/home/me/proj/plugins/construct/hooks/register.js' },
  gate: { ...initialState().gate, verdicts, buckets, denied: 2, lastDenied: { tool: 'Bash', detail: 'curl -H token=*** x' } },
  receipt: { turnId: 't', startedMs: NOW - 17_000, endedMs: NOW - 1000, agents: 0, edits: 1, errors: 0, costStart: 1, cost: 0.44 },
  compactions: 2,
  main: { steps: 7, model: 'claude-opus-5-5', effort: 'medium', mode: 'auto' },
  log: [
    { atMs: at(14, 1, 44), who: 'odd_explorer', what: 'spawned' },
    { atMs: at(14, 2, 9), who: 'gate', what: 'denied Bash curl x' },
  ],
})

const args = (o: any = {}) => ({ panel: full(), usage, odd, rdd, nowMs: NOW, columns: 66, rows: 60, tzOffsetMin: 0, ...o })
const rowsOf = (o: any = {}) => lines(buildPanel(args(o)))
const idx = (rows: string[], needle: string) => rows.findIndex((r) => r.includes(needle))

// ---- header ----------------------------------------------------------------

test('PANEL_COLUMNS is 66', async () => {
  expect(PANEL_COLUMNS).toBe(66)
})

test('header names the model, idle or busy, and the ODD task, with the five-item legend', async () => {
  const rows = rowsOf()
  expect(rows[0]).toBe('CONSTRUCT · OPUS 5.5 IDLE · ODD T4')
  expect(rows[1]).toBe('■ main■ agents■ gate■ odd■ review')
  const tree = buildPanel(args())
  expect(tree.props.width).toBe(66)
  const busy = { ...full(), receipt: { ...full().receipt, endedMs: null } }
  expect(rowsOf({ panel: busy })[0]).toBe('CONSTRUCT · OPUS 5.5 BUSY · ODD T4')
  expect(rowsOf({ odd: null })[0]).toBe('CONSTRUCT · OPUS 5.5 IDLE')
})

test('the legend squares use the card colors', async () => {
  const squares = leaves(buildPanel(args())).filter((l) => l.text === '■' && Object.keys(l.props).length === 1).slice(0, 5)
  expect(squares.map((l) => l.props.color)).toEqual(['claude', 'suggestion', 'success', 'merged', 'permission'])
})

// ---- card order ------------------------------------------------------------

test('cards come in order: main, ODD, REVIEW, GATE, agents, last turn, session log', async () => {
  const rows = rowsOf()
  const at = ['Opus 5.5 · main', 'ODD · flightdeck-panel', 'REVIEW', 'GATE · permissions', 'agents · 1 running · 2 total', 'last turn', 'session log'].map((n) => idx(rows, n))
  for (const i of at) expect(i).toBeGreaterThan(1)
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

test('main card: model, status, effort meter, mode, requests, ctx gauge with tokens, cost, 5h and 7d', async () => {
  const rows = rowsOf()
  expect(rows[idx(rows, 'Opus 5.5 · main')]).toBe('Opus 5.5 · main ○ idle')
  const i = idx(rows, 'Opus 5.5 · main')
  expect(rows[i + 1]).toBe('effort ▮▮▯▯ medium   mode auto   7 req')
  expect(rows[i + 2]).toBe('ctx ▰▰▰▰▰▰▰▱▱▱ 67% 666k/1.0M  ⟲2')
  expect(rows[i + 3]).toBe('$104   5h ▱▱▱▱▱ 4%   7d ▰▱▱▱▱ 13%')
  const card = buildPanel(args()).children.find((c) => c.props?.borderStyle === 'round')
  expect(card.props.borderColor).toBe('claude')
})

test('main card shows without usage or replica, and is busy while a turn is open', async () => {
  const rows = rowsOf({ usage: null, panel: { ...initialState() }, odd: null, rdd: null, model: 'sonnet' })
  expect(rows).toContain('Sonnet · main ○ idle')
  expect(rows.some((r) => r.startsWith('ctx'))).toBe(false)
  expect(rows.some((r) => r.startsWith('effort ▯▯▯▯ —'))).toBe(true)
  const busy = { ...full(), receipt: { ...full().receipt, endedMs: null } }
  expect(rowsOf({ panel: busy }).some((r) => r === 'Opus 5.5 · main ● busy')).toBe(true)
})

test('a high ctx is flagged in the error color', async () => {
  const hot = { ...usage, context: { window: 200_000, tokens: 180_000, percent: 90 } }
  expect(find(buildPanel(args({ usage: hot })), '▰▰▰▰▰▰▰▰▰')?.props.color).toBe('error')
})

// ---- rail ------------------------------------------------------------------

test('rails between cards are Client rail.tsx when client is true and a static line otherwise', async () => {
  const withClient = rowsOf({ client: true }).filter((r) => r === '[./rail.tsx]')
  expect(withClient.length).toBe(2)
  const stat = rowsOf({ client: false })
  expect(stat.filter((r) => r === '─'.repeat(66)).length).toBe(2)
  expect(stat.some((r) => r.includes('rail.tsx'))).toBe(false)
  const tree = buildPanel(args({ client: true }))
  const rail = (tree.children as any[]).find((c) => c.type === 'Client')
  expect(rail.props.module).toBe('./rail.tsx')
  expect(rail.props.props).toMatchObject({ active: false, width: 66, color: 'claude', dim: 'subtle' })
  expect(typeof rail.props.key).toBe('string')
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

test('agents: header counts, one row per agent with mark, role, timeline bar and clock (static)', async () => {
  const rows = rowsOf()
  expect(idx(rows, 'agents · 1 running · 2 total')).toBeGreaterThan(0)
  const running = rows.find((r) => r.startsWith('◐ 1: odd_worker'))!
  const done = rows.find((r) => r.startsWith('✓ 2: odd_explorer'))!
  expect(done).toBeTruthy()
  expect(running).toMatch(/━+·*\s+1:05$/)
  expect(done).toMatch(/^✓ 2: odd_explorer\s+·*━+·*\s+0:15$/)
  expect(running.length).toBe(done.length)
  const ids = rows.filter((r) => /^[◐✓] \d:/.test(r))
  expect(ids.length).toBe(2)
})

test('agent rows use a Client elapsed for running agents only when client is true', async () => {
  const rows = rowsOf({ client: true })
  expect(rows.find((r) => r.includes('odd_worker'))).toMatch(/\[\.\/elapsed\.tsx\]$/)
  expect(rows.find((r) => r.includes('odd_explorer'))).toMatch(/0:15$/)
  const tree = buildPanel(args({ client: true }))
  const clocks: any[] = []
  const walk = (n) => { if (n?.type === 'Client' && n.props.module === './elapsed.tsx') clocks.push(n); (n?.children ?? []).forEach?.(walk) }
  walk(tree)
  expect(clocks.length).toBe(1)
  expect(clocks[0].props.props).toEqual({ since: NOW - 65_000, now: NOW, endAt: null, color: 'inactive' })
  expect(rowsOf({ client: false }).find((r) => r.includes('odd_worker'))).toMatch(/1:05$/)
})

test('agents are hidden when there are none and cap at six with +N earlier', async () => {
  expect(rowsOf({ panel: { ...full(), agents: [] } }).some((r) => r.startsWith('agents ·'))).toBe(false)
  const many = { ...full(), agents: Array.from({ length: 8 }, (_, i) => agent({ id: `x${i}`, status: 'done', startedMs: NOW - 80_000 + i * 1000, endedMs: NOW - 40_000 + i * 1000 })) }
  const rows = rowsOf({ panel: many })
  expect(rows.filter((r) => /^✓ \d:/.test(r)).length).toBe(6)
  expect(rows).toContain('+2 earlier')
})

// ---- last turn ---------------------------------------------------------------

test('last turn card: duration, agents, edits, errors, cost added', async () => {
  const rows = rowsOf()
  expect(rows).toContain('✓ last turn 16s · 0 agents · 1 edit · 0 errors · +$0.44')
  expect(rowsOf({ panel: { ...full(), receipt: null } }).some((r) => r.includes('last turn'))).toBe(false)
  const turnBox = (tree) => (tree.children as any[]).find((c) => c.props?.borderColor === 'claude' && flat(c).includes('turn'))
  expect(turnBox(buildPanel(args())).props.borderDimColor).toBe(true)
  expect(turnBox(buildPanel(args({ panel: { ...full(), receipt: { ...full().receipt, endedMs: null } } }))).props.borderDimColor).toBeUndefined()
  const busy = { ...full(), receipt: { ...full().receipt, endedMs: null, startedMs: NOW - 90_000, cost: null, errors: 1 } }
  expect(rowsOf({ panel: busy })).toContain('◐ turn 1:30 · 0 agents · 1 edit · 1 error')
  expect(rowsOf({ panel: busy, client: true })).toContain('◐ turn [./elapsed.tsx] · 0 agents · 1 edit · 1 error')
  const nocost = { ...full(), receipt: { ...full().receipt, cost: null } }
  expect(rowsOf({ panel: nocost })).toContain('✓ last turn 16s · 0 agents · 1 edit · 0 errors')
})

// ---- session log ---------------------------------------------------------------

test('session log rows show HH:MM:SS (UTC plus the offset), who and what', async () => {
  const rows = rowsOf()
  const i = idx(rows, 'session log')
  expect(rows[i]).toBe('session log')
  expect(rows[i + 1]).toBe('14:01:44 odd_explorer  spawned')
  expect(rows[i + 2]).toBe('14:02:09 gate          denied Bash curl x')
  expect(rowsOf({ tzOffsetMin: -300 })[i + 1]).toBe('09:01:44 odd_explorer  spawned')
  const tree = buildPanel(args())
  expect(leaves(tree).find((l) => l.text === 'odd_explorer  ')?.props).toMatchObject({ color: 'suggestion', bold: true })
  expect(leaves(tree).find((l) => l.text === 'gate          ')?.props.color).toBe('success')
  const box = (tree.children as any[]).at(-1)
  expect(box.props).toMatchObject({ borderStyle: 'round', borderColor: 'subtle' })
})

test('session log is empty-safe, colors odd and review rows, and its rows clamp to the space left', async () => {
  const empty = rowsOf({ panel: { ...full(), log: [] } })
  expect(empty.at(-1)).toBe('nothing yet')
  const log = Array.from({ length: 30 }, (_, i) => ({ atMs: at(10, 0, i), who: i % 2 ? 'odd' : 'review', what: `row ${i}` }))
  const panel = { ...full(), log }
  const count = (rows: number | undefined) => rowsOf({ panel, rows }).filter((r) => /^10:00:\d\d /.test(r)).length
  expect(count(200)).toBe(8)
  expect(count(10)).toBe(4)
  expect(count(undefined)).toBe(8)
  expect(rowsOf({ panel, rows: 200 }).filter((r) => /^10:00:\d\d /.test(r)).at(-1)).toContain('row 29')
  const tree = buildPanel(args({ panel, rdd: null }))
  expect(find(tree, 'odd ')?.props.color).toBe('merged')
  expect(find(tree, 'review ')?.props.color).toBe('permission')
})

test('a narrow pane keeps one column at 40 columns and long text does not widen a card', async () => {
  const long = { ...odd, feature: 'a-very-long-feature-name-that-cannot-fit-on-a-single-row-of-the-panel', task: { id: 'T12', title: 'x'.repeat(100) } }
  const tree = buildPanel(args({ columns: 40, odd: long }))
  for (const c of tree.children as any[]) if (c.props?.borderStyle) expect(c.props.width).toBe(40)
  // the engine clips the truncating rows; the rest are sized here, so they never pass the inner width
  const rows = rowsOf({ columns: 40, odd: long })
  expect(rows.filter((r) => r.startsWith('T12') || r.startsWith('ODD ·') || /^\d\d:\d\d:\d\d /.test(r)).filter((r) => r.length > 40)).toEqual([])
  expect(rows.find((r) => r.startsWith('T12'))!.length).toBe(36)
})

// ---- band stays as it was ------------------------------------------------

test('buildBand output is unchanged by the helper exports', async () => {
  const tree = buildBand({ replica: null, odd: { feature: 'f', open: 1 }, rdd: { mode: 'off' }, nowMs: NOW })
  expect(flat(tree)).toBe('▌ ODD f · 1 open▌ RDD off')
})

// ---- tasks ---------------------------------------------------------------

const DOC = (rows: string[]) =>
  ['# f', '', '## Tasks', '', '| ID | Specs | Task | Status |', '|---|---|---|---|', ...rows, '', '## Log'].join('\n')

test('activeWork adds the first unfinished task id and title; activeFeature is unchanged', async () => {
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

