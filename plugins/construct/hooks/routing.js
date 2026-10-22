// Per-role model and effort routing for construct agents (spec S6).
// A role is the agent name with dashes turned into underscores, and its
// userConfig options are model_<role> and effort_<role>.

import { BUILTINS, LEGACY, PREFIX as PLUGIN_PREFIX, roleKey } from './scripts/roles.mjs'

export function roleFor(subagentType) {
  if (typeof subagentType !== 'string') return null
  if (subagentType.startsWith(PLUGIN_PREFIX)) {
    return roleKey(subagentType.slice(PLUGIN_PREFIX.length))
  }
  return Object.hasOwn(BUILTINS, subagentType) ? roleKey(BUILTINS[subagentType]) : null
}

// The saved value of an option: the new key, then the legacy key of a renamed role (S7).
// 'inherit' (the new keys' default) and '' (a key declared without a default) both mean unset.
function optionFor(prefix, role, options) {
  const legacy = Object.entries(LEGACY).find(([name]) => roleKey(name) === role)?.[1]
  const value = options?.[`${prefix}_${role}`]
  return (value && value !== 'inherit' ? value : undefined) ?? (legacy ? options?.[`${prefix}_${roleKey(legacy)}`] : undefined)
}

export function modelFor(role, options) {
  if (!role) return null
  return optionFor('model', role, options) ?? null
}

// 'default' keeps the effort the model would use without an override
export function effortFor(role, options) {
  if (!role) return null
  const effort = optionFor('effort', role, options)
  return effort && effort !== 'default' ? effort : null
}
