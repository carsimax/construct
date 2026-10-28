import { expect, test } from 'claude-code/testing'
import { parseRevParse } from '../hooks/status/data.js'
import { activeWork } from '../hooks/status/tasks.js'

// ---- fixtures ----------------------------------------------------------

const NOW = new Date(2026, 9, 19, 12, 0, 0).getTime()

const TASKS = [
  '# feature',
  '',
  '## Tasks',
  '',
  '| ID | Specs | Task | Status |',
  '|---|---|---|---|',
  '| T1 | S1 | first | done |',
  '| T2 | S1 | second | in progress |',
  '| T3 | S2 | third | pending |',
  '| T4 | S2 | fourth | dropped |',
  '',
  '## Log',
].join('\n')


const entry = (name: string, mtimeMs = 1) => ({ name, kind: 'file', size: 1, mtimeMs, isLink: false })
const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

// Registers stubs for everything the band reads. `o` overrides pieces; a function
// for `process` answers each argv, and `fail` makes every call reject.
function world($, on, o: any = {}) {
  const settings = o.settings ?? {}
  const value = (v) => ({ value: v })
  on('session.usage', () => value(o.usage === undefined ? { startedAt: 0, context: { window: 200000, percent: 12 }, rateLimits: [] } : o.usage))
  on('session.model', () => value(o.model ?? 'claude-opus-4'))
  on('session.cwd', () => value('/home/me/proj'))
  on('settings.read', () => value(settings))
  on('env.get', () => value('/home/me'))
  on('clock.now', () => value(NOW))
  on('fs.list', () => value(o.tasks === undefined ? [entry('feat.md', 5)] : o.tasks.map((t: any) => entry(t.name, t.mtimeMs))))
  on('fs.read', ($, e) => {
    const t = (o.tasks ?? [{ name: 'feat.md', text: TASKS }]).find((x: any) => e.path.endsWith('/' + x.name))
    if (!t) throw new Error('missing')
    return value(t.text)
  })
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  const seen: string[][] = []
  on('process.run', ($, e) => {
    seen.push([...e.argv])
    if (o.fail) throw new Error('boom')
    const a = e.argv
    if (a[0] === 'git' && a.includes('rev-parse')) return value(ok('/home/me/proj\n.git\n.git\n'))
    return value({ ...ok(''), exitCode: 1 })
  })
  return seen
}

const BAND = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: {}, view: {} }

// Mounts the band and waits for the refresh a session.start starts to land.
async function drawBand($, on, o: any = {}) {
  const seen = world($, on, o)
  await $.session.start({ cwd: '/home/me/proj', source: 'startup' })
  const ui = await $.ui.mount({ plugin: 'construct', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  for (let i = 0; i < 40 && !(await leaves(ui)).some((l) => l.text.includes('ADD')); i++) {
    await ui.redraw()
    await new Promise((r) => setTimeout(r, 5))
  }
  return { ui, seen }
}

async function leaves(ui) {
  const out: { text: string; props: any; key?: string }[] = []
  const walk = (node, key?: string) => {
    if (typeof node === 'string' || node == null) return
    const kids = node.children ?? []
    if (node.type === 'Text' && !kids.some((k) => k?.type === 'Text')) {
      out.push({ text: kids.filter((k) => typeof k === 'string').join(''), props: node.props ?? {}, key })
      return
    }
    for (const k of kids) walk(k, node.props?.key ?? key)
  }
  walk(await ui.drawn())
  return out
}

const joined = async (ui) => (await leaves(ui)).map((l) => l.text).join('')

// ---- pure helpers --------------------------------------------------------

test('parseRevParse reads the root', async () => {
  expect(parseRevParse('/r\n/r/.git/worktrees/w\n/r/.git\n')).toEqual({ root: '/r' })
  expect(parseRevParse('/r\n.git\n.git\n')).toEqual({ root: '/r' })
  expect(parseRevParse('')).toBe(null)
  expect(parseRevParse(undefined)).toBe(null)
})

// ---- mounted band ---------------------------------------------------------

test('the band shows the feature and leaves the model, context, limits and git to the status line', async ($, on) => {
  const { ui } = await drawBand($, on, {
    settings: { statusLine: { type: 'command', command: 'x' }, outputStyle: 'Explanatory' },
    usage: { startedAt: 0, context: { window: 1_000_000, tokens: 120_000, percent: 12 }, rateLimits: [{ kind: 'five_hour', percentUsed: 30 }], cost: { usd: 3.5 } },
  })
  const text = await joined(ui)
  expect(text).toMatch(/ADD feat ●━◆/)
  for (const w of ['T2', 'second']) expect(text).not.toContain(w)
  for (const w of ['ctx', '12%', '5h', '30%', 'Opus', '⎇', '$3.50', '~/proj', 'Explanatory']) expect(text).not.toContain(w)
})

// Theme keys documented for custom themes; the band colors with these so it follows the active theme.
const THEME_KEYS = new Set(['claude', 'text', 'inverseText', 'inactive', 'subtle', 'suggestion', 'permission', 'remember', 'success', 'error', 'warning', 'merged', 'promptBorder', 'planMode', 'autoAccept', 'bashBorder', 'ide', 'fastMode'])

test('every color the band draws is a theme key, so it follows the active theme', async ($, on) => {
  const { ui } = await drawBand($, on)
  const colors = (await leaves(ui)).map((l) => l.props.color).filter(Boolean)
  expect(colors.length).toBeGreaterThan(0)
  for (const color of colors) expect(THEME_KEYS.has(color)).toBe(true)
})

test('the band draws no matrix mark and no inline rail', async ($, on) => {
  const { ui } = await drawBand($, on)
  const text = await joined(ui)
  expect(text).not.toContain('▌')
  expect(text).not.toContain('┊')
  expect(text).not.toContain(' │ ')
})

test('a failing process still finds the feature from the session directory and does not throw', async ($, on) => {
  const { ui } = await drawBand($, on, { fail: true })
  expect(await joined(ui)).toMatch(/ADD feat ●━◆/)
})

test('the only probe is git rev-parse, run on session.start and turn.complete, never on render', async ($, on) => {
  const { ui, seen } = await drawBand($, on, {})
  const after = seen.length
  expect(after).toBeGreaterThan(0)
  for (const argv of seen) expect(argv).toEqual(['git', 'rev-parse', '--show-toplevel'])
  await ui.redraw()
  await ui.redraw()
  expect(seen.length).toBe(after)
  await $.turn.complete({ turnId: 't', reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false })
  await new Promise((r) => setTimeout(r, 30))
  expect(seen.length).toBeGreaterThan(after)
})

// The Tasks heading follows the publication gate: any level 2-6, trailing text allowed.
test('activeWork reads a Tasks table under ### Tasks or ## Tasks (phase 2)', async () => {
  const table = ['', '| ID | Specs | Task | Status |', '|---|---|---|---|', '| T1 | S1 | a | pending |', '', '## Log']
  for (const heading of ['### Tasks', '## Tasks (phase 2)']) {
    expect(activeWork([{ name: 'f.md', mtimeMs: 1, text: ['# f', '', '## Plan', '', heading, ...table].join('\n') }])?.open).toBe(1)
  }
  expect(activeWork([{ name: 'f.md', mtimeMs: 1, text: ['# f', '', '### Tasks', '', '## Other', ...table].join('\n') }])).toBe(null)
})
