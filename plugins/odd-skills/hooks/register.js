import { effortFor, modelFor, roleFor } from './routing.js'

// Role of each subagent this session spawned, keyed by agent id, so
// turn.step can apply the role's effort to that subagent's requests
const roleByAgent = new Map()

export function register(on, options) {
  // Send each odd-skills agent on the model its role is configured for.
  // If this hook fails, the agent keeps its frontmatter model.
  on('agent.spawn', async ($, e, next) => {
    const role = roleFor(e.subagentType)
    const model = modelFor(role, options)
    const result = await next(model ? { ...e, model } : e)
    if (role && result?.agentId) roleByAgent.set(result.agentId, role)
    return result
  })

  // Apply the role's effort to every request a routed subagent makes
  on('turn.step', async function* ($, e, next) {
    const effort = effortFor(roleByAgent.get(e.agentId), options)
    return yield* next(effort ? { ...e, effort } : e)
  })
}
