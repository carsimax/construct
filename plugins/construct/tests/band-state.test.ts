import { expect, test } from 'claude-code/testing'
import {
  SCHEMA_VERSION,
  agentsView,
  initialState,
  isBlockingTool,
  isOutsideTasks,
  merge,
  mainBusy,
  onAgentSpawn,
  onBlocked,
  onUnblocked,
  onToolSettle,
  bucketOf,
  onToolCall,
  onToolCheck,
  onTurnComplete,
  onTurnStart,
  phaseOf,
  shortName,
} from '../hooks/band/state.js'

const spawn = (s: any, id: any, extra: any = {}) =>
  onAgentSpawn(s, { agentId: id, subagentType: 'construct:worker', description: 'd', model: 'sonnet', nowMs: 1000, ...extra })

// ---- init / merge ------------------------------------------------------

test('initialState carries the schema version and empty sections', () => {
  const s = initialState()
  expect(s.v).toBe(SCHEMA_VERSION)
  expect(s.agents).toEqual([])
  expect(s.inline).toEqual({ count: 0 })
  expect(s.gate).toEqual({ verdicts: { rule: 0, ask: 0, cleared: 0, deny: 0 }, pending: {} })
  expect(s.turn).toBe(null)
  expect('receipt' in s).toBe(false)
})

test('merge keeps a valid stored value over defaults', () => {
  const stored = { ...initialState(), inline: { count: 3 } }
  expect(merge(stored).inline.count).toBe(3)
  // a path stored by an older version is dropped
  expect(merge({ ...initialState(), inline: { count: 1, last: 'a' } }).inline).toEqual({ count: 1 })
  expect(merge({ v: SCHEMA_VERSION, inline: { count: 2 } }).gate.pending).toEqual({})
})

test('merge returns defaults on a version change or a malformed value', () => {
  expect(merge({ ...initialState(), v: SCHEMA_VERSION + 1, blocked: true })).toEqual(initialState())
  for (const bad of [null, undefined, 5, 'x', [], { v: SCHEMA_VERSION, agents: 'no' }, { v: SCHEMA_VERSION, gate: 3 }]) {
    expect(merge(bad)).toEqual(initialState())
  }
})

// ---- S2 agents ---------------------------------------------------------

test('spawn adds a running card with the construct role', () => {
  const s = spawn(initialState(), 'a1')
  expect(s.agents).toEqual([
    { id: 'a1', role: 'worker', type: 'construct:worker', description: 'd', model: 'sonnet', startedMs: 1000, endedMs: null, status: 'running' },
  ])
})

test('a non-construct subagent type is its own role; a missing id is ignored', () => {
  expect(spawn(initialState(), 'a1', { subagentType: 'Explore' }).agents[0].role).toBe('Explore')
  expect(spawn(initialState(), undefined).agents).toEqual([])
  expect(spawn(initialState(), 'a1', { model: undefined }).agents[0].model).toBe(null)
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
  onTurnComplete(s1, { agentId: 'a1', nowMs: 5 })
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
  expect(s.inline).toEqual({ count: 2 })
  for (const tool of ['Write', 'MultiEdit']) s = onToolCall(s, { tool, path: 'b.js', cwd: '/repo' })
  expect(s.inline.count).toBe(4)
})

test('odd/tasks writes, reads and subagent writes are not inline', () => {
  let s = initialState()
  s = onToolCall(s, { tool: 'Write', path: '/repo/odd/tasks/f.md', cwd: '/repo' })
  s = onToolCall(s, { tool: 'Read', path: 'a.js', cwd: '/repo' })
  s = onToolCall(s, { tool: 'Bash', path: undefined, cwd: '/repo' })
  s = onToolCall(s, { tool: 'Edit', path: 'a.js', agentId: 'a1', cwd: '/repo' })
  expect(s.inline).toEqual({ count: 0 })
})

// ---- S4 gate -----------------------------------------------------------

test('onToolCheck ignores a query that carries no tool_use_id when the wiring flags it', () => {
  const s = onToolCheck(initialState(), { tool: 'Bash', decision: 'deny', isQuery: true })
  expect(s.gate.verdicts).toEqual({ rule: 0, ask: 0, cleared: 0, deny: 0 })
})

test('a denied verdict inside a subagent is still a deny', () => {
  expect(onToolCheck(initialState(), { tool: 'Bash', decision: 'deny', agentId: 'a1' }).gate.verdicts.deny).toBe(1)
})

// ---- main turn busy flag (the receipt is gone) ---------------------------

test('a main turn marks the band busy and completing it clears the flag; no receipt is kept', () => {
  let s = onTurnStart(initialState(), { turnId: 't1', nowMs: 1000 })
  expect(s.turn).toEqual({ turnId: 't1' })
  expect('receipt' in s).toBe(false)
  s = spawn(s, 'a1')
  s = onToolCall(s, { tool: 'Edit', path: 'a.js', cwd: '/r' })
  s = onTurnComplete(s, { turnId: 't1', nowMs: 4000 })
  expect(s.turn).toBe(null)
  expect('receipt' in s).toBe(false)
  expect(s.inline.count).toBe(1)
})

test('subagent turns do not touch the busy flag; a turn id mismatch does not close it', () => {
  let s = onTurnStart(initialState(), { turnId: 't1', nowMs: 1 })
  s = spawn(s, 'a1')
  s = onTurnComplete(s, { turnId: 'x', agentId: 'a1', nowMs: 3 })
  expect(s.turn).toEqual({ turnId: 't1' })
  expect(s.agents[0]).toMatchObject({ status: 'done', endedMs: 3 })
  s = onTurnStart(s, { turnId: 'x', agentId: 'a1', nowMs: 4 })
  expect(s.agents[0]).toMatchObject({ status: 'running', endedMs: null })
  expect(onTurnComplete(s, { turnId: 'other', nowMs: 5 }).turn).toEqual({ turnId: 't1' })
  expect(onTurnComplete(s, { turnId: 't1', nowMs: 5 }).turn).toBe(null)
})

test('complete with no start is safe, and merge drops a stored receipt', () => {
  expect(onTurnComplete(initialState(), { turnId: 't', nowMs: 2 }).turn).toBe(null)
  const old: any = { ...initialState(), receipt: { turnId: 't', startedMs: 1, endedMs: null, agents: 0, edits: 0, errors: 0 } }
  const m: any = merge(old)
  expect('receipt' in m).toBe(false)
  expect(mainBusy(m)).toBe(false)
  expect(merge({ ...initialState(), turn: 3 })).toEqual(initialState())
})

// ---- odd input ---------------------------------------------------------

test('odd input never throws', () => {
  const odd: any[] = [undefined, null, 5, 'x', [], {}, { agentId: 5 }, { usage: 'no' }, { tool: {}, path: 3, decision: 9, input: null }]
  const reducers: any[] = [onAgentSpawn, onTurnStart, onTurnComplete, onToolCall, onToolCheck]
  for (const r of reducers) {
    for (const e of odd) {
      for (const st of [initialState(), null, undefined, {}, 7]) {
        const out = r(st as any, e)
        expect(typeof out).toBe('object')
        expect(out.v).toBe(SCHEMA_VERSION)
      }
    }
  }
  expect(agentsView(null as any, NaN)).toEqual({ cards: [], rest: 0, running: 0 })
  expect(isOutsideTasks(5 as any, null as any)).toBe(false)
})

// ---- S3 main vitals ------------------------------------------------------

test('mainBusy is true only while a main turn is open', () => {
  expect(mainBusy(initialState())).toBe(false)
  const open = onTurnStart(initialState(), { turnId: 't', nowMs: 1 })
  expect(mainBusy(open)).toBe(true)
  expect(mainBusy(onTurnComplete(open, { turnId: 't', nowMs: 2 }))).toBe(false)
  expect(mainBusy(null)).toBe(false)
})

// ---- S6 gate by decider and bucket ---------------------------------------

test('bucketOf sorts tools into file, shell and other', () => {
  expect(['Read', 'Edit', 'Write', 'NotebookEdit', 'Glob', 'Grep'].map(bucketOf)).toEqual(Array(6).fill('file'))
  expect(['Bash', 'PowerShell'].map(bucketOf)).toEqual(['shell', 'shell'])
  expect(['WebFetch', 'mcp__x__y', undefined].map(bucketOf as any)).toEqual(['other', 'other', 'other'])
})

test('verdicts count per decider, a subagent verdict included', () => {
  let s = initialState()
  s = onToolCheck(s, { tool: 'Read', decision: 'allow' })
  s = onToolCheck(s, { tool: 'Bash', decision: 'ask' })
  s = onToolCheck(s, { tool: 'Bash', decision: 'deny' })
  s = onToolCheck(s, { tool: 'WebFetch', decision: 'allow', agentId: 'a1' })
  expect(s.gate.verdicts).toEqual({ rule: 2, ask: 1, cleared: 0, deny: 1 })
})

test('a query adds no verdict', () => {
  const s = onToolCheck(initialState(), { tool: 'Read', decision: 'allow', isQuery: true })
  expect(s.gate.verdicts).toEqual({ rule: 0, ask: 0, cleared: 0, deny: 0 })
})

test('an ask settles as cleared when the call ran and as deny when it did not', () => {
  let s = onToolCheck(onToolCheck(initialState(), { tool: 'Bash', decision: 'ask' }), { tool: 'Bash', decision: 'ask' })
  s = onToolSettle(s, { tool: 'Bash', didRun: true })
  expect(s.gate.verdicts).toMatchObject({ ask: 1, cleared: 1, deny: 0 })
  s = onToolSettle(s, { tool: 'Bash', didRun: false })
  expect(s.gate.verdicts).toMatchObject({ ask: 0, cleared: 1, deny: 1 })
  // nothing pending: unchanged
  expect(onToolSettle(s, { tool: 'Bash', didRun: true })).toEqual(s)
  expect(onToolSettle(s, { tool: 'Read', didRun: true })).toEqual(s)
})

test('an ask settles by its call id: a run of another call in the same bucket does not clear it', () => {
  let s = onToolCheck(initialState(), { tool: 'Bash', decision: 'ask', callId: 'rm1' })
  s = onToolCheck(s, { tool: 'Bash', decision: 'allow', callId: 'ls1' })
  s = onToolSettle(s, { tool: 'Bash', didRun: true, callId: 'ls1' })
  expect(s.gate.verdicts).toMatchObject({ rule: 1, ask: 1, cleared: 0, deny: 0 })
  s = onToolSettle(s, { tool: 'Bash', didRun: false, callId: 'rm1' })
  expect(s.gate.verdicts).toMatchObject({ rule: 1, ask: 0, cleared: 0, deny: 1 })
  // settled once: a repeat changes nothing
  expect(onToolSettle(s, { tool: 'Bash', didRun: true, callId: 'rm1' })).toEqual(s)
})

test('an ask with a call id clears by that id; without an id the bucket fallback still works', () => {
  let s = onToolCheck(initialState(), { tool: 'Bash', decision: 'ask', callId: 'a' })
  s = onToolSettle(s, { tool: 'Bash', didRun: true, callId: 'a' })
  expect(s.gate.verdicts).toMatchObject({ ask: 0, cleared: 1 })
  s = onToolCheck(s, { tool: 'Bash', decision: 'ask' })
  s = onToolSettle(s, { tool: 'Bash', didRun: true })
  expect(s.gate.verdicts).toMatchObject({ ask: 0, cleared: 2 })
})

test('merge drops the fields outside the schema', () => {
  const old: any = { ...initialState(), inline: { count: 1, last: 'a' }, gate: { cells: ['allowed'], verdicts: { rule: 1 }, lastDenied: null }, receipt: null, compactions: 2, main: {} }
  const m: any = merge(old)
  expect(m.inline).toEqual({ count: 1 })
  expect(m.gate).toEqual({ verdicts: { rule: 1, ask: 0, cleared: 0, deny: 0 }, pending: {} })
  for (const k of ['main', 'compactions', 'receipt', 'log']) expect(k in m).toBe(false)
})

test('the schema is version 1 and any other version resets', () => {
  expect(SCHEMA_VERSION).toBe(1)
  for (const v of [0, 2, 3, '1']) expect(merge({ ...initialState(), v, inline: { count: 4 } })).toEqual(initialState())
})

test('spawn, done, denied and inline write no longer touch a log', () => {
  let s: any = spawn(initialState(), 'a1', { nowMs: 1000 })
  s = onTurnComplete(s, { agentId: 'a1', nowMs: 66000 })
  s = onToolCheck(s, { tool: 'Bash', decision: 'deny', input: { command: 'x' }, nowMs: 7 })
  s = onToolCall(s, { tool: 'Edit', path: '/p/src/a.ts', cwd: '/p', nowMs: 9 })
  expect('log' in s).toBe(false)
  expect(s.inline).toEqual({ count: 1 })
})

// ---- S8b blocked state -------------------------------------------------

test('initialState is not blocked and merge defaults a stored value without the field', () => {
  expect(initialState().blocked).toBe(false)
  const { blocked, ...old } = initialState()
  expect(merge(old).blocked).toBe(false)
  expect(merge({ ...initialState(), blocked: 'yes' }).blocked).toBe(false)
})

test('AskUserQuestion and ExitPlanMode are the blocking tools', () => {
  expect(isBlockingTool('AskUserQuestion')).toBe(true)
  expect(isBlockingTool('ExitPlanMode')).toBe(true)
  for (const t of ['Bash', 'Read', 'askuserquestion', '', undefined]) expect(isBlockingTool(t as any)).toBe(false)
})

test('onBlocked sets and onUnblocked clears the flag, both idempotent and leaving the rest alone', () => {
  const s = onTurnStart(initialState(), { agentId: undefined, turnId: 't1', nowMs: 5 })
  const b = onBlocked(s)
  expect(b.blocked).toBe(true)
  expect(onBlocked(b)).toEqual(b)
  const c = onUnblocked(b)
  expect(c.blocked).toBe(false)
  expect(c).toEqual(s)
  expect(onUnblocked(s)).toEqual(s)
})

// ---- phaseOf (S5) ----

const phaseFor = (...types: string[]) => phaseOf(types.reduce((s: any, t, i) => spawn(s, `p${i}`, { subagentType: t }), initialState()))

test('phaseOf maps the running roles to a phase', () => {
  expect(phaseFor('construct:verifier')).toBe('verifying')
  expect(phaseFor('construct:review-risk')).toBe('reviewing')
  expect(phaseFor('construct:judge-a')).toBe('reviewing')
  expect(phaseFor('construct:worker')).toBe('implementing')
  expect(phaseFor('construct:explorer')).toBe('exploring')
  expect(phaseFor('general-purpose')).toBe('working')
})

test('phaseOf picks verifying > reviewing > implementing > exploring > working', () => {
  expect(phaseFor('general-purpose', 'construct:explorer')).toBe('exploring')
  expect(phaseFor('construct:explorer', 'construct:worker')).toBe('implementing')
  expect(phaseFor('construct:worker', 'construct:review-risk')).toBe('reviewing')
  expect(phaseFor('construct:review-risk', 'construct:verifier', 'construct:worker')).toBe('verifying')
})

test('phaseOf is null with no agents or only done agents, and ignores odd input', () => {
  expect(phaseOf(initialState())).toBe(null)
  const done = onTurnComplete(spawn(initialState(), 'a'), { agentId: 'a', nowMs: 2 })
  expect(phaseOf(done)).toBe(null)
  expect(phaseOf(null as any)).toBe(null)
})

test('a main turn start keeps its start time; a stored turn without one is read as is', () => {
  expect(onTurnStart(initialState(), { turnId: 't1' }).turn).toEqual({ turnId: 't1' })
  const old: any = { ...initialState(), turn: { turnId: 't9' } }
  expect(merge(old).turn).toEqual({ turnId: 't9' })
  expect(onTurnComplete(old, { turnId: 't9', nowMs: 5 }).turn).toBe(null)
})

// ---- L4 regressions ----------------------------------------------------

test('MultiEdit and NotebookEdit are file tools', () => {
  expect(bucketOf('MultiEdit')).toBe('file')
  expect(bucketOf('NotebookEdit')).toBe('file')
})

test('agentsView keeps every running agent, then the most recently ended', () => {
  let s: any = initialState()
  const ends = [50, 90, 10, 70, 30, 80]
  ends.forEach((end, i) => {
    s = spawn(s, `d${i}`, { nowMs: 100 + i })
    s = onTurnComplete(s, { agentId: `d${i}`, nowMs: end + 100 })
  })
  s = spawn(s, 'r1', { nowMs: 1 })
  s = spawn(s, 'r2', { nowMs: 2 })
  const ids = agentsView(s, 1000, 6).cards.map((c: any) => c.id).sort()
  expect(ids).toEqual(['d1', 'd3', 'd5', 'd0', 'r1', 'r2'].sort())
})

test('a duplicate spawn id replaces the card; naming falls back and normalizes', () => {
  let s = spawn(initialState(), 'a1')
  s = spawn(s, 'a1', { description: 'again' })
  expect(s.agents.length).toBe(1)
  expect(s.agents[0].description).toBe('again')
  expect(agentsView(spawn(initialState(), 'a2', { subagentType: undefined }), 0).cards[0].name).toBe('agent')
  expect(shortName('my_agent')).toBe('my-agent')
  expect(shortName('construct:unknown_x')).toBe('unknown-x')
  expect(shortName({ type: 'construct:worker' })).toBe('worker')
})

test('a main turn without an id ends on a completion with one', () => {
  let s = onTurnStart(initialState(), {})
  expect(mainBusy(s)).toBe(true)
  s = onTurnComplete(s, { turnId: 't1' })
  expect(mainBusy(s)).toBe(false)
})

test('damaged nested stored shapes are repaired and no reducer throws', () => {
  const damaged = {
    v: SCHEMA_VERSION,
    agents: [null, { id: 'a1', status: 'running' }],
    gate: { verdicts: { rule: 'z' }, pending: 'p' },
  }
  let s: any = merge(damaged)
  s = onToolCheck(s, { decision: 'ask', tool: 'Bash', callId: 'c1' })
  s = onToolSettle(s, { callId: 'c1', tool: 'Bash', didRun: true })
  s = onToolCheck(s, { decision: 'allow', tool: 'Read' })
  s = onTurnStart(s, { agentId: 'a1' })
  const view = agentsView(s, 5)
  expect(view.cards.length).toBe(1)
  expect(Number.isFinite(view.cards[0].elapsedMs)).toBe(true)
  expect(s.gate.verdicts).toEqual({ rule: 1, ask: 0, cleared: 1, deny: 0 })
})

test('a damaged value is repaired by every reducer and selector (L10)', () => {
  const bad: any = { ...initialState(), gate: { verdicts: 'x' }, agents: [null] }
  const finite = (s: any) => {
    for (const v of Object.values(s.gate.verdicts)) expect(Number.isFinite(v)).toBe(true)
  }
  finite(onToolCheck(bad, { decision: 'ask', tool: 'Bash', callId: 'c' }))
  finite(onToolSettle({ ...bad, gate: { ...bad.gate, pending: { c: 'file' } } }, { callId: 'c', tool: 'Read', didRun: true }))
  expect(() => onTurnStart(bad, { agentId: 'a' })).not.toThrow()
  expect(agentsView(bad, 5).cards).toEqual([])
})

test('damaged state: counts stay at or above 0, an unknown pending bucket and odd agents do not throw (L9)', () => {
  const s0: any = merge({ v: SCHEMA_VERSION, gate: { pending: { c1: 'file', c2: 'weird' } } })
  const s1 = onToolSettle(s0, { callId: 'c1', tool: 'Read', didRun: true })
  for (const v of Object.values(s1.gate.verdicts)) expect(v as number).toBeGreaterThanOrEqual(0)
  expect(() => onToolSettle(s0, { callId: 'c2', tool: 'Read', didRun: false })).not.toThrow()
  const view = agentsView({ agents: [null, 7, { id: 'a', status: 'running', startedMs: 1 }] }, 5)
  expect(view.cards.length).toBe(1)
  expect(view.rest).toBe(0)
  expect(isOutsideTasks('/proj/odd/tasks/x.md', undefined)).toBe(false)
  expect(isOutsideTasks('/proj/src/a.js', undefined)).toBe(true)
})

test('L13 onUnblocked and onBlocked return the input object when the flag already matches, before any repair', () => {
  const s = onTurnStart(initialState(), { agentId: undefined, turnId: 't1', nowMs: 5 })
  expect(onUnblocked(s)).toBe(s)
  const b = onBlocked(s)
  expect(onBlocked(b)).toBe(b)
  const bb = onBlocked(onBlocked(s))
  expect(onBlocked(bb)).toBe(bb)
  expect(bb).toEqual(onBlocked(s))
  const damaged = { ...s, agents: 'x' } as any
  expect(onUnblocked(damaged)).toBe(damaged)
})
