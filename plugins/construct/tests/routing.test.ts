import { expect, test } from 'claude-code/testing'
import { effortFor, modelFor, roleFor } from '../hooks/routing.js'

// Answers what Claude Code would do after the mod passes the spawn on: no model given means the frontmatter one
function spawnStub(seen: unknown[]) {
  return ($, e) => {
    seen.push(e)
    return { model: e.model ?? 'frontmatter', agentId: 'agent-' + e.subagentType }
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
  expect(roleFor('construct:worker')).toBe('worker')
  expect(roleFor('construct:review-risk')).toBe('review_risk')
  expect(roleFor('general-purpose')).toBe('general')
  expect(roleFor('Explore')).toBe(null)
  expect(roleFor('engram:something')).toBe(null)
  expect(roleFor(undefined)).toBe(null)
})

test('modelFor and effortFor give defaults to the built-in general-purpose only', async () => {
  expect([modelFor('general-purpose'), effortFor('general-purpose')]).toEqual(['sonnet', 'medium'])
  expect([modelFor('construct:worker'), effortFor('construct:worker')]).toEqual([null, null])
  expect([modelFor(undefined), effortFor(undefined)]).toEqual([null, null])
})

test('agent.spawn with no model option leaves the model to the agent frontmatter', async ($, on) => {
  const seen = []
  on('agent.spawn', spawnStub(seen))
  await $.agent.spawn({ subagentType: 'construct:explorer', prompt: 'map it' })
  expect(seen[0].model).toBe(undefined)
})

test('agent.spawn sets no model on a resumed agent, which a hook can only refuse', async ($, on) => {
  const seen = []
  on('agent.spawn', ($, e) => (seen.push(e), { model: e.model ?? 'sonnet', agentId: 'a1' }))
  await $.agent.spawn({ subagentType: 'general-purpose', prompt: 'go on', resume: { agentId: 'a1' } } as any)
  await $.agent.spawn({ subagentType: 'general-purpose', prompt: 'research' })
  expect(seen.map((e) => e.model)).toEqual([undefined, 'sonnet'])
})

test('agent.spawn keeps an explicit model over the default', async ($, on) => {
  const seen = []
  on('agent.spawn', spawnStub(seen))
  await $.agent.spawn({ subagentType: 'construct:explorer', model: 'opus', prompt: 'map it' })
  expect(seen[0].model).toBe('opus')
})

test('agent.spawn leaves other agent types unchanged', async ($, on) => {
  const seen = []
  on('agent.spawn', spawnStub(seen))
  await $.agent.spawn({ subagentType: 'Explore', model: 'opus', prompt: 'look' })
  expect(seen[0].model).toBe('opus')
})

test('turn.step keeps the caller effort for a construct agent', async ($, on) => {
  const steps = []
  on('agent.spawn', spawnStub([]))
  on('turn.step', stepStub(steps))
  await $.agent.spawn({ subagentType: 'construct:worker', model: 'sonnet', prompt: 'build' })
  await runStep($, { turnId: 't1', index: 0, model: 'claude-sonnet', effort: 'max', messageCount: 1, agentId: 'agent-construct:worker' })
  expect(steps[0].effort).toBe('max')
})

test('general-purpose with unset options keeps the construct:general frontmatter model and effort', async ($, on) => {
  const spawns = []
  const steps = []
  on('agent.spawn', spawnStub(spawns))
  on('turn.step', stepStub(steps))
  await $.agent.spawn({ subagentType: 'general-purpose', prompt: 'research' })
  await $.agent.spawn({ subagentType: 'construct:general', prompt: 'research' })
  await runStep($, { turnId: 't1', index: 0, model: 'claude-sonnet', messageCount: 1, agentId: 'agent-general-purpose' })
  await runStep($, { turnId: 't2', index: 0, model: 'claude-sonnet', messageCount: 1, agentId: 'agent-construct:general' })
  expect(spawns.map((e) => e.model)).toEqual(['sonnet', undefined])
  expect(steps.map((e) => e.effort)).toEqual(['medium', undefined])
})

test('turn.step applies the default effort to a routed built-in subagent only', async ($, on) => {
  const steps = []
  on('agent.spawn', spawnStub([]))
  on('turn.step', stepStub(steps))
  await $.agent.spawn({ subagentType: 'general-purpose', prompt: 'research' })
  await runStep($, { turnId: 't1', index: 0, model: 'claude-sonnet', effort: 'low', messageCount: 1, agentId: 'agent-general-purpose' })
  await runStep($, { turnId: 't2', index: 0, model: 'claude-opus', effort: 'high', messageCount: 1 })
  await runStep($, { turnId: 't3', index: 0, model: 'claude-x', effort: 'low', messageCount: 1, agentId: 'unknown-agent' })
  expect(steps.map((e) => e.effort)).toEqual(['medium', 'high', 'low'])
})

test('the role map keeps the newest 256 subagents and drops the oldest', async ($, on) => {
  let n = 0
  on('agent.spawn', ($, e) => ({ model: e.model, agentId: `a${n++}` }))
  const steps = []
  on('turn.step', stepStub(steps))
  for (let i = 0; i < 257; i++) await $.agent.spawn({ subagentType: 'general-purpose', prompt: 'build' })
  await runStep($, { turnId: 't0', index: 0, model: 'm', effort: 'low', messageCount: 1, agentId: 'a0' })
  await runStep($, { turnId: 't1', index: 0, model: 'm', effort: 'low', messageCount: 1, agentId: 'a1' })
  await runStep($, { turnId: 't2', index: 0, model: 'm', effort: 'low', messageCount: 1, agentId: 'a256' })
  expect(steps.map((s) => s.effort)).toEqual(['low', 'medium', 'medium'])
})
