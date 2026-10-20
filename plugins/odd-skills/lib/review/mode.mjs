// The RDD switch. Precedence: clone, then global, then the default (on).
//   global: ${XDG_CONFIG_HOME:-$HOME/.config}/odd-skills/rdd.json
//   clone:  <git-common-dir>/odd-review/mode.json
// A file that cannot be read or parsed is skipped, never trusted.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { atomicWrite, storeDir } from './store.mjs'

export const MODES = ['on', 'off']

export function globalModePath(env = process.env) {
  const base = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config')
  return join(base, 'odd-skills', 'rdd.json')
}

export const cloneModePath = (root) => join(storeDir(root), 'mode.json')

function readFile(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'))
    return MODES.includes(value?.mode) ? value.mode : null
  } catch {
    return null
  }
}

// readMode returns {mode, source}; root may be null outside a repository.
export function readMode(root, env = process.env) {
  if (root) {
    const clone = readFile(cloneModePath(root))
    if (clone) return { mode: clone, source: 'clone' }
  }
  const global = readFile(globalModePath(env))
  if (global) return { mode: global, source: 'global' }
  return { mode: 'on', source: 'default' }
}

// readScope reports one scope's own setting, ignoring the others: {scope, mode, set}.
export function readScope(scope, root, env = process.env) {
  const mode = readFile(scope === 'clone' ? cloneModePath(root) : globalModePath(env))
  return { scope, mode, set: mode !== null }
}

// writeMode records the switch for one scope and returns the file written.
export function writeMode(scope, mode, { root, env = process.env }) {
  const file = scope === 'clone' ? cloneModePath(root) : globalModePath(env)
  atomicWrite(file, `${JSON.stringify({ mode })}\n`)
  return file
}
