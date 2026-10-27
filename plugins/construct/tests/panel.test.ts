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
  on('session.usage', () => value({ startedAt: 0, context: { window: 200000, tokens: 66000, percent: 33 }, rateLimits: o.rateLimits ?? [], cost: { usd: o.cost ?? 1 } }))
  on('session.model', () => value('claude-opus-4'))
  on('session.cwd', () => value('/home/me/proj'))
  on('session.id', () => value('sess-1'))
  on('settings.read', () => (o.hang?.() ? new Promise(() => {}) : value(o.settings ?? {})))
  on('env.get', () => value('/home/me'))
  on('fs.exists', () => value(o.exists ?? false))
  on('session.version', () => value({ version: o.version ?? '2.1.304', base: o.version ?? '2.1.304' }))
  on('clock.now', () => value(o.clock ? o.clock() : NOW))
  on('fs.list', () => value([entry('feat.md')]))
  on('fs.read', () => value(o.tasks ? o.tasks() : TASKS))
  on('process.run', (_$, e) => {
    const a = e.argv
    if (o.run) return value(o.run(a))
    if (a[0] === 'git' && a.includes('status')) return value(ok(o.git ?? '# branch.oid abc1234\n# branch.head main\n'))
    if (a[0] === 'git' && a.includes('--no-index')) return value(o.untrackedCount ? { ...ok(o.untrackedCount), exitCode: 1 } : { ...ok(''), exitCode: 128 })
    if (a[0] === 'git' && a.includes('--numstat')) return value(ok(o.numstat ?? ''))
    if (a[0] === 'git' && a.includes('rev-parse')) return value(ok('/home/me/proj\n.git\n.git\n'))
    return value({ ...ok(''), exitCode: 1 })
  })
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  const seen = o.seen ?? {}
  on('turn.start', (_$, e) => ((seen.start = e), { turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', async (_$, e) => ((seen.call = e), await o.hold?.(), { ref: 'r', result: {}, text: 'ok', ...(o.isError ? { isError: true } : {}) }))
  on('tool.check', (_$, e) => ((seen.check = e), { decision: (typeof o.decision === 'function' ? o.decision() : o.decision) ?? 'allow' }))
  on('agent.spawn', (_$, e) => ({ model: e.model, agentId: 'ag-1' }))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('session.compact', (_$, e) => ((seen.compact = e), { messages: [{ role: 'user', text: 's', toolUses: [] }] }))
  // The engine's own ui.open / ui.close: record what the mod asked for
  on('ui.open', (_$, e) => (open.add(e.id), opens.push(e), value({ isPlaced: true })))
  on('ui.close', (_$, e) => (open.delete(e.id), value(undefined)))
}

// The harness's $.tool.call runs its own permission check first, and a non-interactive ask denies the
// call before the tool.call handler runs. A gate answers ask only for the explicit check under test.
const gate = { ask: false }
const askingGate = () => (gate.ask ? 'ask' : 'allow')
async function checkAsk($, call) {
  gate.ask = true
  try {
    return await $.tool.check(call)
  } finally {
    gate.ask = false
  }
}

const open = new Set<string>()
const opens: any[] = []

const BAND = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: {}, view: {} }
const PANE = { title: 'Construct', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} }

async function leaves(ui) {
  const out: string[] = []
  const walk = (node) => {
    if (typeof node === 'string' || node == null) return
    if (node.type === 'Text' && !(node.children ?? []).some((k) => k?.type === 'Text')) {
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

test('/construct doctor returns a report even when every process fails', { options: { panel_open_on_start: false } }, async ($, on) => {
  await start($, on, { run: () => ({ ...ok(''), exitCode: 1 }), settings: undefined })
  const out = await $.command.run({ command: 'construct', args: 'doctor' })
  const text = String(out?.text ?? '')
  expect(text).toContain('Construct doctor')
  expect(text).toContain('✓ Claude Code 2.1.304')
  expect(text).toContain('✗ Node')
  expect(text).toContain('✗ Engram (not found)')
  expect(text).not.toContain('CodeGraph')
  expect(await isUp($)).toBe(false)
})

test('/construct doctor turns a hanging in-process probe into a failed row', { options: { panel_open_on_start: false } }, async ($, on) => {
  let hang = false
  await start($, on, { run: () => ({ ...ok(''), exitCode: 1 }), hang: () => hang })
  hang = true
  const text = String((await $.command.run({ command: 'construct', args: 'doctor' }))?.text ?? '')
  expect(text).toContain('Construct doctor')
  expect(text).toContain('✗ Engram (not found)')
})

test('/construct doctor reports a healthy setup', { options: { panel_open_on_start: false } }, async ($, on) => {
  const run = (a: string[]) => {
    if (a[0] === 'engram') return ok('engram 3.6.0\n')
    if (a[0] === 'git') return ok('/home/me/proj\n.git\n.git\n')
    if (a[1] === '--version') return ok('v22.16.0\n')
    return ok('usage')
  }
  await start($, on, { run, exists: true, version: '2.1.400' })
  const text = String((await $.command.run({ command: 'construct', args: 'doctor' }))?.text ?? '')
  expect(text).not.toContain('✗')
  expect(text).toContain('✓ Engram 3.6.0')
})

test('/construct doctor shows Engram not found when its probe throws, and still shows Node', { options: { panel_open_on_start: false } }, async ($, on) => {
  const run = (a: string[]) => {
    if (a[0] === 'engram') throw new Error('spawn engram ENOENT')
    if (a[1] === '--version') return ok('v22.16.0\n')
    return ok('usage')
  }
  await start($, on, { run, exists: true })
  const text = String((await $.command.run({ command: 'construct', args: 'doctor' }))?.text ?? '')
  expect(text).toContain('✗ Engram (not found)')
  expect(text).toContain('✓ Node')
})

test('the Pane draws the panel for the construct pane id', async ($, on) => {
  await start($, on)
  await $.agent.spawn({ subagentType: 'construct:worker', model: 'opus', prompt: 'p', description: 'build it' })
  await settle()
  const ui = await pane($)
  await ui.redraw()
  const text = await joined(ui)
  expect(text).toContain('worker')
  expect(text).not.toContain('construct:worker')
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
  expect(await joined(p)).toContain('⚠ 1 inline write')
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
  const r = await $.agent.spawn({ subagentType: 'construct:worker', prompt: 'p', description: 'd' })
  expect(r.agentId).toBe('ag-1')
  expect(r.model).toBe('sonnet')
  await settle()
  const p = await pane($)
  await p.redraw()
  const text = await joined(p)
  expect(text).toContain('agents')
  expect(text).toContain('1 at work · 1')
  expect(text).toContain('worker')
  expect(text).not.toContain('construct:worker')
  expect(text).toContain('Sonnet')
})

test('new hooks pass events through unchanged', async ($, on) => {
  const seen: any = {}
  open.clear()
  world($, on, { seen, decision: askingGate })
  await $.session.start({ cwd: '/home/me/proj', source: 'startup' })
  await $.turn.start({ text: 'go', turnId: 't9' })
  const check = await checkAsk($, { tool: 'Bash', input: { command: 'ls' } })
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

test('the pane is requested at 66 columns, titled Construct', { options: { panel_open_on_start: true } }, async ($, on) => {
  opens.length = 0
  await start($, on)
  expect(opens.length).toBeGreaterThan(0)
  expect(opens[0].columns).toBe(66)
  expect(opens[0].title).toBe('Construct')
})

async function step($, e: any = {}) {
  const stream = $.turn.step({ turnId: 't1', index: 0, ...e })
  let r = await stream.next()
  while (r.done !== true) r = await stream.next()
  return r.value
}

test('a main-thread turn.step shows its request count, model and effort in the main card', async ($, on) => {
  await start($, on)
  await step($, { model: 'claude-opus-5-5', effort: 'high' })
  await step($, { model: 'claude-opus-5-5', effort: 'high', index: 1 })
  await step($, { model: 'claude-haiku-4-5', effort: 'low', agentId: 'sub-1', index: 2 })
  await settle()
  const p = await pane($)
  await p.redraw()
  const text = await joined(p)
  expect(text).toContain('Opus 5.5')
  expect(text).toContain('2 req')
  expect(text).toContain('▮▮▮▯')
})

test('a spawn from main sets the permission mode; a nested spawn does not', async ($, on) => {
  await start($, on)
  await $.agent.spawn({ subagentType: 'construct:worker', prompt: 'p', description: 'd', permissionMode: 'auto' })
  await $.agent.spawn({ subagentType: 'construct:worker', prompt: 'p', description: 'd', permissionMode: 'plan', parentAgentId: 'x' })
  await settle()
  const p = await pane($)
  await p.redraw()
  const text = await joined(p)
  expect(text).toContain('· auto')
  expect(text).not.toContain('· plan')
})

test('a tool.call after an ask settles it as cleared', async ($, on) => {
  const seen: any = {}
  await start($, on, { decision: askingGate, seen })
  await checkAsk($, { tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'tu-1' })
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'tu-1' } as any)
  await $.tool.call({ tool: 'Write', file_path: '/home/me/proj/src/a.js', content: 'x' })
  await settle()
  const p = await pane($)
  await p.redraw()
  const text = await joined(p)
  expect(text).toContain('1 you')
  expect(text).not.toContain('pending')
  expect(text).toContain('inline write')
})

test('no session log card is drawn', async ($, on) => {
  await start($, on)
  await $.agent.spawn({ subagentType: 'construct:worker', model: 'opus', prompt: 'p', description: 'build it' })
  await settle()
  const p = await pane($)
  await p.redraw()
  const text = await joined(p)
  expect(text).not.toContain('session log')
  expect(text).not.toContain('CONSTRUCT')
})

test('the changes card shows the branch, ahead and behind, tracked and untracked files', async ($, on) => {
  await start($, on, {
    git: '# branch.oid abc1234\n# branch.head feat/x\n# branch.upstream o/feat/x\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b src/a.js\n? notes.md\n',
    numstat: '12\t3\tsrc/a.js\n-\t-\tlogo.png\n',
    untrackedCount: '7\t0\tnotes.md\n',
  })
  const p = await pane($)
  await p.redraw()
  const text = await joined(p)
  expect(text).toContain('feat/x')
  expect(text).toContain('↑2')
  expect(text).toContain('↓1')
  expect(text).toContain('src/a.js')
  expect(text).toContain('+12')
  expect(text).toContain('-3')
  expect(text).toContain('logo.png')
  expect(text).toContain('bin')
  expect(text).toContain('notes.md')
  expect(text).toContain('+7')
})

test('git status runs with -z so a non-ASCII untracked path gets its line count', async ($, on) => {
  const argvs: string[][] = []
  await start($, on, {
    git: '# branch.oid abc1234\0# branch.head main\0# branch.ab +0 -0\0? café.md\0',
    untrackedCount: '5\t0\tcafé.md\n',
    run: (a) => (argvs.push(a), a.includes('status') ? ok('# branch.oid abc1234\0# branch.head main\0# branch.ab +0 -0\0? café.md\0') : { ...ok('5\t0\tcafé.md\n'), exitCode: 1 }),
  })
  const p = await pane($)
  await p.redraw()
  expect(argvs.find((a) => a.includes('status'))).toContain('-z')
  const text = await joined(p)
  expect(text).toContain('café.md')
  expect(text).toContain('+5')
  expect(argvs.find((a) => a.includes('--no-index'))).toContain('café.md')
})

test('an untracked file whose count is unavailable shows new; a clean synced repo has no changes card', async ($, on) => {
  await start($, on, { git: '# branch.oid abc1234\n# branch.head main\n# branch.ab +0 -0\n? notes.md\n' })
  const p = await pane($)
  await p.redraw()
  const text = await joined(p)
  expect(text).toContain('notes.md')
  expect(text).toContain('new')
})

test('a clean repository in sync has no changes card', async ($, on) => {
  await start($, on, { git: '# branch.oid abc1234\n# branch.head main\n# branch.ab +0 -0\n' })
  const p = await pane($)
  await p.redraw()
  // only the main card's branch row names it: no changes card title
  expect((await leaves(p)).filter((l) => l === 'main')).toHaveLength(1)
})

test('5h and 7d show the reset time next to the gauges', async ($, on) => {
  const iso = (min: number) => new Date(NOW + min * 60_000).toISOString()
  await start($, on, { rateLimits: [{ kind: 'five_hour', percentUsed: 10, resetsAt: iso(190) }, { kind: 'seven_day', percentUsed: 20, resetsAt: iso(4 * 1440 + 125) }] })
  const p = await pane($)
  await p.redraw()
  const text = await joined(p)
  expect(text).toContain('↻3h10m')
  expect(text).toContain('↻4d2h')
  expect(text).toContain('66k/200k')
})

test('a surface with Client support still draws no Client element and no rail', async ($, on) => {
  await start($, on)
  await $.turn.start({ text: 'go', turnId: 't3' })
  const p = await pane($)
  await p.redraw()
  const tree = JSON.stringify(await p.drawn())
  expect(tree).not.toContain('"type":"Client"')
  expect(tree).not.toContain('rail.tsx')
  expect(tree).not.toContain('elapsed.tsx')
})

// ---- S8b blocked state: tool.check asks and the blocking tools, no classic hooks ----

// One pane per test: mount it once, redraw it for each reading.
const reader = async ($) => {
  const p = await pane($)
  return async () => (await p.redraw(), joined(p))
}

const CALL = { tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'tu-1' }

test('a real tool.check ask shows blocked until the call settles', async ($, on) => {
  await start($, on, { decision: 'ask' })
  const status = await reader($)
  expect(await status()).toContain('○ ready')
  await $.tool.check(CALL)
  await settle()
  expect(await status()).toContain('◆ waiting on you')
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'tu-1' })
  await settle()
  expect(await status()).not.toContain('◆ waiting')
})

test('an allow verdict and a query ask do not block', async ($, on) => {
  await start($, on, { decision: 'allow' })
  const status = await reader($)
  await $.tool.check(CALL)
  await settle()
  expect(await status()).not.toContain('◆ waiting')
})

test('a tool.check ask without a tool_use_id (a query) does not block', async ($, on) => {
  await start($, on, { decision: 'ask' })
  const status = await reader($)
  await $.tool.check({ tool: 'Bash', input: { command: 'ls' } })
  await settle()
  expect(await status()).not.toContain('◆ waiting')
})

// A tool.call whose core step stays open until `release()`, as a question waits on the person.
async function openCall($, on, tool: string) {
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => (release = r))
  await start($, on, { hold: () => gate })
  const status = await reader($)
  const call = $.tool.call({ tool })
  await settle()
  return { status, release, call }
}

for (const tool of ['AskUserQuestion', 'ExitPlanMode']) {
  test(`${tool} blocks while its tool.call is open and clears when it returns`, async ($, on) => {
    const { status, release, call } = await openCall($, on, tool)
    expect(await status()).toContain('◆ waiting on you')
    release()
    await call
    await settle()
    expect(await status()).not.toContain('◆ waiting')
  })
}

test('another tool does not block while its tool.call is open', async ($, on) => {
  const { status, release, call } = await openCall($, on, 'Bash')
  expect(await status()).not.toContain('◆ waiting')
  release()
  await call
})

test('turn.start and turn.complete clear a block', async ($, on) => {
  await start($, on, { decision: 'ask' })
  const status = await reader($)
  for (const clear of [
    () => $.turn.start({ text: 'go', turnId: 't1' }),
    () => $.turn.complete({ turnId: 't1', answer: 'done' }),
  ]) {
    await $.tool.check(CALL)
    await settle()
    expect(await status()).toContain('◆ waiting on you')
    await clear()
    await settle()
    expect(await status()).not.toContain('◆ waiting')
  }
})

test('the blocked-state wiring passes tool.check and tool.call results through unchanged', async ($, on) => {
  await start($, on, { decision: askingGate })
  expect((await checkAsk($, CALL)).decision).toBe('ask')
  const r = await $.tool.call({ tool: 'AskUserQuestion' })
  expect(r.text).toBe('ok')
})
