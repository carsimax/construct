// Pure parser for the command output the band reads.

// `git rev-parse --show-toplevel`: the root.
export function parseRevParse(text) {
  if (typeof text !== 'string') return null
  const root = text.split('\n')[0].trim()
  return root ? { root } : null
}
