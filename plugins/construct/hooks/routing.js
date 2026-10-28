// Routing of the built-in general-purpose agent (spec S1): construct agents keep their frontmatter model and effort.
// A role is the agent name with dashes turned into underscores.

import { BUILTIN_DEFAULTS, BUILTINS, PREFIX as PLUGIN_PREFIX, roleKey } from './scripts/roles.mjs'

export function roleFor(subagentType) {
  if (typeof subagentType !== 'string') return null
  if (subagentType.startsWith(PLUGIN_PREFIX)) {
    return roleKey(subagentType.slice(PLUGIN_PREFIX.length))
  }
  return Object.hasOwn(BUILTINS, subagentType) ? roleKey(BUILTINS[subagentType]) : null
}

// Construct agents run on their own frontmatter; only a built-in type has defaults here.
export function modelFor(type) {
  return BUILTIN_DEFAULTS[type]?.model ?? null
}

export function effortFor(type) {
  return BUILTIN_DEFAULTS[type]?.effort ?? null
}
