import { expect, test } from 'claude-code/testing'
import { PANEL_COLUMNS, buildPanel, prettyModel } from '../hooks/panel/layout.js'
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
  id: 'a1', role: 'worker', type: 'construct:worker', description: '', model: 'sonnet', effort: 'high',
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
  feature: 'card-panel', open: 3, task: { id: 'T4', title: 'Card layout' },
  tasks: [{ id: 'T1', done: true }, { id: 'T2', done: true }, { id: 'T3', done: true }, { id: 'T4', done: false }, { id: 'T5', done: false }],
}
const verdicts = { rule: 4, ask: 0, cleared: 16, deny: 2 }
const buckets = {
  file: { rule: 2, ask: 0, cleared: 1, deny: 1 },
  shell: { rule: 1, ask: 0, cleared: 4, deny: 0 },
  other: { rule: 1, ask: 0, cleared: 11, deny: 1 },
}
const full = () => ({
  ...initialState(),
  agents: [agent(), agent({ id: 'a2', role: 'explorer', status: 'done', endedMs: NOW - 15_000, startedMs: NOW - 30_000 })],
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

const memory = { memories: 12, review: 2, pinned: 3, pending: 1, lastSaveAt: new Date(NOW - 5 * 60_000).toISOString(), sessionSaves: 2 }
const args = (o: any = {}) => ({ panel: full(), usage, odd, nowMs: NOW, columns: 66, rows: 60, git, changes, ...o })
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
  expect(rows[0]).toBe('Opus 5.5 ○ ready')
  expect(rows.some((r) => r.startsWith('CONSTRUCT'))).toBe(false)
  expect(rows.some((r) => r.includes('■ main'))).toBe(false)
  const tree = buildPanel(args())
  expect(tree.props.width).toBe(66)
  expect(tree.children[0].props.borderStyle).toBe('round')
})

// ---- card order ------------------------------------------------------------

test('cards come in order: main, ODD, GATE, agents, changes', async () => {
  const rows = rowsOf()
  const at = ['Opus 5.5', 'ODD · card-panel', 'GATE · permissions', 'agents 1 at work · 2', 'feat/x ↑2'].map((n) => idx(rows, n))
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

test('the root has no background and fills the pane body at 40, 66 and 120 columns', async () => {
  for (const columns of [40, 66, 120]) {
    const tree = buildPanel(args({ columns, rows: 50 }))
    expect(tree.props.backgroundColor).toBeUndefined()
    expect(tree.props.minHeight).toBe(50)
  }
  // no usable rows: no fill height is set
  expect(buildPanel(args({ rows: undefined })).props.backgroundColor).toBeUndefined()
  expect(buildPanel(args({ rows: undefined })).props.minHeight).toBe(undefined)
})

// ---- main card ---------------------------------------------------------------

test('main card: model, status, one row of branch, effort meter, requests and mode, ctx gauge with tokens, 5h and 7d, no session cost', async () => {
  const rows = rowsOf()
  expect(rows[idx(rows, 'Opus 5.5')]).toBe('Opus 5.5 ○ ready')
  const i = idx(rows, 'Opus 5.5')
  expect(rows[i + 1]).toBe('⎇ feat/x · ▮▮▯▯ medium · 7 req · auto')
  expect(rows[i + 2]).toBe('ctx ▰▰▰▰▰▰▰▱▱▱ 67% 666k/1.0M  ⟲2')
  expect(rows[i + 3]).toBe('5h ▱▱▱▱▱ 4%   7d ▰▱▱▱▱ 13%')
  expect(rows.some((r) => r.includes('$'))).toBe(false)
  const card = buildPanel(args()).children.find((c) => c.props?.borderStyle === 'round')
  expect(card.props.borderColor).toBe('claude')
})

test('main card branch row: first body row, clipped, control-stripped, hidden without a branch', async () => {
  const at = (o) => { const r = rowsOf(o); return r[idx(r, ' ready') + 1] }
  expect(at({})).toMatch(/^⎇ feat\/x · /)
  expect(rowsOf({ panel: { ...full(), main: { ...full().main, mode: null } } })[1]).toBe('⎇ feat/x · ▮▮▯▯ medium · 7 req')
  expect(rowsOf().some((r) => r.includes('· main'))).toBe(false)
  expect(at({ git: { ...git, branch: 'a\u001b[31mb' } })).toMatch(/^⎇ a\[31mb · /)
  const long = at({ git: { ...git, branch: 'x'.repeat(100) }, columns: 40 })
  // L13: the branch gives way, the effort and the request count stay
  expect(long.length).toBe(36)
  expect(long).toContain('…')
  expect(long).toContain('7 req')
  for (const g of [null, { ...git, branch: '' }, { ...git, branch: undefined }]) expect(at({ git: g }).startsWith('⎇')).toBe(false)
})

test('main card shows without usage or replica, and is busy while a turn is open', async () => {
  const rows = rowsOf({ usage: null, panel: { ...initialState() }, odd: null, model: 'sonnet' })
  expect(rows).toContain('Sonnet ○ ready')
  expect(rows.some((r) => r.startsWith('ctx'))).toBe(false)
  expect(rows.some((r) => r.includes('▯▯▯▯ — · 0 req'))).toBe(true)
  const busy = { ...full(), turn: { turnId: 't' } }
  expect(rowsOf({ panel: busy }).some((r) => r === 'Opus 5.5 ● building')).toBe(true)
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
  const i = idx(rows, 'ODD · card-panel')
  expect(rows[i]).toBe('ODD · card-panel 3 open')
  expect(rows[i + 1]).toBe('T4  Card layout')
  expect(rows[i + 2]).toBe('●━●━●━◆━○')
  expect(leaves(buildPanel(args())).find((l) => l.text === 'T4')?.props.weight).toBe('semibold')
  expect(find(buildPanel(args()), '◆')?.props.weight).toBe('semibold')
  // without per-task rows only the title row and the task show
  const bare = rowsOf({ odd: { feature: 'x', open: 1 } })
  expect(bare[idx(bare, 'ODD · x')]).toBe('ODD · x 1 open')
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

test('GATE status: all clear, N waiting on you, or N checks; an empty body says nothing is waiting', async () => {
  const gateOf = (verdicts, o: any = {}) => {
    const p = { ...full(), gate: { ...full().gate, verdicts, denied: verdicts.deny, lastDenied: null }, ...o }
    const rows = rowsOf({ panel: p })
    return rows[idx(rows, 'GATE · permissions')]
  }
  expect(gateOf({ rule: 4, ask: 0, cleared: 16, deny: 0 })).toBe('GATE · permissions all clear')
  expect(gateOf({ rule: 4, ask: 2, cleared: 16, deny: 0 })).toBe('GATE · permissions 2 waiting on you')
  expect(gateOf({ rule: 4, ask: 2, cleared: 16, deny: 3 })).toBe('GATE · permissions 2 waiting on you')
  expect(gateOf({ rule: 4, ask: 0, cleared: 16, deny: 2 })).toBe('GATE · permissions 22 checks')
  const waiting = find(buildPanel(args({ panel: { ...full(), gate: { ...full().gate, verdicts: { rule: 0, ask: 1, cleared: 0, deny: 0 } } } })), '1 waiting on you')
  expect(waiting?.props.color).toBe('warning')
  const quiet = rowsOf({ panel: { ...initialState(), inline: { count: 1, last: '/a/b/c.js' } } })
  expect(quiet).toContain('nothing waiting on you')
  expect(rowsOf({ panel: { ...full(), gate: { ...full().gate, verdicts: { rule: 1, ask: 0, cleared: 0, deny: 0 } } } })).not.toContain('nothing waiting on you')
})

test('GATE says "you" when the mode is not auto, pending asks show, and the card hides when empty', async () => {
  const asked = { ...full(), main: { ...full().main, mode: 'default' }, gate: { ...full().gate, verdicts: { rule: 1, ask: 2, cleared: 3, deny: 0 }, denied: 0, lastDenied: null } }
  const rows = rowsOf({ panel: asked })
  const i = idx(rows, 'GATE · permissions')
  expect(rows[i]).toBe('GATE · permissions 2 waiting on you')
  expect(rows[i + 2]).toBe('■ 1 allowed  ■ 3 you  ■ 2 pending  ✗ 0 denied')
  expect(rows.some((r) => r.startsWith('✗ Bash'))).toBe(false)
  const none = { ...initialState() }
  expect(rowsOf({ panel: none }).some((r) => r.startsWith('GATE'))).toBe(false)
  const inlineOnly = { ...initialState(), inline: { count: 1, last: '/a/b/c.js' } }
  const r2 = rowsOf({ panel: inlineOnly })
  expect(r2[idx(r2, 'GATE')]).toBe('GATE · permissions all clear')
  expect(r2[idx(r2, 'GATE') + 1]).toBe('nothing waiting on you')
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
  expect(rows.filter((r) => /^⚒ worker/.test(r)).length).toBe(6)
  expect(rows).toContain('+2 earlier')
})

// ---- agents card (S1), no last turn (S2), no Client (S3) -----------------------

test('agents card: bordered, titled agents, short names, routed model with effort meter, static elapsed', async () => {
  const panel = { ...full(), agents: [agent({ model: 'claude-sonnet-5-5' }), agent({ id: 'a2', role: 'explorer', model: 'claude-haiku-4-5', effort: 'low', status: 'done', endedMs: NOW - 15_000, startedMs: NOW - 30_000 })] }
  const tree = buildPanel(args({ panel }))
  const box = (tree.children as any[]).find((c) => c.props?.borderStyle === 'round' && flat(c).startsWith('agents'))
  expect(box).toBeTruthy()
  expect(box.props.width).toBe(66)
  const rows = rowsOf({ panel })
  const squash = (r: string) => r.replace(/\s+/g, ' ')
  expect(rows).toContain('agents 1 at work · 2')
  expect(rows.some((r) => r.includes('construct:worker') || r.includes('construct_worker'))).toBe(false)
  expect(rows.map(squash)).toContain('⚒ worker building Sonnet 5.5 ▮▮▮▯ 1:05')
  expect(rows.map(squash)).toContain('⌕ explorer mapped Haiku 4.5 ▮▯▯▯ 0:15')
})

test('each role has its own glyph and verbs: running reads as doing, done as done', async () => {
  const roles = [
    ['explorer', 'construct:explorer', '⌕', 'mapping', 'mapped'],
    ['worker', 'construct:worker', '⚒', 'building', 'built'],
    ['verifier', 'construct:verifier', '⊨', 'verifying', 'verified'],
    ['general', 'general-purpose', '◇', 'working', 'done'],
    ['judge-a', 'construct:judge-a', '⚖', 'judging', 'judged'],
    ['judge-b', 'construct:judge-b', '⚖', 'judging', 'judged'],
    ['review-risk', 'construct:review-risk', '◎', 'reviewing', 'reviewed'],
    ['review-resilience', 'construct:review-resilience', '◎', 'reviewing', 'reviewed'],
    ['Plan', 'Plan', '•', 'working', 'done'],
  ]
  for (const [name, type, glyph, running, done] of roles) {
    for (const [status, verb] of [['running', running], ['done', done]]) {
      const panel = { ...initialState(), agents: [agent({ id: 'r', role: name.replaceAll('-', '_'), type, status, endedMs: status === 'done' ? NOW : null })] }
      const row = rowsOf({ panel }).find((r) => r.startsWith(glyph))
      expect(row?.replace(/\s+/g, ' ').startsWith(`${glyph} ${name} ${verb} `)).toBe(true)
    }
  }
})

test('running agent rows use the agent color; done rows are dim with a success-colored glyph', async () => {
  const tree = buildPanel(args())
  const run = leaves(tree).filter((l) => l.text === '⚒' || l.text.startsWith('worker') || l.text.startsWith('building'))
  expect(run.length).toBe(3)
  for (const l of run) expect(l.props).toEqual({ color: 'suggestion' })
  expect(leaves(tree).find((l) => l.text === '⌕')?.props).toEqual({ color: 'success' })
  const done = leaves(tree).filter((l) => l.text.startsWith('explorer') || l.text.startsWith('mapped'))
  expect(done.length).toBe(2)
  for (const l of done) expect(l.props.dimColor).toBe(true)
})

test('agents status: N at work · T while any runs, all done · T when none do', async () => {
  const idle = { ...full(), agents: [agent({ status: 'done', endedMs: NOW }), agent({ id: 'a2', status: 'done', endedMs: NOW })] }
  expect(rowsOf({ panel: idle })).toContain('agents all done · 2')
  const three = { ...full(), agents: [agent(), agent({ id: 'a2' }), agent({ id: 'a3', status: 'done', endedMs: NOW })] }
  expect(rowsOf({ panel: three })).toContain('agents 2 at work · 3')
})

test('main status: ready when idle, building while a turn runs, waiting on you when blocked', async () => {
  expect(rowsOf({ panel: initialState() })[0]).toBe('Claude ○ ready')
  const turn = { ...initialState(), turn: { turnId: 't' }, agents: [agent({ role: 'explorer', type: 'construct:explorer' })] }
  expect(rowsOf({ panel: turn })[0]).toBe('Claude ● mapping')
  expect(find(buildPanel(args({ panel: { ...turn, blocked: true } })), '◆ waiting on you')?.props.color).toBe('warning')
  expect(find(buildPanel(args({ panel: initialState() })), '○ ready')?.props.color).toBe('inactive')
})

test('agents card shows the subagent type for an agent with no construct role, and dashes the role', async () => {
  const panel = { ...full(), agents: [agent({ id: 'g', role: 'Explore', type: 'Explore', model: null, effort: null }), agent({ id: 'r', role: 'review_risk', type: 'construct:review-risk' })] }
  const rows = rowsOf({ panel })
  expect(rows.some((r) => /^• Explore\s+working\s+— /.test(r))).toBe(true)
  expect(rows.some((r) => r.startsWith('◎ review-risk'))).toBe(true)
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
  expect(leaves(tree).findLast((l) => l.text.includes('feat/x'))?.props).toMatchObject({ weight: 'semibold', color: 'remember' })
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
  const lean = { odd: null, panel: initialState(), changes: many }
  for (const rows of [8, 9, 10, 11, 12, 13, 14, 20, 24, 26, 30, 60]) {
    expect(rowsHigh(buildPanel(args({ ...lean, rows })))).toBeLessThanOrEqual(rows)
  }
  const shown = (rows: number) => rowsOf({ ...lean, rows }).filter((r) => r.startsWith('src/')).length
  expect(shown(26)).toBeGreaterThan(0)
  expect(rowsOf({ ...lean, rows: 8 }).some(isTitle)).toBe(false)
  // only the frame fits: the title (branch, ↑↓) stays, the rows go
  expect(rowsOf({ ...lean, rows: 9 }).some(isTitle)).toBe(true)
  expect(shown(9)).toBe(0)
  expect(rowsOf({ ...lean, rows: 10 }).at(-1)).toBe('+30 more')
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

test('agent rows at 40 columns keep the clock; the model column goes first (S7, L12)', async () => {
  const mk = (id: string, role: string, type: string, model: string) => agent({ id, role, type, model, effort: 'max', startedMs: NOW - 90_000 })
  const panel = {
    ...full(),
    agents: [mk('1', 'review_risk', 'construct:review-risk', 'claude-opus-5-5'), mk('2', 'verifier', 'construct:verifier', 'claude-haiku-4-5')],
  }
  const rows = rowsOf({ panel, columns: 40 }).filter((r) => /^[◎⊨] /.test(r))
  expect(rows.length).toBe(2)
  for (const r of rows) {
    expect(r).toContain('1:30')
    expect(r).not.toMatch(/Opus|Haiku/)
  }
  // with room the model stays
  expect(rowsOf({ panel, columns: 66 }).filter((r) => /^[◎⊨] .*(Opus 5.5|Haiku 4.5)/.test(r)).length).toBe(2)
})

// ---- S8b blocked indicator ----------------------------------------------------

test('blocked: the main card status reads waiting on you in place of busy or ready, with no extra row', async () => {
  const plain = rowsOf({ panel: { ...full(), blocked: false } })
  const rows = rowsOf({ panel: { ...full(), blocked: true } })
  expect(rows[0]).toBe('Opus 5.5 ◆ waiting on you')
  expect(rows.length).toBe(plain.length)
  expect(rows.filter((r) => r.includes('waiting on you')).length).toBe(1)
  const status = find(buildPanel(args({ panel: { ...full(), blocked: true } })), '◆ waiting on you')
  expect(status.props.color).toBe('warning')
})

test('not blocked: the status is unchanged', async () => {
  expect(rowsOf({ panel: { ...full(), blocked: false } })[0]).toBe(rowsOf()[0])
  expect(rowsOf()[0]).not.toContain('waiting')
})

test('phase: the busy status names the running agents phase, and blocked wins', async () => {
  const verifying = { ...full(), turn: { turnId: 't' }, agents: [agent(), agent({ id: 'v', role: 'verifier' })] }
  expect(rowsOf({ panel: verifying })[0]).toBe('Opus 5.5 ● verifying')
  expect(rowsOf({ panel: { ...verifying, blocked: true } })[0]).toBe('Opus 5.5 ◆ waiting on you')
  expect(rowsOf({ panel: { ...full(), blocked: false } })[0]).toBe('Opus 5.5 ○ ready')
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

// ---- MEMORY card (S20) -----------------------------------------------------------

test('MEMORY card is left out without data', async () => {
  expect(rowsOf().some((r) => r.startsWith('MEMORY'))).toBe(false)
})

test('MEMORY card: count, review, pinned, pending, last save and this session', async () => {
  const rows = rowsOf({ memory })
  const i = idx(rows, 'MEMORY')
  expect(rows[i]).toBe('MEMORY 12 memories')
  expect(rows[i + 1]).toBe('2 to review · 3 pinned · 1 pending')
  expect(rows[i + 2]).toBe('last save 5m ago · +2 this session')
  // between the GATE card and the agents card, beside ODD and GATE
  expect(i).toBeGreaterThan(idx(rows, 'GATE · permissions'))
  expect(i).toBeLessThan(idx(rows, 'agents'))
})

test('MEMORY card: to review is amber above 0 and plain at 0; unknown session and save are left out', async () => {
  expect(find(buildPanel(args({ memory })), '2 to review')?.props.color).toBe('warning')
  const calm = { ...memory, review: 0, lastSaveAt: null, sessionSaves: null }
  const tree = buildPanel(args({ memory: calm }))
  expect(find(tree, '0 to review')?.props.color).toBeUndefined()
  const rows = lines(tree)
  expect(rows).toContain('0 to review · 3 pinned · 1 pending')
  expect(rows.some((r) => r.startsWith('last save'))).toBe(false)
  expect(rowsOf({ memory: { ...memory, sessionSaves: null } })).toContain('last save 5m ago')
})

test('MEMORY card: empty store and off states are one dim line', async () => {
  const empty = { memories: 0, review: 0, pinned: 0, pending: 0, lastSaveAt: null, sessionSaves: 0 }
  const rows = rowsOf({ memory: empty })
  const i = idx(rows, 'MEMORY')
  expect(rows[i]).toBe('MEMORY 0 memories')
  expect(rows[i + 1]).toBe('nothing remembered yet')
  expect(find(buildPanel(args({ memory: empty })), 'nothing remembered yet')?.props.dimColor).toBe(true)
  const off = rowsOf({ memory: { off: 'not a git repository' } })
  const j = idx(off, 'MEMORY')
  expect(off[j]).toBe('MEMORY')
  expect(off[j + 1]).toBe('not a git repository')
  expect(find(buildPanel(args({ memory: { off: 'not a git repository' } })), 'not a git repository')?.props.dimColor).toBe(true)
})

test('MEMORY card shows a failure reason, amber for a newer schema or an unwritable database', async () => {
  const reason = 'memory database is from a newer construct (schema 99)'
  expect(find(buildPanel(args({ memory: { off: reason } })), reason)?.props.color).toBe('warning')
  expect(find(buildPanel(args({ memory: { off: 'attempt to write a readonly database' } })), 'attempt to write a readonly database')?.props.color).toBe('warning')
  expect(find(buildPanel(args({ memory: { off: 'boom' } })), 'boom')?.props.dimColor).toBe(true)
})

test('MEMORY card clips at the narrowest width', async () => {
  const rows = rowsOf({ columns: 40, memory: { ...memory, memories: 123456, review: 12, pinned: 34, pending: 56 } })
  const i = idx(rows, 'MEMORY')
  expect(rows[i]).toBe('MEMORY 123456 memories')
  expect(rows.slice(i, i + 3).every((r) => r.length <= 36)).toBe(true)
})

test('prettyModel names the new 5.x ids', () => {
  expect(prettyModel('claude-fable-5-1')).toBe('Fable 5.1')
  expect(prettyModel('claude-haiku-5-5')).toBe('Haiku 5.5')
})

// ---- slice-2 corrections (L13) ---------------------------------------------------

const agentRows = (rows: string[]) => rows.filter((r) => /^[⌕⚒⊨◇⚖◎•] /.test(r))

test('L13 agent rows: a running worker started first stays visible behind six later finished agents', () => {
  const agents = [
    agent({ id: 'w', startedMs: NOW - 900_000 }),
    ...Array.from({ length: 6 }, (_, i) => agent({ id: `d${i}`, role: 'explorer', status: 'done', startedMs: NOW - 100_000 + i * 1000, endedMs: NOW - 50_000 + i * 1000 })),
  ]
  const rows = rowsOf({ panel: { ...full(), agents } })
  expect(agentRows(rows).length).toBe(6)
  expect(rows.some((r) => /^⚒ worker\s+building/.test(r))).toBe(true)
  expect(rows).toContain('+1 earlier')
})

test('L13 agent rows: seven early running workers and three later finished explorers show six running rows and +4 earlier', () => {
  const agents = [
    ...Array.from({ length: 7 }, (_, i) => agent({ id: `w${i}`, startedMs: NOW - 900_000 + i * 1000 })),
    ...Array.from({ length: 3 }, (_, i) => agent({ id: `e${i}`, role: 'explorer', status: 'done', startedMs: NOW - 100_000, endedMs: NOW - 50_000 })),
  ]
  const rows = rowsOf({ panel: { ...full(), agents }, columns: 66 })
  expect(agentRows(rows).length).toBe(6)
  expect(rows.filter((r) => /^⚒ worker\s+building/.test(r)).length).toBe(6)
  expect(rows).toContain('+4 earlier')
  expect(find(buildPanel(args({ panel: { ...full(), agents } })), '+4 earlier')?.props.color).toBe('subtle')
})

test('L13 agent rows at 40 columns always end with the clock: model, then meter, then name and verb give way', () => {
  const agents = [agent({ id: 'r', role: 'review_reliability', type: 'construct:review-reliability' }), agent({ id: 'j', role: 'judge_a', type: 'construct:judge-a', startedMs: NOW - 3_725_000 })]
  const rows = agentRows(rowsOf({ panel: { ...full(), agents }, columns: 40 }))
  expect(rows.length).toBe(2)
  for (const r of rows) {
    expect(r).toMatch(/\d+:\d\d$|\dh\d\d$/)
    expect(r.length).toBeLessThanOrEqual(36)
    expect(r).not.toMatch(/Sonnet|▮|▯/)
  }
  // narrower still: the name and verb are clipped with an ellipsis, the clock stays
  const tight = agentRows(rowsOf({ panel: { ...full(), agents: [agent({ id: 'r', role: 'review_reliability', type: 'construct:review-reliability', startedMs: NOW - 3_725_000 })] }, columns: 40 }))
  expect(tight[0]).toMatch(/1h02$/)
})

test('L13 agent rows at 40 columns clip the name and verb with an ellipsis when even the clock row is tight', () => {
  const long = agent({ id: 'r', role: 'review_reliability', type: 'construct:review-reliability', startedMs: NOW - 36_000_000 })
  const row = agentRows(rowsOf({ panel: { ...full(), agents: [long] }, columns: 40 }))[0]
  expect(row.endsWith('10h00')).toBe(true)
  expect(row.length).toBeLessThanOrEqual(36)
})

test('L13 main row keeps the effort word and request count behind a long branch at 40 columns', () => {
  const row = rowsOf({ columns: 40, git: { ...git, branch: 'feat/panel-clean-room-2-layout-with-extra-words' } }).find((r) => r.startsWith('⎇'))!
  expect(row).toContain('medium')
  expect(row).toContain('7 req')
  expect(row).toContain('…')
  expect(row.length).toBeLessThanOrEqual(36)
  expect(row.split(' · ')[0].length).toBeGreaterThanOrEqual(2 + 8)
})

test('L13 main row clips the branch before dropping the mode at 66 columns, and drops the mode when the branch would fall under 8 characters', () => {
  const panel = { ...full(), main: { steps: 128, model: 'claude-opus-5-5', effort: 'high', mode: 'bypassPermissions' } }
  const row = rowsOf({ panel, columns: 66, git: { ...git, branch: 'feat/panel-clean-room-2-layout' } }).find((r) => r.startsWith('⎇'))!
  expect(row).toContain('128 req')
  expect(row).toContain('bypassPermissions')
  expect(row).toContain('…')
  const small = rowsOf({ panel, columns: 40, git: { ...git, branch: 'feat/panel-clean-room-2-layout' } }).find((r) => r.startsWith('⎇'))!
  expect(small).toContain('128 req')
  expect(small).not.toContain('bypassPermissions')
  expect(small.split(' · ')[0].replace('⎇ ', '').length).toBeGreaterThanOrEqual(8)
})

test('L14 colors: GATE status, memory details, and ctx tokens are dim; the zero-denied label is inactive', () => {
  const tree = buildPanel(args({ memory, panel: { ...full(), gate: { ...full().gate, verdicts: { rule: 4, ask: 0, cleared: 16, deny: 0 } } } }))
  expect(find(tree, '20 checks')?.props.dimColor ?? find(tree, 'all clear')?.props.dimColor).toBe(true)
  expect(find(tree, '0 denied')?.props.color).toBe('inactive')
  expect(find(tree, 'last save')?.props.dimColor).toBe(true)
  expect(find(tree, '666k/1.0M')?.props.dimColor).toBe(true)
})

test('L14 colors main row: glyph dim, branch plain, effort word main, requests and mode dim, meter cells main', () => {
  const tree = buildPanel(args())
  expect(leaves(tree).find((l) => l.text === '⎇ ')?.props).toEqual({ dimColor: true })
  expect(leaves(tree).find((l) => l.text === 'feat/x')?.props).toEqual({})
  expect(find(tree, ' medium')?.props).toEqual({ color: 'claude' })
  expect(find(tree, '7 req')?.props).toEqual({ dimColor: true })
  expect(leaves(tree).find((l) => l.text === 'auto')?.props).toEqual({ dimColor: true })
  expect(find(tree, '▮▮')?.props.color).toBe('claude')
  expect(find(tree, '▯▯')?.props.color).toBe('claude')
  const none = buildPanel(args({ panel: { ...full(), main: { ...full().main, effort: 'bogus' } } }))
  expect(find(none, '▯▯▯▯')?.props.color).toBe('claude')
})

test('L14 colors agents card: status dim, clocks inactive, running empty meter cells in the agent color', () => {
  const tree = buildPanel(args())
  expect(find(tree, '1 at work · 2')?.props).toEqual({ dimColor: true })
  const clocks = leaves(tree).filter((l) => /^ \d+:\d\d$/.test(l.text))
  expect(clocks.length).toBe(2)
  for (const l of clocks) expect(l.props).toEqual({ color: 'inactive' })
  const rows = (tree.children as any[]).find((c) => flat(c).startsWith('agents')).children.slice(1)
  const run = leaves(rows.find((r) => flat(r).includes('building')))
  expect(run.find((l) => l.text === '▮▮▮')?.props.color).toBe('suggestion')
  expect(run.find((l) => l.text === '▯')?.props.color).toBe('suggestion')
})

test('L14 colors limits row: the percents are plain', () => {
  const tree = buildPanel(args())
  const pcts = leaves(tree).filter((l) => /^ \d+%$/.test(l.text) && /^( 4| 13)%$/.test(l.text))
  expect(pcts.length).toBe(2)
  for (const l of pcts) {
    expect(l.props.dimColor).toBeUndefined()
    expect(l.props.color).toBeUndefined()
  }
})

test('L14 colors ODD card: done and current glyphs in the ODD color, every joint subtle, later glyphs and a leading ellipsis dim', () => {
  const tree = buildPanel(args())
  const joints = leaves(tree).filter((l) => l.text === '━')
  expect(joints.map((l) => l.props)).toEqual(Array(4).fill({ color: 'subtle' }))
  expect(leaves(tree).filter((l) => l.text === '●').every((l) => l.props.color === 'merged')).toBe(true)
  expect(leaves(tree).find((l) => l.text === '◆')?.props.color).toBe('merged')
  expect(leaves(tree).find((l) => l.text === '○')?.props).toEqual({ dimColor: true })
  const many = { ...odd, tasks: Array.from({ length: 40 }, (_, i) => ({ id: `T${i}`, done: false })) }
  expect(find(buildPanel(args({ odd: many })), '…━')?.props).toEqual({ dimColor: true })
})

test('L14 colors GATE legend: allowed and cleared dim, pending amber, a non-zero denied warn', () => {
  const panel = { ...full(), gate: { ...full().gate, verdicts: { rule: 4, ask: 1, cleared: 16, deny: 2 } } }
  const tree = buildPanel(args({ panel }))
  expect(find(tree, '4 allowed')?.props).toEqual({ dimColor: true })
  expect(find(tree, '16 classifier')?.props).toEqual({ dimColor: true })
  expect(find(tree, '1 pending')?.props).toEqual({ color: 'warning' })
  expect(find(tree, '2 denied')?.props).toEqual({ color: 'error' })
  expect(find(tree, '1 waiting on you')?.props.color).toBe('warning')
})

test('L14 colors changes card: +N more is subtle', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ path: `src/f${i}.js`, added: 30 - i, removed: 0 }))
  expect(find(buildPanel(args({ rows: undefined, changes: many })), '+21 more')?.props).toEqual({ color: 'subtle' })
})

test('L14 agent rows at 40 columns pad a short done verb instead of clipping it with an ellipsis', () => {
  const run = agent({ id: 'r', role: 'review_reliability', type: 'construct:review-reliability', startedMs: NOW - 360_000_000 })
  const done = agent({ id: 'd', role: 'explorer', type: 'construct:explorer', status: 'done', endedMs: NOW, startedMs: NOW - 65_000 })
  const rows = agentRows(rowsOf({ panel: { ...full(), agents: [run, done] }, columns: 40 }))
  expect(rows.length).toBe(2)
  const mapped = rows.find((r) => r.startsWith('⌕'))!
  expect(mapped).toContain('mapped')
  expect(mapped).not.toContain('…')
})

test('L13 row budget: body rows 0, negative, or unknown let the changes card take up to 10 rows', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ path: `src/f${i}.js`, added: 30 - i, removed: 0 }))
  for (const rows of [0, -5, undefined, Number.NaN]) {
    const out = rowsOf({ rows, changes: many })
    expect(out.filter((r) => r.startsWith('src/')).length).toBe(9)
    expect(out.at(-1)).toBe('+21 more')
  }
})

// ---- slice-2 lens warnings (L16) --------------------------------------------

test('agent names with control characters render no control bytes', async () => {
  for (const type of ['construct:wor\u001b[31mker', 'x\u0007y', 'a\u009bb']) {
    const panel = { ...full(), agents: [agent({ type, role: type })] }
    expect(/[\u0000-\u001f\u007f-\u009f]/.test(textOf(buildPanel(args({ panel }))).replace(/\n/g, ''))).toBe(false)
  }
})

test('a null or undefined panel renders the main card', async () => {
  for (const panel of [undefined, null]) {
    const rows = rowsOf({ panel, model: undefined })
    expect(rows[0]).toBe('Claude ○ ready')
  }
})

test('MEMORY unable-to-open and not-writable reasons are amber, not a git repository stays dim', async () => {
  for (const reason of ['unable to open database file', 'attempt to write a readonly database / not writable']) {
    expect(find(buildPanel(args({ memory: { off: reason } })), reason)?.props.color).toBe('warning')
  }
  expect(find(buildPanel(args({ memory: { off: 'not a git repository' } })), 'not a git repository')?.props.color).toBeUndefined()
})

test('the GATE card shows the last denial even with no counted checks (T7)', () => {
  const panel = { ...full(), gate: { ...full().gate, verdicts: { rule: 0, ask: 0, cleared: 0, deny: 0 }, lastDenied: { tool: 'Bash', detail: 'rm -rf x' } } }
  expect(textOf(buildPanel(args({ panel })))).toContain('✗ Bash: rm -rf x')
})

// ---- S4: wide characters count as two columns -----------------------------------

// Display width: wide, fullwidth and emoji code points take two columns.
const cellsOf = (s: string) => [...s].reduce((n, c) => n + (/[ᄀ-ᅟ⺀-꓏가-힣＀-｠￠-￦\p{Emoji_Presentation}]/u.test(c) ? 2 : 1), 0)

test('S4 agent rows with CJK or emoji names never exceed the card width at 40 columns', () => {
  for (const role of ['検索エージェント検索エージェント', '🔍🔍🔍🔍🔍🔍🔍🔍🔍🔍', 'ｗｉｄｅ名前']) {
    const rows = rowsOf({ panel: { ...full(), agents: [agent({ id: 'w', role, type: role })] }, columns: 40 })
    expect(rows.some((r) => cellsOf(r) > [...r].length)).toBe(true) // the wide name is really rendered
    for (const r of rows) expect(cellsOf(r)).toBeLessThanOrEqual(36)
  }
})

test('S4 a clipped wide name ends with an ellipsis and stays within the limit', () => {
  const rows = rowsOf({ panel: { ...full(), agents: [agent({ id: 'w', role: '検索エージェント検索エージェント', type: 'x' })] }, columns: 40 })
  const row = rows.find((r) => r.includes('検索'))!
  expect(row).toContain('…')
  expect(cellsOf(row)).toBeLessThanOrEqual(36)
})

test('S4 wide text in the branch, ODD feature, change path and agent name never overflows the card at 40, 41, 60 and 80 columns', () => {
  for (const columns of [40, 41, 60, 80]) {
    for (const w of ['検索エージェント検索エージェント', '🚀🚀🚀', 'ＡＢＣＤＥＦＧＨ']) {
      const text = `${w}/${w}`
      const rows = rowsOf({
        columns,
        git: { ...git, branch: text },
        odd: { ...odd, feature: text },
        changes: [{ path: `src/${text}.ts`, added: 3, removed: 1 }, ...changes],
        panel: { ...full(), agents: [agent({ id: 'w', role: text, type: text })] },
      })
      expect(rows.some((r) => cellsOf(r) > [...r].length)).toBe(true) // wide text is really rendered
      for (const r of rows) expect(cellsOf(r), `${columns} cols: ${r}`).toBeLessThanOrEqual(Math.max(40, columns) - 4)
    }
  }
})
