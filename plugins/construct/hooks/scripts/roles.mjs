// The role registry (S6): the one place that names the construct agents and their kind.
// Consumers (delegation-admission, contract, review-context, review-capture, the panel
// phase, routing) derive their sets from it; tests/roles.test.mjs cross-checks it against
// agents/, plugin.json, hooks.json, and the README.
// Kinds: reader, writer, verifier, runner (also the role of built-in `general-purpose`),
// judge, lens.
export const PREFIX = 'construct:'

export const ROLES = {
  'odd-explorer': 'reader',
  'odd-worker': 'writer',
  'jd-fix-agent': 'writer',
  'odd-verify': 'verifier',
  'odd-general': 'runner',
  'jd-judge-a': 'judge',
  'jd-judge-b': 'judge',
  'review-risk': 'lens',
  'review-resilience': 'lens',
  'review-readability': 'lens',
  'review-reliability': 'lens',
}

// Built-in subagent types that follow a construct role
export const BUILTINS = { 'general-purpose': 'odd-general' }

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
