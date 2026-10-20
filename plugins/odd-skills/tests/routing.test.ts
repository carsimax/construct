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

test('roleFor maps odd-skills agents and general-purpose to their config role', async () => {
  expect(roleFor('odd-skills:odd-worker')).toBe('odd_worker')
  expect(roleFor('odd-skills:review-risk')).toBe('review_risk')
  expect(roleFor('odd-skills:jd-fix-agent')).toBe('jd_fix_agent')
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

test('agent.spawn sends the configured model for an odd-skills agent', async ($, on) => {
  const seen = []
  on('agent.spawn', spawnStub(seen))
  await $.agent.spawn({ subagentType: 'odd-skills:odd-explorer', model: 'opus', prompt: 'map it' })
  expect(seen[0].model).toBe('haiku')
})

test('agent.spawn sends the general delegation model for general-purpose', async ($, on) => {
  const seen = []
  on('agent.spawn', spawnStub(seen))
  await $.agent.spawn({ subagentType: 'general-purpose', model: 'opus', prompt: 'research' })
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
  await $.agent.spawn({ subagentType: 'odd-skills:odd-worker', model: 'sonnet', prompt: 'build' })
  await runStep($, { turnId: 't1', index: 0, model: 'claude-sonnet', effort: 'low', messageCount: 1, agentId: 'agent-odd-skills:odd-worker' })
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
  await $.agent.spawn({ subagentType: 'odd-skills:odd-explorer', model: 'haiku', prompt: 'map' })
  await runStep($, { turnId: 't1', index: 0, model: 'claude-haiku', effort: 'medium', messageCount: 1, agentId: 'agent-odd-skills:odd-explorer' })
  expect(steps[0].effort).toBe('medium')
})
