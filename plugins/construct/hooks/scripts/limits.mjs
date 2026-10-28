// Session limits (S3 of .vault/tasks/config-surface.md): the orchestrator declares them with `bin/construct-limits set`, which
// limits-record.mjs (PreToolUse on Bash) records; surface-guard (inline) and iteration-cap (cap) read them. One file per session under dataDir()/limits/, written to a temp
// name and renamed. Defaults and ceilings live here only; an unreadable or invalid file means the defaults.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { dataDir, safeName } from './hook-io.mjs'

export const DEFAULTS = { inline: 150, cap: 3 }
export const CEILINGS = { inline: 500, cap: 10 }

export const isLimits = (word) => /(^|\/)construct-limits$/.test(word ?? '')

// parseSet validates the arguments of `construct-limits set`: { values } or { error }. One parser for the CLI and the hook.
export function parseSet(args) {
  if (args.length === 0) return { error: 'set needs inline=<N> or cap=<N>' }
  const values = {}
  for (const arg of args) {
    const [key, value] = arg.split(/=(.*)/s)
    if (!Object.hasOwn(DEFAULTS, key)) return { error: `unknown key ${JSON.stringify(key)} (use inline or cap)` }
    if (!/^(0|[1-9]\d*)$/.test(value ?? '')) return { error: `${key} must be a whole number >= 0, got ${JSON.stringify(value ?? '')}` }
    values[key] = Number(value)
  }
  return { values }
}

const file = (session, base) => join(base ?? dataDir(), 'limits', `${safeName(session)}.json`)

function read(session, base) {
  try {
    return JSON.parse(readFileSync(file(session, base), 'utf8'))
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
