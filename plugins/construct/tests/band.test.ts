import { expect, test } from 'claude-code/testing'

// Mod-level tests for the band wiring in hooks/register.js (S1, S8).

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

// Stubs for everything the wiring reads; `o` overrides pieces.
function world($, on, o: any = {}) {
  on('session.model', () => value('claude-opus-4'))
  on('session.cwd', () => value('/home/me/proj'))
  on('session.id', () => value('sess-1'))
  on('env.get', () => value('/home/me'))
  on('fs.exists', () => value(o.exists ?? false))
  on('session.version', () => (o.hang?.() ? new Promise(() => {}) : value({ version: o.version ?? '2.1.304', base: o.version ?? '2.1.304' })))
  on('clock.now', () => value(o.clock ? o.clock() : NOW))
  on('fs.list', () => value([entry('feat.md')]))
  on('fs.read', () => value(o.tasks ? o.tasks() : TASKS))
  on('process.run', (_$, e) => {
    const a = e.argv
    if (o.run) return value(o.run(a))
    if (a[0] === 'git' && a.includes('rev-parse')) return value(ok('/home/me/proj\n.git\n.git\n'))
    return value({ ...ok(''), exitCode: 1 })
  })
  // what the mods after construct draw (Claude Code's own default draws nothing)
  on('ui.render', () => (o.other ? { type: 'Text', props: {}, children: [o.other] } : { type: 'Box', props: {}, children: [] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  const seen = o.seen ?? {}
  on('turn.start', (_$, e) => ((seen.start = e), { turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', async (_$, e) => {
    seen.call = e
    await o.hold?.()
    if (o.throws) throw new Error('tool failed')
    return o.deny ? { deny: o.deny } : { ref: 'r', result: {}, text: 'ok', ...(o.isError ? { isError: true } : {}) }
  })
  on('tool.check', (_$, e) => ((seen.check = e), { decision: (typeof o.decision === 'function' ? o.decision() : o.decision) ?? 'allow' }))
  // no model given means the agent's frontmatter one (sonnet for the worker)
  on('agent.spawn', (_$, e) => ({ model: e.model ?? 'sonnet', agentId: 'ag-1' }))
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

async function band($) {
  return $.ui.mount({ plugin: 'construct', surface: 'terminal', component: 'AbovePrompt', props: BAND })
}

test('/construct doctor returns a report even when every process fails', async ($, on) => {
  await start($, on, { run: () => ({ ...ok(''), exitCode: 1 }) })
  const out = await $.command.run({ command: 'construct', args: 'doctor' })
  const text = String(out?.text ?? '')
  expect(text).toContain('Construct doctor')
  expect(text).toContain('✓ Claude Code 2.1.304')
  expect(text).toContain('✗ Node')
  expect(text).not.toContain('Engram')
  expect(text).not.toContain('CodeGraph')
})

test('/construct doctor turns a hanging in-process probe into a failed row', async ($, on) => {
  let hang = false
  await start($, on, { run: () => ({ ...ok(''), exitCode: 1 }), hang: () => hang })
  hang = true
  const text = String((await $.command.run({ command: 'construct', args: 'doctor' }))?.text ?? '')
  expect(text).toContain('Construct doctor')
  expect(text).toContain('✗ Claude Code')
  expect(text).toContain('✗ Node')
})

test('/construct doctor reports a healthy setup, and a bare /construct prints the same report', async ($, on) => {
  const run = (a: string[]) => {
    if (a[0] === 'git') return ok('/home/me/proj\n.git\n.git\n')
    if (a[1] === '--version') return ok('v22.16.0\n')
    return ok('usage')
  }
  await start($, on, { run, exists: true, version: '2.1.400' })
  const text = String((await $.command.run({ command: 'construct', args: 'doctor' }))?.text ?? '')
  expect(text).not.toContain('✗')
  expect(text).toContain('✓ Node 22.16.0')
  expect(String((await $.command.run({ command: 'construct' }))?.text ?? '')).toBe(text)
  expect(opens).toHaveLength(0)
})

test('the band shows the running agent by its role, the open feature, and the phase', async ($, on) => {
  await start($, on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.agent.spawn({ subagentType: 'construct:worker', model: 'opus', prompt: 'p', description: 'build it' })
  await settle()
  const ui = await band($)
  await ui.redraw()
  const text = await joined(ui)
  expect(text).toContain('● building')
  expect(text).toContain('ODD feat')
  expect(text).toContain('⚒ worker building')
  expect(text).not.toContain('construct:worker')
})

test('the band keeps what other mods draw below it, and nothing is drawn in a Pane', async ($, on) => {
  await start($, on, { other: 'from another mod' })
  const ui = await band($)
  await ui.redraw()
  const text = await joined(ui)
  expect(text).toContain('○ ready')
  expect(text.indexOf('○ ready')).toBeLessThan(text.indexOf('from another mod'))
  const p = await $.ui.mount({ plugin: 'construct', surface: 'terminal', component: 'Pane', requestId: 'construct', props: PANE })
  await p.redraw()
  expect(await joined(p)).toBe('from another mod')
  expect(opens).toHaveLength(0)
})

test('with nothing to show the band leaves the site to the other mods', async ($, on) => {
  await start($, on, { tasks: () => '# no tasks table', other: 'only theirs' })
  const ui = await band($)
  await ui.redraw()
  expect(await joined(ui)).toBe('only theirs')
})

test('a main-thread Write outside odd/tasks shows the inline alert', async ($, on) => {
  await start($, on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Write', file_path: '/home/me/proj/src/a.js', content: 'x' })
  await settle()
  const p = await band($)
  await p.redraw()
  expect(await joined(p)).toContain('⚠ 1 inline')
})

for (const [why, o] of [['denied', { deny: 'surface-guard: too big' }], ['failed', { isError: true }]] as const) {
  test(`a ${why} main-thread Write is not an inline write`, async ($, on) => {
    await start($, on, o)
    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call({ tool: 'Write', file_path: '/home/me/proj/src/a.js', content: 'x' })
    await settle()
    const p = await band($)
    await p.redraw()
    expect(await joined(p)).not.toContain('inline')
  })
}

test('an ask whose tool.call throws is settled, not left pending', async ($, on) => {
  await start($, on, { decision: askingGate, throws: true })
  await checkAsk($, { tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'tu-1' })
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'tu-1' } as any).catch(() => {})
  await settle()
  const p = await band($)
  await p.redraw()
  expect(await joined(p)).not.toContain('pending')
})

test('a write under odd/tasks is not an inline write', async ($, on) => {
  await start($, on)
  await $.tool.call({ tool: 'Write', file_path: '/home/me/proj/odd/tasks/x.md', content: 'x' })
  await settle()
  const p = await band($)
  await p.redraw()
  expect(await joined(p)).not.toContain('inline')
})

test('a tool.check deny appears in the band and passes the verdict through', async ($, on) => {
  await start($, on, { decision: 'deny' })
  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf x' }, tool_use_id: 'tu-1' })
  expect(verdict.decision).toBe('deny')
  await settle()
  const p = await band($)
  await p.redraw()
  expect(await joined(p)).toContain('✗ 1')
})

test('a tool.check query without tool_use_id is not a gate cell', async ($, on) => {
  await start($, on, { decision: 'deny' })
  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf x' } })
  expect(verdict.decision).toBe('deny')
  await settle()
  const p = await band($)
  await p.redraw()
  expect(await joined(p)).not.toContain('gate')
})

test('spawn adds the agent to the band and passes the spawn result through', async ($, on) => {
  await start($, on)
  const r = await $.agent.spawn({ subagentType: 'construct:worker', prompt: 'p', description: 'd' })
  expect(r.agentId).toBe('ag-1')
  expect(r.model).toBe('sonnet')
  await settle()
  const p = await band($)
  await p.redraw()
  const text = await joined(p)
  expect(text).toContain('⚒ worker building')
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

test('a tool.call after an ask settles it as cleared', async ($, on) => {
  const seen: any = {}
  await start($, on, { decision: askingGate, seen })
  await checkAsk($, { tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'tu-1' })
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'tu-1' } as any)
  await $.tool.call({ tool: 'Write', file_path: '/home/me/proj/src/a.js', content: 'x' })
  await settle()
  const p = await band($)
  await p.redraw()
  const text = await joined(p)
  // the harness checks each call too, so the passed total is above one; the ask is neither pending nor denied
  expect(text).toMatch(/gate ✓ \d+/)
  expect(text).not.toContain('pending')
  expect(text).not.toContain('✗')
  expect(text).toContain('⚠ 1 inline')
})

test('the band draws no Client element and no rail', async ($, on) => {
  await start($, on)
  await $.turn.start({ text: 'go', turnId: 't3' })
  const p = await band($)
  await p.redraw()
  const tree = JSON.stringify(await p.drawn())
  expect(tree).not.toContain('"type":"Client"')
  expect(tree).not.toContain('rail.tsx')
  expect(tree).not.toContain('elapsed.tsx')
})

// ---- S8b blocked state: tool.check asks and the blocking tools, no classic hooks ----

// One band per test: mount it once, redraw it for each reading.
const reader = async ($) => {
  const p = await band($)
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
