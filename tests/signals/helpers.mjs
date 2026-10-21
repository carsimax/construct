// Shared by the S7 signal tests: the real delivery-signals hook driven with PostToolUse JSON.
import { spawnSync } from 'node:child_process'
import { applyFiles, commitAll, git, makeRepo, scratchDir } from '../helpers/repo.mjs'

export const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
export const SCRIPT = `${PLUGIN}hooks/scripts/delivery-signals.mjs`

export const lines = (n, tag = 'x') => Array.from({ length: n }, (_, i) => `${tag}${i}\n`).join('')

export function hook(event, env = {}) {
  const result = spawnSync('node', [SCRIPT, 'post'], {
    input: JSON.stringify({ hook_event_name: 'PostToolUse', session_id: 's1', ...event }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_DATA: scratchDir('odd-sig-data-'), ...env },
  })
  let json = null
  try {
    json = JSON.parse(result.stdout)
  } catch {
    // No output.
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json, context: json?.hookSpecificOutput?.additionalContext }
}

// A feature branch with one commit of the given files on top of main.
export function featureRepo(files) {
  const repo = makeRepo({ 'src/a.js': 'export const a = 1\n' })
  git(repo, 'checkout', '-q', '-b', 'feat')
  applyFiles(repo, files)
  commitAll(repo, 'unit')
  return repo
}
