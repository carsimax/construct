// Per-role model and effort routing for construct agents (spec S6).
// A role is the agent name with dashes turned into underscores, and its
// userConfig options are model_<role> and effort_<role>.

import { BUILTINS, PREFIX as PLUGIN_PREFIX, roleKey } from './scripts/roles.mjs'

export function roleFor(subagentType) {
  if (typeof subagentType !== 'string') return null
  if (subagentType.startsWith(PLUGIN_PREFIX)) {
    return roleKey(subagentType.slice(PLUGIN_PREFIX.length))
  }
  return Object.hasOwn(BUILTINS, subagentType) ? roleKey(BUILTINS[subagentType]) : null
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
