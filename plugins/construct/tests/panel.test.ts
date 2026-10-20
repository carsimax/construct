import { expect, test } from 'claude-code/testing'

// Mod-level tests for the panel wiring in hooks/register.js (S1, S8).

const NOW = new Date(2026, 9, 19, 12, 0, 0).getTime()
const TASKS = [
  '# feature',
  '',
  '## Tasks',
  '',
  '| ID | Specs | Task | Route | Risk | Status | Commit |',
  '|---|---|---|---|---|---|---|',
  '| T1 | S1 | first | w | none | done | x |',
  '| T2 | S1 | second | w | none | pending | - |',
  '',
  '## Log',
].join('\n')

const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
const value = (v: unknown) => ({ value: v })
const entry = (name: string) => ({ name, kind: 'file', size: 1, mtimeMs: 5, isLink: false })

// Stubs for everything the wiring reads. `usage` overrides the session usage.
function world($, on, o: any = {}) {
  on('session.usage', () => value({ startedAt: 0, context: { window: 200000, percent: 33 }, rateLimits: [], cost: { usd: o.cost ?? 1 } }))
  on('session.model', () => value('claude-opus-4'))
  on('session.cwd', () => value('/home/me/proj'))
  on('settings.read', () => value(o.settings ?? {}))
  on('env.get', () => value('/home/me'))
  on('clock.now', () => value(NOW))
  on('fs.list', () => value([entry('feat.md')]))
  on('fs.read', () => value(TASKS))
  on('process.run', (_$, e) => {
    const a = e.argv
    if (a[0] === 'git' && a.includes('status')) return value(ok('# branch.oid abc1234\n# branch.head main\n'))
    if (a[0] === 'git' && a.includes('rev-parse')) return value(ok('/home/me/proj\n.git\n.git\n'))
    if (a.includes('mode')) return value(ok(JSON.stringify({ mode: 'on', source: 'default' })))
    if (a.includes('boundary')) return value(ok(JSON.stringify({ commit: 'deadbeef', source: 'root' })))
    if (a.some((x: string) => x.endsWith('odd-assess'))) {
      return value(ok(JSON.stringify({ schema: 'x', risk: 'passive', reasons: [], candidate: { kind: 'k', consumed: false }, review_due: false, review_due_reason: 'passive' })))
    }
    return value({ ...ok(''), exitCode: 1 })
  })
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  const seen = o.seen ?? {}
  on('turn.start', (_$, e) => ((seen.start = e), { turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', (_$, e) => ((seen.call = e), { ref: 'r', result: {}, text: 'ok', ...(o.isError ? { isError: true } : {}) }))
  on('tool.check', (_$, e) => ((seen.check = e), { decision: o.decision ?? 'allow' }))
  on('agent.spawn', (_$, e) => ({ model: e.model, agentId: 'ag-1' }))
  on('session.compact', (_$, e) => ((seen.compact = e), { messages: [{ role: 'user', text: 's', toolUses: [] }] }))
  // The engine's own ui.open / ui.close: record what the mod asked for
  on('ui.open', (_$, e) => (open.add(e.id), opens.push(e), value({ isPlaced: true })))
  on('ui.close', (_$, e) => (open.delete(e.id), value(undefined)))
}

const open = new Set<string>()
const opens: any[] = []

const BAND = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: {}, view: {} }
const PANE = { title: 'Construct', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} }

async function leaves(ui) {
  const out: string[] = []
  const walk = (node) => {
    if (typeof node === 'string' || node == null) return
    if (node.type === 'Text') {
      out.push((node.children ?? []).filter((k) => typeof k === 'string').join(''))
      return
    }
    for (const k of node.children ?? []) walk(k)
  }
  walk(await ui.drawn())
  return out
}
const joined = async (ui) => (await leaves(ui)).join('')

const settle = () => new Promise((r) => setTimeout(r, 40))

async function start($, on, o: any = {}) {
  open.clear()
  world($, on, o)
  await $.session.start({ cwd: '/home/me/proj', source: 'startup' })
  await settle()
}

async function pane($) {
  return $.ui.mount({ plugin: 'construct', surface: 'terminal', component: 'Pane', requestId: 'construct', props: PANE })
}
async function band($) {
  return $.ui.mount({ plugin: 'construct', surface: 'terminal', component: 'AbovePrompt', props: BAND })
}
const isUp = async (_$) => open.has('construct')

test('/construct opens the pane and /construct close closes it', { options: { panel_open_on_start: false } }, async ($, on) => {
  await start($, on)
  expect(await isUp($)).toBe(false)
  await $.command.run({ command: 'construct' })
  await settle()
  expect(await isUp($)).toBe(true)
  await $.command.run({ command: 'construct', args: 'close' })
  await settle()
  expect(await isUp($)).toBe(false)
})

test('the Pane draws the panel for the construct pane id', async ($, on) => {
  await start($, on)
  await $.agent.spawn({ subagentType: 'construct:odd-worker', model: 'opus', prompt: 'p', description: 'build it' })
  await settle()
  const ui = await pane($)
  await ui.redraw()
  const text = await joined(ui)
  expect(text).toContain('odd_worker')
})

test('the AbovePrompt band is not drawn by the plugin', async ($, on) => {
  await start($, on)
  const ui = await band($)
  await ui.redraw()
  expect((await leaves(ui)).join('')).toBe('')
})

test('a main-thread Write outside odd/tasks shows the inline alert', async ($, on) => {
  await start($, on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Write', file_path: '/home/me/proj/src/a.js', content: 'x' })
  await settle()
  const p = await pane($)
  await p.redraw()
  expect(await joined(p)).toMatch(/inline writes\s+1/)
  expect(await joined(p)).toContain('a.js')
})

test('a write under odd/tasks is not an inline write', async ($, on) => {
  await start($, on)
  await $.tool.call({ tool: 'Write', file_path: '/home/me/proj/odd/tasks/x.md', content: 'x' })
  await settle()
  const p = await pane($)
  await p.redraw()
  expect(await joined(p)).not.toContain('inline')
})

test('a tool.check deny appears in the panel and passes the verdict through', async ($, on) => {
  await start($, on, { decision: 'deny' })
  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf x' }, tool_use_id: 'tu-1' })
  expect(verdict.decision).toBe('deny')
  await settle()
  const p = await pane($)
  await p.redraw()
  expect(await joined(p)).toContain('Bash')
})

test('a tool.check query without tool_use_id is not a gate cell', async ($, on) => {
  await start($, on, { decision: 'deny' })
  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf x' } })
  expect(verdict.decision).toBe('deny')
  await settle()
  const p = await pane($)
  await p.redraw()
  expect(await joined(p)).not.toContain('denied')
})

test('spawn makes a card and passes the spawn result through', async ($, on) => {
  await start($, on)
  const r = await $.agent.spawn({ subagentType: 'construct:odd-worker', model: 'opus', prompt: 'p', description: 'd' })
  expect(r.agentId).toBe('ag-1')
  expect(r.model).toBe('sonnet')
  await settle()
  const p = await pane($)
  await p.redraw()
  expect(await joined(p)).toContain('sonnet')
  expect(await joined(p)).toContain('0 steps')
})

test('new hooks pass events through unchanged', async ($, on) => {
  const seen: any = {}
  open.clear()
  world($, on, { seen, decision: 'ask' })
  await $.session.start({ cwd: '/home/me/proj', source: 'startup' })
  await $.turn.start({ text: 'go', turnId: 't9' })
  const check = await $.tool.check({ tool: 'Bash', input: { command: 'ls' } })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 's', toolUses: [] }] })
  expect(check.decision).toBe('ask')
  expect(seen.start.text).toBe('go')
  expect(seen.check.input).toEqual({ command: 'ls' })
  expect(seen.call.command).toBe('ls')
  expect(seen.compact.trigger).toBe('manual')
})

test('panel_open_on_start opens the pane when the session starts', { options: { panel_open_on_start: true } }, async ($, on) => {
  await start($, on)
  expect(await isUp($)).toBe(true)
})

test('with panel_open_on_start false the pane stays closed on start', { options: { panel_open_on_start: false } }, async ($, on) => {
  await start($, on)
  expect(await isUp($)).toBe(false)
})

test('the pane is requested at 56 columns, titled Construct', { options: { panel_open_on_start: true } }, async ($, on) => {
  opens.length = 0
  await start($, on)
  expect(opens.length).toBeGreaterThan(0)
  expect(opens[0].columns).toBe(56)
  expect(opens[0].title).toBe('Construct')
})
