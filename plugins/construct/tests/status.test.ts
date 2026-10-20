import { expect, test } from 'claude-code/testing'
import { bar, clampPct, formatReset5h, formatResetWeek, joinSegments, meterColor, shortDir } from '../hooks/status/format.js'
import { activeFeature, unfinishedCount } from '../hooks/status/tasks.js'
import { parseAssess, parseBoundary, parseGitStatus, parseMode, parseNumstat, parseRevParse, reviewState } from '../hooks/status/data.js'

// ---- fixtures ----------------------------------------------------------

const NOW = new Date(2026, 9, 19, 12, 0, 0).getTime()
const at = (day: number, h: number, m: number) => new Date(2026, 9, day, h, m, 0).toISOString()

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

const assessJson = (risk: string, reason: string, due: boolean, consumed = false) =>
  JSON.stringify({ schema: 'x', risk, reasons: [{ code: 'sink' }], candidate: { kind: 'k', consumed }, review_due: due, review_due_reason: reason })

// Registers stubs for everything the panel reads. `o` overrides pieces; a function
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
    if (a[0] === 'git' && a.includes('status')) {
      return value(ok('# branch.oid abc1234\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n1 .M N... 1 1 1 a b f\n? new\n'))
    }
    if (a[0] === 'git' && a.includes('rev-parse')) return value(ok('/home/me/proj\n.git\n.git\n'))
    if (a.includes('mode')) return value(ok(JSON.stringify({ mode: o.mode ?? 'on', source: 'default' })))
    if (a.includes('boundary')) return value(ok(JSON.stringify({ commit: 'deadbeef', source: o.boundarySource ?? 'merge-base' })))
    if (a.some((x: string) => x.endsWith('odd-assess'))) {
      const committed = a.includes('--base-ref')
      return value(ok(committed ? (o.committed ?? assessJson('passive', 'passive', false)) : (o.dirty ?? assessJson('passive', 'passive', false))))
    }
    return value({ ...ok(''), exitCode: 1 })
  })
  return seen
}

const PANE = { title: 'Construct', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }

// Mounts the panel and waits for the refresh a session.start starts to land.
async function drawBand($, on, o: any = {}) {
  const seen = world($, on, o)
  await $.session.start({ cwd: '/home/me/proj', source: 'startup' })
  const ui = await $.ui.mount({ plugin: 'construct', surface: 'terminal', component: 'Pane', requestId: 'construct', props: PANE })
  for (let i = 0; i < 40 && !(await leaves(ui)).some((l) => l.text.includes('ODD') || l.text.includes('clear')); i++) {
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
const under = async (ui, key: string) => (await leaves(ui)).filter((l) => l.key === key)

// ---- pure helpers --------------------------------------------------------

test('meterColor uses the theme keys success, warning at 50, and error at 80', async () => {
  expect(meterColor(0)).toBe('success')
  expect(meterColor(49)).toBe('success')
  expect(meterColor(50)).toBe('warning')
  expect(meterColor(79)).toBe('warning')
  expect(meterColor(80)).toBe('error')
  expect(meterColor(100)).toBe('error')
})

test('clampPct floors and clamps, and rejects non-numbers', async () => {
  expect(clampPct(12.9)).toBe(12)
  expect(clampPct(-3)).toBe(0)
  expect(clampPct(250)).toBe(100)
  expect(clampPct('7')).toBe(null)
  expect(clampPct(undefined)).toBe(null)
  expect(clampPct(NaN)).toBe(null)
})

test('bar fills 8 cells proportionally', async () => {
  expect(bar(0)).toEqual({ filled: '', empty: '░░░░░░░░' })
  expect(bar(12)).toEqual({ filled: '', empty: '░░░░░░░░' })
  expect(bar(50)).toEqual({ filled: '████', empty: '░░░░' })
  expect(bar(100)).toEqual({ filled: '████████', empty: '' })
})

test('reset formats: HH:MM for 5h, Day HH:MM for 7d, nothing when past or invalid', async () => {
  expect(formatReset5h(at(19, 14, 5), NOW)).toBe('14:05')
  expect(formatResetWeek(at(23, 9, 30), NOW)).toBe('Fri 09:30')
  expect(formatReset5h(at(19, 11, 0), NOW)).toBe('')
  expect(formatResetWeek(undefined, NOW)).toBe('')
  expect(formatResetWeek('not a date', NOW)).toBe('')
})

test('joinSegments drops empty segments and leaves no stray separator', async () => {
  expect(joinSegments(['a', '', undefined, 'b'])).toEqual(['a', { sep: true }, 'b'])
  expect(joinSegments(['', undefined])).toEqual([])
  expect(joinSegments(['only'])).toEqual(['only'])
})

test('shortDir replaces the home prefix with a tilde', async () => {
  expect(shortDir('/home/me/proj', '/home/me')).toBe('~/proj')
  expect(shortDir('/home/me', '/home/me')).toBe('~')
  expect(shortDir('/srv/x', '/home/me')).toBe('/srv/x')
  expect(shortDir('/home/meow/x', '/home/me')).toBe('/home/meow/x')
})

test('unfinishedCount counts rows whose status is not done or dropped', async () => {
  expect(unfinishedCount(TASKS)).toBe(2)
  expect(unfinishedCount(TASKS.replace('in progress', 'done').replace('pending', 'dropped'))).toBe(0)
  expect(unfinishedCount('# no table here')).toBe(null)
  expect(unfinishedCount('## Tasks\n\n| ID | Task |\n|---|---|\n| T1 | x |\n')).toBe(null)
})

test('activeFeature picks the newest document that still has unfinished tasks', async () => {
  const done = TASKS.replace('in progress', 'done').replace('pending', 'done')
  const docs = [
    { name: 'old.md', mtimeMs: 1, text: TASKS },
    { name: 'new.md', mtimeMs: 9, text: TASKS.replace('pending', 'done') },
    { name: 'newest-done.md', mtimeMs: 10, text: done },
    { name: 'notes.txt', mtimeMs: 11, text: TASKS },
  ]
  expect(activeFeature(docs)).toEqual({ feature: 'new', open: 1 })
  expect(activeFeature([{ name: 'x.md', mtimeMs: 1, text: done }])).toBe(null)
  expect(activeFeature([])).toBe(null)
})

test('parsers read git, rev-parse, mode, boundary and assess output', async () => {
  const git = parseGitStatus('# branch.oid abc1234deadbeef\n# branch.head main\n# branch.upstream o/main\n# branch.ab +2 -1\n1 .M x\n? y\n')
  expect(git).toEqual({ branch: 'main', dirty: 2, ahead: 2, behind: 1, untracked: ['y'] })
  expect(parseGitStatus('# branch.oid abc1234deadbeef\n# branch.head (detached)\n').branch).toBe('abc1234')
  expect(parseGitStatus('')).toBe(null)
  expect(parseRevParse('/r\n/r/.git/worktrees/w\n/r/.git\n')).toEqual({ root: '/r', worktree: 'r' })
  expect(parseRevParse('/r\n.git\n.git\n')).toEqual({ root: '/r', worktree: null })
  expect(parseMode('{"mode":"off","source":"clone"}')).toBe('off')
  expect(parseMode('garbage')).toBe(null)
  expect(parseBoundary('{"commit":"c","source":"receipt"}')).toEqual({ commit: 'c', source: 'receipt' })
  expect(parseBoundary('{"commit":1}')).toBe(null)
  expect(parseAssess(assessJson('high', 'high_risk', true))).toEqual({ due: true, consumed: false, unassessable: false })
  expect(parseAssess(assessJson('high', 'already_reviewed', false, true))).toEqual({ due: false, consumed: true, unassessable: false })
  expect(parseAssess('{"review_due":true,"reasons":[{"code":"unassessable"}]}')).toEqual({ due: false, consumed: false, unassessable: true })
  expect(parseAssess('nope')).toBe(null)
})

test('reviewState: due beats reviewed, reviewed beats clear', async () => {
  expect(reviewState([{ due: true, consumed: false }, { due: false, consumed: true }])).toBe('review due')
  expect(reviewState([{ due: false, consumed: true }, { due: false, consumed: false }])).toBe('reviewed')
  expect(reviewState([{ due: false, consumed: false }])).toBe('clear')
  expect(reviewState([])).toBe(null)
})

// ---- mounted panel --------------------------------------------------------

test('the panel shows the same cards with or without a statusLine', async ($, on) => {
  const { ui } = await drawBand($, on, {
    settings: { statusLine: { type: 'command', command: 'x' } },
    usage: { startedAt: 0, context: { window: 1, percent: 40 }, rateLimits: [] },
  })
  const text = await joined(ui)
  expect(text).toContain('Opus 4 · main')
  expect(text).toContain('ODD · feat')
  expect(text).toContain('T2')
  expect(text).toContain('clear')
  expect(text).toContain('ctx')
  expect(text).toContain('40%')
  expect(text).not.toContain('⎇')
  expect(text).not.toContain('~/proj')
})

test('the main card draws ctx, 5h and 7d from the session usage, and no dir, git or style', async ($, on) => {
  const { ui } = await drawBand($, on, {
    settings: { outputStyle: 'Explanatory' },
    usage: {
      startedAt: 0,
      context: { window: 1_000_000, tokens: 120_000, percent: 12 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 30, resetsAt: at(19, 14, 5) },
        { kind: 'seven_day', percentUsed: 60, resetsAt: at(23, 9, 30) },
      ],
      cost: { usd: 3.5 },
    },
  })
  const text = await joined(ui)
  expect(text).toMatch(/ODD · feat.*T2/)
  for (const w of ['ctx', '12%', '120k/1.0M', '$3.50', '5h', '30%', '7d', '60%', 'Opus 4 · main']) expect(text).toContain(w)
  for (const w of ['~/proj', '⎇', '±2', 'construct:Neutral', 'Explanatory']) expect(text).not.toContain(w)
  expect(text.indexOf('ODD · feat')).toBeGreaterThan(text.indexOf('ctx'))
})

for (const [pct, color] of [[49, 'claude'], [79, 'claude'], [80, 'error']] as const) {
  test(`the ctx gauge at ${pct}% is ${color}`, async ($, on) => {
    const { ui } = await drawBand($, on, { usage: { startedAt: 0, context: { window: 1, percent: pct }, rateLimits: [] } })
    const all = await leaves(ui)
    expect(all.find((l) => l.text.includes('%'))!.text).toContain(`${pct}%`)
    expect(all.find((l) => l.text.startsWith('▰'))!.props.color).toBe(color)
  })
}

// Theme keys documented for custom themes; the panel colors with these so it follows the active theme.
const THEME_KEYS = new Set(['claude', 'text', 'inverseText', 'inactive', 'subtle', 'suggestion', 'permission', 'remember', 'success', 'error', 'warning', 'merged', 'promptBorder', 'planMode', 'autoAccept', 'bashBorder', 'ide', 'fastMode'])

test('every color the panel draws is a theme key, so it follows the active theme', async ($, on) => {
  const { ui } = await drawBand($, on, { committed: assessJson('high', 'high_risk', true) })
  const colors = (await leaves(ui)).map((l) => l.props.color).filter(Boolean)
  expect(colors.length).toBeDefined()
  for (const color of colors) expect(THEME_KEYS.has(color)).toBe(true)
})

test('the panel draws no matrix mark and no inline rail: one element per row', async ($, on) => {
  const { ui } = await drawBand($, on)
  const text = await joined(ui)
  expect(text).not.toContain('▌')
  expect(text).not.toContain('┊')
  expect(text).not.toContain(' │ ')
})

test('a segment whose data is missing is omitted', async ($, on) => {
  const { ui } = await drawBand($, on, { usage: { startedAt: 0, context: { window: 1 }, rateLimits: [{ kind: 'five_hour', percentUsed: 5 }] } })
  expect(await joined(ui)).not.toContain('ctx')
  const text = await joined(ui)
  expect(text).not.toContain('ctx')
  expect(text).not.toContain('7d')
  expect(text).toContain('5h')
  expect(text).not.toContain('↻')
})

test('review due is drawn when the committed range classifies high and is not consumed', async ($, on) => {
  const { ui, seen } = await drawBand($, on, { committed: assessJson('high', 'high_risk', true) })
  expect(await joined(ui)).toContain('review due')
  const committed = seen.find((a) => a.includes('--base-ref'))
  expect(committed).toContain('deadbeef')
  expect(committed).toContain('--committed-only')
})

test('review due is drawn for uncommitted high-risk changes', async ($, on) => {
  const { ui } = await drawBand($, on, { dirty: assessJson('high', 'high_risk', true) })
  expect(await joined(ui)).toContain('review due')
})

test('a clear range reads clear', async ($, on) => {
  const { ui } = await drawBand($, on, {})
  expect(await joined(ui)).toContain('clear')
  expect(await joined(ui)).not.toContain('review due')
})

test('a consumed range reads reviewed', async ($, on) => {
  const { ui } = await drawBand($, on, { committed: assessJson('high', 'already_reviewed', false, true) })
  expect(await joined(ui)).toContain('reviewed')
})

test('a root-source boundary is not assessed', async ($, on) => {
  const { ui, seen } = await drawBand($, on, { boundarySource: 'root', committed: assessJson('high', 'high_risk', true) })
  expect(seen.some((a) => a.includes('--base-ref'))).toBe(false)
  expect(await joined(ui)).not.toContain('review due')
})

test('with the RDD switch off the line says so and nothing is assessed', async ($, on) => {
  const { ui, seen } = await drawBand($, on, { mode: 'off', dirty: assessJson('high', 'high_risk', true) })
  expect(await joined(ui)).not.toContain('REVIEW')
  expect(await joined(ui)).not.toContain('review due')
  expect(seen.some((a) => a.some((x) => x.endsWith('odd-assess')))).toBe(false)
})

test('a failing process draws no git or RDD segments and does not throw', async ($, on) => {
  const { ui } = await drawBand($, on, { fail: true, usage: { startedAt: 0, context: { window: 1, percent: 12 }, rateLimits: [] } })
  expect(await joined(ui)).toContain('ctx')
  const text = await joined(ui)
  expect(text).toContain('ctx')
  expect(text).toContain('Opus 4 · main')
  expect(text).not.toContain('⎇')
  expect(text).not.toContain('REVIEW')
})

test('with a native statusLine and a failing process nothing extra is drawn', async ($, on) => {
  world($, on, { fail: true, settings: { statusLine: { type: 'command', command: 'x' } }, tasks: [] })
  await $.session.start({ cwd: '/home/me/proj', source: 'startup' })
  const ui = await $.ui.mount({ plugin: 'construct', surface: 'terminal', component: 'Pane', requestId: 'construct', props: PANE })
  await new Promise((r) => setTimeout(r, 30))
  await ui.redraw()
  const text = await joined(ui)
  expect(text).toContain('main')
  for (const w of ['ODD ·', 'REVIEW', 'GATE', 'agents ·']) expect(text).not.toContain(w)
})

test('the CLIs are not run on render, only on session.start and turn.complete', async ($, on) => {
  const { ui, seen } = await drawBand($, on, {})
  const after = seen.length
  expect(after).toBeGreaterThan(0)
  await ui.redraw()
  await ui.redraw()
  expect(seen.length).toBe(after)
  await $.turn.complete({ turnId: 't', reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false })
  await new Promise((r) => setTimeout(r, 30))
  expect(seen.length).toBeGreaterThan(after)
})

test('parseGitStatus lists untracked paths and keeps its other fields', async () => {
  const git = parseGitStatus('# branch.oid abc1234deadbeef\n# branch.head main\n# branch.ab +2 -1\n1 .M x\n? new.txt\n? dir/\n? "sp\\"q.txt"\n')
  expect(git).toEqual({ branch: 'main', dirty: 4, ahead: 2, behind: 1, untracked: ['new.txt', 'dir/', 'sp"q.txt'] })
  expect(parseGitStatus('# branch.oid abc\n# branch.head main\n')?.untracked).toEqual([])
  expect(parseGitStatus('# branch.oid abc\n# branch.head main\n? a\u001b[2Jb.txt\n')?.untracked).toEqual(['a[2Jb.txt'])
})

test('parseNumstat reads added and removed lines, binary files, and quoted paths', async () => {
  expect(parseNumstat('12\t3\tsrc/a.js\n0\t4\tb.md\n-\t-\timg.png\n')).toEqual([
    { path: 'src/a.js', added: 12, removed: 3, binary: false },
    { path: 'b.md', added: 0, removed: 4, binary: false },
    { path: 'img.png', added: null, removed: null, binary: true },
  ])
  expect(parseNumstat('1\t1\t"a b\\"c.txt"\n')).toEqual([{ path: 'a b"c.txt', added: 1, removed: 1, binary: false }])
  expect(parseNumstat('1\t2\tdir/with\ttab.txt\n')[0].path).toBe('dir/with\ttab.txt'.replace('\t', ''))
  expect(parseNumstat('')).toEqual([])
  expect(parseNumstat(undefined)).toEqual([])
  expect(parseNumstat('garbage\n\nx\ty\tz\n')).toEqual([])
})
