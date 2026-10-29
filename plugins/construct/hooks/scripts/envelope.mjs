// The oracle's envelope (S2 of .vault/tasks/oracle-limits.md): the `## Envelope` section of its final reply, which
// oracle-record.mjs stores and delegation-admission.mjs checks worker surfaces against. Lines:
//   - Command: <shell command that runs the oracle tests>
//   - Surfaces:            (one repository-relative path or narrow glob per following line)
//   - Attempts: <n>   - Minutes: <n>   - Lines: <n>
// Command and Surfaces are required (no envelope otherwise). A missing, invalid, zero, or negative budget takes its
// default; a value above its ceiling clamps to it. The ceilings are fixed here: nothing an agent writes raises them.
export const CEILINGS = { attempts: 10, minutes: 60, lines: 1500 }
export const DEFAULTS = { attempts: 5, minutes: 30, lines: 400 }

const unwrap = (value) => value.trim().replace(/^`([^`]*)`$/, '$1').trim()
const budget = (value, key) => (/^\d+$/.test(value ?? '') && Number(value) > 0 ? Math.min(Number(value), CEILINGS[key]) : DEFAULTS[key])

// parseEnvelope returns { command, surfaces, attempts, minutes, lines } or null when the reply has no usable envelope.
export function parseEnvelope(reply) {
  if (typeof reply !== 'string') return null
  const heading = /^## Envelope[ \t]*$/m.exec(reply)
  if (!heading) return null
  const lines = reply.slice(heading.index + heading[0].length).split(/\r?\n/)
  const end = lines.findIndex((line) => /^ {0,3}#{1,6} /.test(line))
  const fields = {}
  const surfaces = []
  let inSurfaces = false
  for (const line of end === -1 ? lines : lines.slice(0, end)) {
    const field = /^[-*+][ \t]+(Command|Surfaces|Attempts|Minutes|Lines):[ \t]*(.*)$/i.exec(line.trim())
    if (field) {
      const key = field[1].toLowerCase()
      fields[key] = field[2].trim()
      inSurfaces = key === 'surfaces'
      if (inSurfaces && fields.surfaces) surfaces.push(unwrap(fields.surfaces))
    } else if (inSurfaces && line.trim()) surfaces.push(unwrap(line.trim().replace(/^[-*+][ \t]+/, '')))
  }
  const command = unwrap(fields.command ?? '')
  if (!command || surfaces.length === 0) return null
  return { command, surfaces: [...new Set(surfaces)], attempts: budget(fields.attempts, 'attempts'), minutes: budget(fields.minutes, 'minutes'), lines: budget(fields.lines, 'lines') }
}

// spentBudget names the budget of a task that is used up (attempts or minutes, S5 of .vault/tasks/oracle-limits.md), or returns null.
// A spent budget is a hard stop: surface-guard.mjs denies a worker's writes and oracle-stop.mjs lets its stop through.
export function spentBudget(state, envelope, now = Date.now()) {
  if (!state) return null
  if (state.attempts >= envelope.attempts) return `the ${envelope.attempts} attempts of the oracle envelope are spent`
  if (now - state.startedAt > envelope.minutes * 60_000) return `the ${envelope.minutes} minutes of the oracle envelope are spent`
  return null
}

// Docs: a `*.md` file outside the Markdown that is behavior (the contracts, the skills, the agents). A glob counts as a doc only
// when its literal prefix cannot reach those directories. The main thread writes docs and `.vault/` freely, and a worker whose
// surfaces are all docs or `.vault/` needs no oracle envelope (S1 of .vault/tasks/oracle-limits.md).
const BEHAVIOR_DIRS = ['plugins/construct/hooks/contract/', 'plugins/construct/skills/', 'plugins/construct/agents/']
export function isDoc(path) {
  const glob = path.search(/[*?[\]{}]/)
  return path.endsWith('.md') && !BEHAVIOR_DIRS.some((dir) => path.startsWith(dir) || (glob !== -1 && dir.startsWith(path.slice(0, glob))))
}
export const isFree = (path) => path.startsWith('.vault/') || isDoc(path)
