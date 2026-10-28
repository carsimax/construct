// Session limits (S3 of .vault/tasks/config-surface.md): the orchestrator declares them with `bin/construct-limits`,
// surface-guard (inline) and iteration-cap (cap) read them. One file per session under dataDir()/limits/, written to a temp
// name and renamed. Defaults and ceilings live here only; an unreadable or invalid file means the defaults.
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { dataDir, fallbackDir, safeName } from './hook-io.mjs'

export const DEFAULTS = { inline: 150, cap: 3 }
export const CEILINGS = { inline: 500, cap: 10 }

const file = (session, base) => join(base ?? dataDir(), 'limits', `${safeName(session)}.json`)

// The Bash tool has no CLAUDE_PLUGIN_DATA, so the CLI writes to the fallback directory while hooks use the plugin data
// directory: with no explicit base, the session file is read from both and the more recently modified one wins.
function read(session, base) {
  const paths = (base ? [base] : [dataDir, fallbackDir]).map((b) => file(session, typeof b === 'function' ? b() : b))
  let best = null
  for (const path of paths) {
    try {
      const mtime = statSync(path).mtimeMs
      if (best === null || mtime > best.mtime) best = { path, mtime }
    } catch {
      // Not here (or untrusted directory): try the next one.
    }
  }
  try {
    return best ? JSON.parse(readFileSync(best.path, 'utf8')) : {}
  } catch {
    return {}
  }
}

// readLimits returns the active { inline, cap } of a session, each clamped to its ceiling.
export function readLimits(session, base) {
  const saved = read(session, base)
  const out = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS)) {
    if (Number.isInteger(saved?.[key]) && saved[key] >= 0) out[key] = Math.min(saved[key], CEILINGS[key])
  }
  return out
}

// writeLimits merges `values` ({inline?, cap?}, whole numbers >= 0) into the session's declared limits.
export function writeLimits(session, values, base) {
  const path = file(session, base)
  let saved = {}
  try {
    saved = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    // Nothing declared yet.
  }
  mkdirSync(join(path, '..'), { recursive: true, mode: 0o700 })
  const temporary = join(path, '..', `.${randomBytes(6).toString('hex')}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify({ ...saved, ...values }), { mode: 0o600 })
    renameSync(temporary, path)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}
