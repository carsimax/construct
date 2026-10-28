import { expect, test } from 'claude-code/testing'
import {
  SCHEMA_VERSION,
  agentsView,
  initialState,
  isBlockingTool,
  merge,
  mainBusy,
  onAgentSpawn,
  onBlocked,
  onUnblocked,
  onTurnComplete,
  onTurnStart,
  phaseOf,
  shortName,
} from '../hooks/band/state.js'

const spawn = (s: any, id: any, extra: any = {}) =>
  onAgentSpawn(s, { agentId: id, subagentType: 'construct:worker', model: 'sonnet', nowMs: 1000, ...extra })

// ---- init / merge ------------------------------------------------------

test('initialState carries the schema version and empty sections', () => {
  const s = initialState()
  expect(s.v).toBe(SCHEMA_VERSION)
  expect(s.agents).toEqual([])
  expect('inline' in s).toBe(false)
  expect('gate' in s).toBe(false)
  expect(s.turn).toBe(null)
  expect('receipt' in s).toBe(false)
})

test('merge keeps a valid stored value over defaults', () => {
  const stored = { ...initialState(), blocked: true, turn: { turnId: 't' } }
  expect(merge(stored)).toEqual(stored)
})

test('merge of a stored v1 value that still has gate and inline drops them without error (S6)', () => {
  const old = { ...initialState(), inline: { count: 3 }, gate: { verdicts: { rule: 1, ask: 2, cleared: 0, deny: 1 }, pending: { c: 'file' } }, blocked: true }
  const m: any = merge(old)
  expect('gate' in m).toBe(false)
  expect('inline' in m).toBe(false)
  expect(m).toEqual({ ...initialState(), blocked: true })
  expect(merge({ v: SCHEMA_VERSION, gate: 3, inline: 'x' })).toEqual(initialState())
})

test('merge returns defaults on a version change or a malformed value', () => {
  expect(merge({ ...initialState(), v: SCHEMA_VERSION + 1, blocked: true })).toEqual(initialState())
  for (const bad of [null, undefined, 5, 'x', [], { v: SCHEMA_VERSION, agents: 'no' }]) {
    expect(merge(bad)).toEqual(initialState())
  }
})

// ---- S2 agents ---------------------------------------------------------

test('spawn adds a running card with the construct role', () => {
  const s = spawn(initialState(), 'a1')
  expect(s.agents).toEqual([
    { id: 'a1', role: 'worker', type: 'construct:worker', model: 'sonnet', startedMs: 1000, endedMs: null, status: 'running' },
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

test('agentsView lists only the running agents, oldest first', () => {
  let s = initialState()
  for (const [id, at] of [['a0', 103], ['a1', 101], ['a2', 102]] as const) s = spawn(s, id, { nowMs: at })
  s = onTurnComplete(s, { agentId: 'a2', nowMs: 200 })
  expect(agentsView(s, 300).map((c: any) => c.id)).toEqual(['a1', 'a0'])
})

test('agentsView gives the elapsed time from the start to now', () => {
  const s = spawn(initialState(), 'a1', { nowMs: 1000 })
  expect(agentsView(s, 4000)[0].elapsedMs).toBe(3000)
  expect(agentsView(initialState(), 1)).toEqual([])
})

// ---- main turn busy flag (the receipt is gone) ---------------------------

test('a main turn marks the band busy and completing it clears the flag; no receipt is kept', () => {
  let s = onTurnStart(initialState(), { turnId: 't1', nowMs: 1000 })
  expect(s.turn).toEqual({ turnId: 't1' })
  expect('receipt' in s).toBe(false)
  s = spawn(s, 'a1')
  s = onTurnComplete(s, { turnId: 't1', nowMs: 4000 })
  expect(s.turn).toBe(null)
  expect('receipt' in s).toBe(false)
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
  const reducers: any[] = [onAgentSpawn, onTurnStart, onTurnComplete]
  for (const r of reducers) {
    for (const e of odd) {
      for (const st of [initialState(), null, undefined, {}, 7]) {
        const out = r(st as any, e)
        expect(typeof out).toBe('object')
        expect(out.v).toBe(SCHEMA_VERSION)
      }
    }
  }
  expect(agentsView(null as any, NaN)).toEqual([])
})

// ---- S3 main vitals ------------------------------------------------------

test('mainBusy is true only while a main turn is open', () => {
  expect(mainBusy(initialState())).toBe(false)
  const open = onTurnStart(initialState(), { turnId: 't', nowMs: 1 })
  expect(mainBusy(open)).toBe(true)
  expect(mainBusy(onTurnComplete(open, { turnId: 't', nowMs: 2 }))).toBe(false)
  expect(mainBusy(null)).toBe(false)
})

test('merge drops the fields outside the schema', () => {
  const old: any = { ...initialState(), receipt: null, compactions: 2, main: {} }
  const m: any = merge(old)
  for (const k of ['main', 'compactions', 'receipt', 'log']) expect(k in m).toBe(false)
})

test('the schema is version 1 and any other version resets', () => {
  expect(SCHEMA_VERSION).toBe(1)
  for (const v of [0, 2, 3, '1']) expect(merge({ ...initialState(), v, blocked: true })).toEqual(initialState())
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
  expect(phaseFor('worker')).toBe('working')
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

test('a duplicate spawn id replaces the card; naming falls back and normalizes', () => {
  let s = spawn(initialState(), 'a1')
  s = spawn(s, 'a1', { model: 'opus' })
  expect(s.agents.length).toBe(1)
  expect(s.agents[0].model).toBe('opus')
  expect(agentsView(spawn(initialState(), 'a2', { subagentType: undefined }), 0)[0].name).toBe('agent')
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
  const damaged = { v: SCHEMA_VERSION, agents: [null, { id: 'a1', status: 'running' }] }
  let s: any = merge(damaged)
  s = onTurnStart(s, { agentId: 'a1' })
  const view = agentsView(s, 5)
  expect(view.length).toBe(1)
  expect(Number.isFinite(view[0].elapsedMs)).toBe(true)
  expect(agentsView({ agents: [null, 7, { id: 'a', status: 'running', startedMs: 1 }] }, 5).length).toBe(1)
  expect(agentsView({ ...initialState(), agents: [null] }, 5)).toEqual([])
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
