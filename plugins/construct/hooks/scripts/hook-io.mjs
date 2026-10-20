// Shared helpers for the command hooks: hook input from stdin and the plugin
// data directory they keep small per-session state in.
import { lstatSync, mkdirSync, readFileSync } from 'node:fs'
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

// pendingFile is where review-context.mjs records the lineage of a spawned
// review lens and review-capture.mjs finds it at SubagentStop.
export const pendingFile = (session, agent) => join(dataDir(), 'review-hooks', safeName(session), `${safeName(agent)}.json`)
