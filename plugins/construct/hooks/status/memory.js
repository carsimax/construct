// Pure parser for `construct-memory stats --json` (S20), like the others in data.js.

import { isNum } from './format.js'

const count = (x) => (isNum(x) && x >= 0 ? Math.floor(x) : 0)

// `run` is the process result { exitCode, stdout, stderr }. Gives the card data, `{ off }` with the reason
// memory is unusable, or null for any other failure (the card is then left out).
export function parseMemoryStats(run) {
  if (!run || typeof run !== 'object') return null
  if (run.exitCode === 0) {
    try {
      const s = JSON.parse(run.stdout)
      if (!s || typeof s !== 'object' || !isNum(s.observations)) return null
      return {
        memories: count(s.observations),
        review: count(s.needing_review),
        pinned: count(s.pinned),
        pending: count(s.pending_relations),
        lastSaveAt: typeof s.last_save_at === 'string' ? s.last_save_at : null,
        sessionSaves: isNum(s.session_saves) ? count(s.session_saves) : null,
      }
    } catch {
      return null
    }
  }
  const err = String(run.stderr ?? '')
  if (err.includes('node:sqlite')) return { off: 'memory unavailable (Node 22.16+)' }
  if (err.includes('not inside a git repository')) return { off: 'not a git repository' }
  return null
}
