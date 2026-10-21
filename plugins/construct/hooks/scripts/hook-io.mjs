// Shared helpers for the command hooks: hook input from stdin and the plugin
// data directory they keep small per-session state in.
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// readInput parses the hook JSON on stdin; unreadable input is null.
export function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}')
  } catch {
    return null
  }
}

// dataDir is the plugin data directory, or a private per-user directory in the
// system temp dir when Claude Code does not provide one. A fallback directory
// that is not a real directory owned by this user with no group or other
// access is never trusted (another local user could pre-seed its state).
export function dataDir() {
  if (process.env.CLAUDE_PLUGIN_DATA) return process.env.CLAUDE_PLUGIN_DATA
  const dir = join(tmpdir(), `construct-${process.getuid()}`)
  try {
    mkdirSync(dir, { mode: 0o700 })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  const stat = lstatSync(dir)
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) {
    throw new Error(`untrusted data directory: ${dir}`)
  }
  return dir
}

// safeName keeps a session id or agent type usable as one file name.
export const safeName = (value) => String(value || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_')

// pendingDir holds the records review-context.mjs writes for the review lenses
// it prepared in a session; review-capture.mjs finds them at SubagentStop. A
// record is keyed by lens and lineage: PreToolUse runs before the child exists,
// so it cannot know the child's agent_id, and two concurrent reviews of one
// lens always have different lineages.
export const pendingDir = (session) => join(dataDir(), 'review-hooks', safeName(session))
export const pendingFile = (session, agent, lineage) => join(pendingDir(session), `${safeName(agent)}.${safeName(lineage)}.json`)

// STATE_MAX_AGE_MS: per-session state older than this belongs to a finished session.
const STATE_MAX_AGE_MS = 7 * 24 * 3600 * 1000
const STATE_DIRS = ['review-gate', 'risk-line', 'review-hooks', 'subagent-count']

// pruneState removes this plugin's per-session state entries (a file or a
// session directory directly under one of STATE_DIRS) idle for over 7 days.
// Nothing else in the data directory is touched. Best effort: errors are ignored.
export function pruneState(now = Date.now()) {
  for (const name of STATE_DIRS) {
    const base = join(dataDir(), name)
    let entries
    try {
      entries = readdirSync(base)
    } catch {
      continue
    }
    for (const entry of entries) {
      try {
        const path = join(base, entry)
        if (now - lstatSync(path).mtimeMs > STATE_MAX_AGE_MS) rmSync(path, { recursive: true, force: true })
      } catch {
        // Best effort.
      }
    }
  }
}

// SUBAGENT_MAX_IDLE_MS is one hour, shorter than OPEN_LINEAGE_MAX_IDLE_MS (lib/review/store.mjs) because workers run minutes: an
// open-agent entry older than this belongs to a crashed agent and is ignored.
export const SUBAGENT_MAX_IDLE_MS = 3600 * 1000

// subagentDir holds one file per open subagent of a session (written by
// subagent-count.mjs). One file per agent means parallel starts and stops never
// share a read-modify-write, so no update is lost.
export const subagentDir = (session) => join(dataDir(), 'subagent-count', safeName(session))

// hasOpenSubagents is true when the session has a subagent that started and has
// not stopped within SUBAGENT_MAX_IDLE_MS. Missing or unreadable state is false,
// so the Stop gates run as they would without the counter.
export function hasOpenSubagents(session, now = Date.now()) {
  try {
    const dir = subagentDir(session)
    return readdirSync(dir).some((name) => {
      if (name.startsWith('.')) return false
      try {
        return now - statSync(join(dir, name)).mtimeMs <= SUBAGENT_MAX_IDLE_MS
      } catch {
        return false
      }
    })
  } catch {
    return false
  }
}
