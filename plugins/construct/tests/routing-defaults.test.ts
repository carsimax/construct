// S1: the mod routes no construct agent; built-in general-purpose runs on sonnet/medium.
import { expect, test } from 'claude-code/testing'
import { ROLES } from '../hooks/scripts/roles.mjs'

const AGENTS = Object.keys(ROLES).map((name) => `construct:${name}`)

// The removed options, as a stale saved config could still hold them: every role set to a non-default value
const STALE = Object.fromEntries(
  Object.keys(ROLES).flatMap((name) => {
    const role = name.replaceAll('-', '_')
    return [[`model_${role}`, 'opus'], [`effort_${role}`, 'high']]
  }),
)

function spawnStub(seen: unknown[]) {
  return ($, e) => {
    seen.push(e)
    return { model: e.model ?? 'frontmatter', agentId: 'agent-' + e.subagentType }
  }
}

function stepStub(seen: unknown[]) {
  return async function* ($, e) {
    seen.push(e)
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  }
}

async function runStep($, event) {
  const stream = $.turn.step(event)
  let step = await stream.next()
  while (step.done !== true) step = await stream.next()
  return step.value
}

test('S1: no construct agent gets a model from the mod, even with model_<role> options present', { options: STALE }, async ($, on) => {
  const seen = []
  on('agent.spawn', spawnStub(seen))
  for (const type of AGENTS) await $.agent.spawn({ subagentType: type, prompt: 'go' })
  expect(seen.map((e) => [e.subagentType, e.model])).toEqual(AGENTS.map((t) => [t, undefined]))
})

test('S1: no construct agent gets an effort from the mod, even with effort_<role> options present', { options: STALE }, async ($, on) => {
  const steps = []
  on('agent.spawn', spawnStub([]))
  on('turn.step', stepStub(steps))
  for (const type of AGENTS) await $.agent.spawn({ subagentType: type, prompt: 'go' })
  for (const [i, type] of AGENTS.entries()) {
    await runStep($, { turnId: `t${i}`, index: 0, model: 'claude-x', effort: 'low', messageCount: 1, agentId: 'agent-' + type })
  }
  expect(steps.map((e) => e.effort)).toEqual(AGENTS.map(() => 'low'))
})

test('S1: built-in general-purpose runs on sonnet with effort medium, whatever stale options say', { options: STALE }, async ($, on) => {
  const spawns = []
  const steps = []
  on('agent.spawn', spawnStub(spawns))
  on('turn.step', stepStub(steps))
  await $.agent.spawn({ subagentType: 'general-purpose', prompt: 'research' })
  await runStep($, { turnId: 't1', index: 0, model: 'claude-x', effort: 'low', messageCount: 1, agentId: 'agent-general-purpose' })
  expect(spawns[0].model).toBe('sonnet')
  expect(steps[0].effort).toBe('medium')
})
