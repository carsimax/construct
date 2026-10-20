// Per-role model and effort routing for odd-skills agents (spec S6).
// A role is the agent name with dashes turned into underscores, and its
// userConfig options are model_<role> and effort_<role>.

const PLUGIN_PREFIX = 'odd-skills:'

// Built-in subagent types that follow an odd-skills role
const BUILTIN_ROLES = { 'general-purpose': 'odd_general' }

export function roleFor(subagentType) {
  if (typeof subagentType !== 'string') return null
  if (subagentType.startsWith(PLUGIN_PREFIX)) {
    return subagentType.slice(PLUGIN_PREFIX.length).replaceAll('-', '_')
  }
  return BUILTIN_ROLES[subagentType] ?? null
}

export function modelFor(role, options) {
  if (!role) return null
  return options?.[`model_${role}`] ?? null
}

// 'default' keeps the effort the model would use without an override
export function effortFor(role, options) {
  if (!role) return null
  const effort = options?.[`effort_${role}`]
  return effort && effort !== 'default' ? effort : null
}
