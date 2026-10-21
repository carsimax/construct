import { expect, test } from 'claude-code/testing'
import { effortFor, modelFor, roleFor } from '../hooks/routing.js'

// Answers what Claude Code would do after the mod passes the spawn on
function spawnStub(seen: unknown[]) {
  return ($, e) => {
    seen.push(e)
    return { model: e.model, agentId: 'agent-' + e.subagentType }
  }
}

// Reads a turn.step stream to its end and returns the request the stub received
async function runStep($, event) {
  const stream = $.turn.step(event)
  let step = await stream.next()
  while (step.done !== true) step = await stream.next()
  return step.value
}

function stepStub(seen: unknown[]) {
  return async function* ($, e) {
    seen.push(e)
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  }
}

test('roleFor maps construct agents and general-purpose to their config role', async () => {
  expect(roleFor('construct:odd-worker')).toBe('odd_worker')
  expect(roleFor('construct:review-risk')).toBe('review_risk')
  expect(roleFor('construct:jd-fix-agent')).toBe('jd_fix_agent')
  expect(roleFor('general-purpose')).toBe('odd_general')
  expect(roleFor('Explore')).toBe(null)
  expect(roleFor('engram:something')).toBe(null)
  expect(roleFor(undefined)).toBe(null)
})

test('modelFor and effortFor read the role options, and effort default means no override', async () => {
  const options = { model_odd_worker: 'opus', effort_odd_worker: 'high', effort_odd_explorer: 'default' }
  expect(modelFor('odd_worker', options)).toBe('opus')
  expect(effortFor('odd_worker', options)).toBe('high')
  expect(effortFor('odd_explorer', options)).toBe(null)
  expect(modelFor('odd_verify', options)).toBe(null)
  expect(effortFor(null, options)).toBe(null)
})

test('agent.spawn sends the configured model for a construct agent that names none', async ($, on) => {
  const seen = []
  on('agent.spawn', spawnStub(seen))
  await $.agent.spawn({ subagentType: 'construct:odd-explorer', prompt: 'map it' })
  expect(seen[0].model).toBe('haiku')
})

test('agent.spawn keeps an explicit model over the configured one', async ($, on) => {
  const seen = []
  on('agent.spawn', spawnStub(seen))
  await $.agent.spawn({ subagentType: 'construct:odd-explorer', model: 'opus', prompt: 'map it' })
  expect(seen[0].model).toBe('opus')
})

test('agent.spawn sends the general delegation model for general-purpose that names none', async ($, on) => {
  const seen = []
  on('agent.spawn', spawnStub(seen))
  await $.agent.spawn({ subagentType: 'general-purpose', prompt: 'research' })
  expect(seen[0].model).toBe('sonnet')
})

test('agent.spawn leaves other agent types unchanged', async ($, on) => {
  const seen = []
  on('agent.spawn', spawnStub(seen))
  await $.agent.spawn({ subagentType: 'Explore', model: 'opus', prompt: 'look' })
  expect(seen[0].model).toBe('opus')
})

test('turn.step applies the configured effort to a routed subagent only', async ($, on) => {
  const spawned = []
  const steps = []
  on('agent.spawn', spawnStub(spawned))
  on('turn.step', stepStub(steps))
  await $.agent.spawn({ subagentType: 'construct:odd-worker', model: 'sonnet', prompt: 'build' })
  await runStep($, { turnId: 't1', index: 0, model: 'claude-sonnet', effort: 'low', messageCount: 1, agentId: 'agent-construct:odd-worker' })
  await runStep($, { turnId: 't2', index: 0, model: 'claude-opus', effort: 'high', messageCount: 1 })
  await runStep($, { turnId: 't3', index: 0, model: 'claude-x', effort: 'low', messageCount: 1, agentId: 'unknown-agent' })
  expect(steps[0].effort).toBe('medium')
  expect(steps[1].effort).toBe('high')
  expect(steps[2].effort).toBe('low')
})

test('turn.step keeps the model effort when the role effort is default', async ($, on) => {
  const spawned = []
  const steps = []
  on('agent.spawn', spawnStub(spawned))
  on('turn.step', stepStub(steps))
  await $.agent.spawn({ subagentType: 'construct:odd-explorer', model: 'haiku', prompt: 'map' })
  await runStep($, { turnId: 't1', index: 0, model: 'claude-haiku', effort: 'medium', messageCount: 1, agentId: 'agent-construct:odd-explorer' })
  expect(steps[0].effort).toBe('medium')
})

test('the role map keeps the newest 256 subagents and drops the oldest', async ($, on) => {
  let n = 0
  on('agent.spawn', ($, e) => ({ model: e.model, agentId: `a${n++}` }))
  const steps = []
  on('turn.step', stepStub(steps))
  for (let i = 0; i < 257; i++) await $.agent.spawn({ subagentType: 'construct:odd-worker', model: 'sonnet', prompt: 'build' })
  await runStep($, { turnId: 't0', index: 0, model: 'm', effort: 'low', messageCount: 1, agentId: 'a0' })
  await runStep($, { turnId: 't1', index: 0, model: 'm', effort: 'low', messageCount: 1, agentId: 'a1' })
  await runStep($, { turnId: 't2', index: 0, model: 'm', effort: 'low', messageCount: 1, agentId: 'a256' })
  expect(steps.map((s) => s.effort)).toEqual(['low', 'medium', 'medium'])
})
