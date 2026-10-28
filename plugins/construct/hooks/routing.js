// Per-role model and effort routing for construct agents (spec S6).
// A role is the agent name with dashes turned into underscores, and its
// userConfig options are model_<role> and effort_<role>.

import { BUILTIN_DEFAULTS, BUILTINS, PREFIX as PLUGIN_PREFIX, roleKey } from './scripts/roles.mjs'

export function roleFor(subagentType) {
  if (typeof subagentType !== 'string') return null
  if (subagentType.startsWith(PLUGIN_PREFIX)) {
    return roleKey(subagentType.slice(PLUGIN_PREFIX.length))
  }
  return Object.hasOwn(BUILTINS, subagentType) ? roleKey(BUILTINS[subagentType]) : null
}

// The saved value of an option; 'inherit' (the default) and '' (a key declared without a default) both mean unset.
function optionFor(prefix, role, options) {
  const value = options?.[`${prefix}_${role}`]
  return value && value !== 'inherit' ? value : undefined
}

// `type` is the subagent type: a built-in one falls back to BUILTIN_DEFAULTS when its option is unset
export function modelFor(role, options, type) {
  if (!role) return null
  return optionFor('model', role, options) ?? BUILTIN_DEFAULTS[type]?.model ?? null
}

// 'default' keeps the effort the model would use without an override
export function effortFor(role, options, type) {
  if (!role) return null
  const effort = optionFor('effort', role, options) ?? BUILTIN_DEFAULTS[type]?.effort
  return effort && effort !== 'default' ? effort : null
}
