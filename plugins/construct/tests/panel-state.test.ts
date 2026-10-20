import { expect, test } from 'claude-code/testing'
import {
  SCHEMA_VERSION,
  agentsView,
  initialState,
  isOutsideTasks,
  maskSecrets,
  merge,
  onAgentSpawn,
  onCompact,
  onToolCall,
  onToolCheck,
  onTurnComplete,
  onTurnStart,
  onTurnStep,
} from '../hooks/panel/state.js'

const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 200, cache_creation_input_tokens: 30, model: 'm' }
const spawn = (s: any, id: any, extra: any = {}) =>
  onAgentSpawn(s, { agentId: id, subagentType: 'construct:odd-worker', description: 'd', model: 'sonnet', effort: 'high', nowMs: 1000, ...extra })

// ---- init / merge ------------------------------------------------------

test('initialState carries the schema version and empty sections', () => {
  const s = initialState()
  expect(s.v).toBe(SCHEMA_VERSION)
  expect(s.agents).toEqual([])
  expect(s.inline).toEqual({ count: 0, last: null })
  expect(s.gate.denied).toBe(0)
  expect(s.receipt).toBe(null)
  expect(s.compactions).toBe(0)
})

test('merge keeps a valid stored value over defaults', () => {
  const stored = { ...initialState(), compactions: 3 }
  expect(merge(stored).compactions).toBe(3)
  expect(merge({ v: SCHEMA_VERSION, compactions: 2 }).gate.cells).toEqual([])
})

test('merge returns defaults on a version change or a malformed value', () => {
  expect(merge({ ...initialState(), v: SCHEMA_VERSION + 1, compactions: 9 })).toEqual(initialState())
  for (const bad of [null, undefined, 5, 'x', [], { v: SCHEMA_VERSION, agents: 'no' }, { v: SCHEMA_VERSION, gate: 3 }]) {
    expect(merge(bad)).toEqual(initialState())
  }
})

// ---- S2 agents ---------------------------------------------------------

test('spawn adds a running card with the construct role', () => {
  const s = spawn(initialState(), 'a1')
  expect(s.agents).toEqual([
    { id: 'a1', role: 'odd_worker', type: 'construct:odd-worker', description: 'd', model: 'sonnet', effort: 'high', ctx: 0, steps: 0, startedMs: 1000, endedMs: null, status: 'running' },
  ])
})

test('a non-construct subagent type is its own role; a missing id is ignored', () => {
  expect(spawn(initialState(), 'a1', { subagentType: 'Explore' }).agents[0].role).toBe('Explore')
  expect(spawn(initialState(), undefined).agents).toEqual([])
  expect(spawn(initialState(), 'a1', { model: undefined, effort: undefined }).agents[0].model).toBe(null)
})

test('turn.step counts steps and sets ctx to the whole input of the latest request', () => {
  let s = spawn(initialState(), 'a1')
  s = onTurnStep(s, { agentId: 'a1', usage: USAGE })
  expect(s.agents[0].steps).toBe(1)
  expect(s.agents[0].ctx).toBe(240)
  s = onTurnStep(s, { agentId: 'a1', usage: { ...USAGE, input_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 1 } })
  expect(s.agents[0]).toMatchObject({ steps: 2, ctx: 3 })
  // no usage: steps still count, ctx stays
  s = onTurnStep(s, { agentId: 'a1', usage: null })
  expect(s.agents[0]).toMatchObject({ steps: 3, ctx: 3 })
})

test('turn.step on the main loop or an unknown agent changes nothing', () => {
  const s = spawn(initialState(), 'a1')
  expect(onTurnStep(s, { agentId: undefined, usage: USAGE })).toEqual(s)
  expect(onTurnStep(s, { agentId: 'zz', usage: USAGE })).toEqual(s)
})

test('turn.complete of an agent marks it done; turn.start of it runs it again', () => {
  let s = spawn(initialState(), 'a1')
  s = onTurnComplete(s, { agentId: 'a1', nowMs: 5000 })
  expect(s.agents[0]).toMatchObject({ status: 'done', endedMs: 5000 })
  s = onTurnStart(s, { agentId: 'a1', nowMs: 6000 })
  expect(s.agents[0]).toMatchObject({ status: 'running', endedMs: null })
})

test('reducers are immutable', () => {
  const s0 = initialState()
  const s1 = spawn(s0, 'a1')
  expect(s0.agents).toEqual([])
  const frozen = JSON.stringify(s1)
  onTurnStep(s1, { agentId: 'a1', usage: USAGE })
  expect(JSON.stringify(s1)).toBe(frozen)
})

test('stored agents are capped at the latest 20', () => {
  let s = initialState()
  for (let i = 0; i < 25; i++) s = spawn(s, `a${i}`)
  expect(s.agents.length).toBe(20)
  expect(s.agents[0].id).toBe('a5')
})

test('agentsView lists running cards first, then the most recent, with the rest counted', () => {
  let s = initialState()
  for (let i = 0; i < 5; i++) s = spawn(s, `a${i}`, { nowMs: 100 + i })
  s = onTurnComplete(s, { agentId: 'a0', nowMs: 200 })
  s = onTurnComplete(s, { agentId: 'a4', nowMs: 201 })
  const v = agentsView(s, 300)
  expect(v.cards.map((c: any) => c.id)).toEqual(['a3', 'a2', 'a1'])
  expect(v.rest).toBe(2)
  expect(v.running).toBe(3)
  expect(agentsView(s, 300, 4).cards.map((c: any) => c.id)).toEqual(['a3', 'a2', 'a1', 'a4'])
})

test('agentsView gives elapsed time from now for running and from end for done', () => {
  let s = spawn(initialState(), 'a1', { nowMs: 1000 })
  expect(agentsView(s, 4000).cards[0].elapsedMs).toBe(3000)
  s = onTurnComplete(s, { agentId: 'a1', nowMs: 2500 })
  expect(agentsView(s, 9000).cards[0].elapsedMs).toBe(1500)
  expect(agentsView(initialState(), 1)).toEqual({ cards: [], rest: 0, running: 0 })
})

// ---- S3 inline writes --------------------------------------------------

test('isOutsideTasks handles absolute, relative and odd/tasks paths', () => {
  expect(isOutsideTasks('/repo/src/a.js', '/repo')).toBe(true)
  expect(isOutsideTasks('src/a.js', '/repo')).toBe(true)
  expect(isOutsideTasks('/repo/odd/tasks/x.md', '/repo')).toBe(false)
  expect(isOutsideTasks('odd/tasks/x.md', '/repo')).toBe(false)
  expect(isOutsideTasks('./odd/tasks/x.md', '/repo')).toBe(false)
  expect(isOutsideTasks('/repo/odd/tasks', '/repo')).toBe(false)
  expect(isOutsideTasks('/repo/odd/tasksx/a.md', '/repo')).toBe(true)
  expect(isOutsideTasks('/other/odd/tasks/x.md', '/repo')).toBe(true)
  expect(isOutsideTasks('/repo/sub/../odd/tasks/x.md', '/repo')).toBe(false)
  expect(isOutsideTasks('', '/repo')).toBe(false)
  expect(isOutsideTasks(undefined, '/repo')).toBe(false)
})

test('a main-thread write outside odd/tasks counts as inline', () => {
  let s = initialState()
  s = onToolCall(s, { tool: 'Edit', path: '/repo/src/a.js', cwd: '/repo' })
  s = onToolCall(s, { tool: 'NotebookEdit', path: 'n.ipynb', cwd: '/repo' })
  expect(s.inline).toEqual({ count: 2, last: 'n.ipynb' })
  for (const tool of ['Write', 'MultiEdit']) s = onToolCall(s, { tool, path: 'b.js', cwd: '/repo' })
  expect(s.inline.count).toBe(4)
})

test('odd/tasks writes, reads and subagent writes are not inline', () => {
  let s = initialState()
  s = onToolCall(s, { tool: 'Write', path: '/repo/odd/tasks/f.md', cwd: '/repo' })
  s = onToolCall(s, { tool: 'Read', path: 'a.js', cwd: '/repo' })
  s = onToolCall(s, { tool: 'Bash', path: undefined, cwd: '/repo' })
  s = onToolCall(s, { tool: 'Edit', path: 'a.js', agentId: 'a1', cwd: '/repo' })
  expect(s.inline).toEqual({ count: 0, last: null })
})

// ---- S4 gate -----------------------------------------------------------

test('each tool.check verdict adds a cell; a subagent verdict is sub', () => {
  let s = initialState()
  s = onToolCheck(s, { tool: 'Read', decision: 'allow' })
  s = onToolCheck(s, { tool: 'Bash', decision: 'ask' })
  s = onToolCheck(s, { tool: 'Bash', decision: 'deny', input: { command: 'rm -rf x' } })
  s = onToolCheck(s, { tool: 'Edit', decision: 'allow', agentId: 'a1' })
  expect(s.gate.cells).toEqual(['allowed', 'asked', 'denied', 'sub'])
  expect(s.gate.counts).toEqual({ allowed: 1, asked: 1, denied: 1, sub: 1 })
  expect(s.gate.denied).toBe(1)
  expect(s.gate.lastDenied).toEqual({ tool: 'Bash', detail: 'rm -rf x' })
})

test('onToolCheck ignores a query that carries no tool_use_id when the wiring flags it', () => {
  const s = onToolCheck(initialState(), { tool: 'Bash', decision: 'deny', input: { command: 'x' }, isQuery: true })
  expect(s.gate.cells).toEqual([])
  expect(s.gate.denied).toBe(0)
})

test('a denied verdict inside a subagent is still a deny', () => {
  const s = onToolCheck(initialState(), { tool: 'Bash', decision: 'deny', agentId: 'a1', input: { command: 'x' } })
  expect(s.gate.denied).toBe(1)
  expect(s.gate.cells).toEqual(['sub'])
})

test('cells are capped at 60 while totals keep counting', () => {
  let s = initialState()
  for (let i = 0; i < 75; i++) s = onToolCheck(s, { tool: 'Read', decision: 'allow' })
  expect(s.gate.cells.length).toBe(60)
  expect(s.gate.counts.allowed).toBe(75)
})

test('the denied detail is masked and short', () => {
  const s = onToolCheck(initialState(), {
    tool: 'Bash',
    decision: 'deny',
    input: { command: 'curl -H "Authorization: Bearer abc123def456" https://x.io?password=hunter2 ' + 'z'.repeat(200) },
  })
  const d = s.gate.lastDenied.detail
  expect(d).not.toContain('abc123def456')
  expect(d).not.toContain('hunter2')
  expect(d.length <= 80).toBe(true)
})

test('detail falls back to file_path, then to empty', () => {
  expect(onToolCheck(initialState(), { tool: 'Edit', decision: 'deny', input: { file_path: '/a/creds.txt' } }).gate.lastDenied.detail).toBe('/a/creds.txt')
  expect(onToolCheck(initialState(), { tool: 'Edit', decision: 'deny', input: 7 }).gate.lastDenied.detail).toBe('')
})

test('maskSecrets masks credential-like values and keeps plain text', () => {
  expect(maskSecrets('token=abc123 ok')).toBe('token=*** ok')
  expect(maskSecrets('API_KEY: "s3cr3t"')).not.toContain('s3cr3t')
  expect(maskSecrets('password=hunter2&x=1')).toBe('password=***&x=1')
  expect(maskSecrets('Authorization: Bearer abc.def-123')).toBe('Authorization: Bearer ***')
  expect(maskSecrets('sk-ant-api03-AbCdEfGhIjKlMnOp')).toBe('***')
  expect(maskSecrets('ghp_' + 'a'.repeat(30))).toBe('***')
  expect(maskSecrets('x ' + 'a1b2c3d4'.repeat(6) + ' y')).toBe('x *** y')
  expect(maskSecrets('git status --short')).toBe('git status --short')
  expect(maskSecrets(undefined as any)).toBe('')
})

test('maskSecrets masks Basic auth, URL userinfo, CLI passwords, cloud keys and glpat tokens', () => {
  const cases: [string, string][] = [
    ['Authorization: Basic dXNlcjpwYXNzd29yZA==', 'dXNlcjpwYXNzd29yZA'],
    ['psql postgres://user:hunter2pass@host/db', 'hunter2pass'],
    ['curl -u admin:s3cr3tP@ss https://x', 's3cr3tP@ss'],
    ['mysql -u root -phunter2 db', 'hunter2'],
    ['aws_access_key_id AKIAIOSFODNN7EXAMPLE', 'AKIAIOSFODNN7EXAMPLE'],
    ['echo ASIAIOSFODNN7EXAMPLE', 'ASIAIOSFODNN7EXAMPLE'],
    ['echo wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'wJalrXUtnFEMI'],
    ['glpat-' + 'x'.repeat(20), 'xxxxxxxx'],
  ]
  for (const [input, secret] of cases) expect(maskSecrets(input)).not.toContain(secret)
  expect(maskSecrets('psql postgres://user:hunter2pass@host/db')).toContain('host/db')
  expect(maskSecrets('mysql -u root -phunter2 db')).toContain('mysql -u root')
  expect(maskSecrets('ls /Users/me/Desktop/odd_skills/plugins/construct/hooks/panel')).toBe('ls /Users/me/Desktop/odd_skills/plugins/construct/hooks/panel')
  expect(maskSecrets('curl https://example.com/a/b?x=1')).toBe('curl https://example.com/a/b?x=1')
})

// ---- S5 receipt --------------------------------------------------------

test('a main turn opens a receipt and completing it fixes duration and cost added', () => {
  let s = onTurnStart(initialState(), { turnId: 't1', nowMs: 1000, cost: 1.5 })
  expect(s.receipt).toMatchObject({ turnId: 't1', startedMs: 1000, endedMs: null, agents: 0, edits: 0, errors: 0, cost: null })
  s = spawn(s, 'a1')
  s = onToolCall(s, { tool: 'Edit', path: 'a.js', cwd: '/r' })
  s = onToolCall(s, { tool: 'Write', path: 'b.js', agentId: 'a1', cwd: '/r' })
  s = onToolCall(s, { tool: 'Bash', isError: true })
  s = onToolCall(s, { tool: 'Read', isError: false })
  s = onTurnComplete(s, { turnId: 't1', nowMs: 4000, cost: 2.0 })
  expect(s.receipt).toMatchObject({ endedMs: 4000, agents: 1, edits: 2, errors: 1, cost: 0.5 })
})

test('a new main turn replaces the receipt; subagent turns do not', () => {
  let s = onTurnStart(initialState(), { turnId: 't1', nowMs: 1, cost: 0 })
  s = onTurnStart(s, { turnId: 'x', agentId: 'a1', nowMs: 2, cost: 0 })
  expect(s.receipt.turnId).toBe('t1')
  s = onTurnComplete(s, { turnId: 'x', agentId: 'a1', nowMs: 3, cost: 9 })
  expect(s.receipt.endedMs).toBe(null)
  s = onTurnStart(s, { turnId: 't2', nowMs: 10, cost: 0 })
  expect(s.receipt).toMatchObject({ turnId: 't2', edits: 0 })
})

test('cost is null when a number is missing and never negative', () => {
  let s = onTurnStart(initialState(), { turnId: 't', nowMs: 1 })
  s = onTurnComplete(s, { turnId: 't', nowMs: 2, cost: 1 })
  expect(s.receipt.cost).toBe(null)
  s = onTurnStart(s, { turnId: 't', nowMs: 1, cost: 5 })
  s = onTurnComplete(s, { turnId: 't', nowMs: 2, cost: 3 })
  expect(s.receipt.cost).toBe(0)
})

test('events after the receipt closed do not change it; complete with no start is safe', () => {
  let s = onTurnComplete(initialState(), { turnId: 't', nowMs: 2, cost: 1 })
  expect(s.receipt).toBe(null)
  s = onTurnStart(s, { turnId: 't', nowMs: 1, cost: 0 })
  s = onTurnComplete(s, { turnId: 't', nowMs: 2, cost: 1 })
  s = onToolCall(s, { tool: 'Edit', path: 'a.js', cwd: '/r' })
  expect(s.receipt.edits).toBe(0)
  expect(s.inline.count).toBe(1)
})

test('compactions are counted', () => {
  expect(onCompact(onCompact(initialState())).compactions).toBe(2)
})

// ---- odd input ---------------------------------------------------------

test('odd input never throws', () => {
  const odd: any[] = [undefined, null, 5, 'x', [], {}, { agentId: 5 }, { usage: 'no' }, { tool: {}, path: 3, decision: 9, input: null }]
  const reducers: any[] = [onAgentSpawn, onTurnStep, onTurnStart, onTurnComplete, onToolCall, onToolCheck]
  for (const r of reducers) {
    for (const e of odd) {
      for (const st of [initialState(), null, undefined, {}, 7]) {
        const out = r(st as any, e)
        expect(typeof out).toBe('object')
        expect(out.v).toBe(SCHEMA_VERSION)
      }
    }
  }
  expect(onCompact(null as any).compactions).toBe(1)
  expect(agentsView(null as any, NaN)).toEqual({ cards: [], rest: 0, running: 0 })
  expect(isOutsideTasks(5 as any, null as any)).toBe(false)
  expect(maskSecrets(5 as any)).toBe('')
})
