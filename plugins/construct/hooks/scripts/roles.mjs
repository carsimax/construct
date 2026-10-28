// The role registry (S6): the one place that names the construct agents and their kind.
// Consumers (delegation-admission, contract, review-context, review-capture, the band
// phase, routing) derive their sets from it; tests/roles.test.mjs cross-checks it against
// agents/, plugin.json, hooks.json, and the README.
// Kinds: reader, writer, verifier, runner (also the role of built-in `general-purpose`),
// judge, lens.
export const PREFIX = 'construct:'

export const ROLES = {
  'explorer': 'reader',
  'worker': 'writer',
  'oracle': 'writer',
  'verifier': 'verifier',
  'general': 'runner',
  'judge-a': 'judge',
  'judge-b': 'judge',
  'review-risk': 'lens',
  'review-resilience': 'lens',
  'review-readability': 'lens',
  'review-reliability': 'lens',
}

// Built-in subagent types that follow a construct role
export const BUILTINS = { 'general-purpose': 'general' }

// A built-in type has no construct frontmatter, so with its options unset it gets the one of the agent it maps to
export const BUILTIN_DEFAULTS = { 'general-purpose': { model: 'sonnet', effort: 'medium' } }

export const qualified = (name) => `${PREFIX}${name}`
export const roleKey = (name) => name.replaceAll('-', '_')
export const namesOf = (kind) => Object.keys(ROLES).filter((name) => ROLES[name] === kind)

// kindOf: the kind of a subagent type with or without the `construct:` prefix; null when it is no construct role.
export function kindOf(type) {
  if (typeof type !== 'string') return null
  const name = type.startsWith(PREFIX) ? type.slice(PREFIX.length) : (BUILTINS[type] ?? type)
  return Object.hasOwn(ROLES, name) ? ROLES[name] : null
}

// lensOf: the lens name of a `construct:review-*` subagent type (the prefix is required), else null.
export const lensOf = (type) => (typeof type === 'string' && type.startsWith(PREFIX) && kindOf(type) === 'lens' ? type.slice(PREFIX.length) : null)
