// Shared by the S7 signal tests: the real delivery-signals hook driven with PostToolUse JSON.
import { spawnSync } from 'node:child_process'
import { scratchDir } from '../helpers/repo.mjs'

export const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
export const SCRIPT = `${PLUGIN}hooks/scripts/delivery-signals.mjs`

// mode 'batch' feeds PostToolBatch (context backstop); any other mode is no hook and stays silent.
export function hook(event, env = {}, mode = 'post') {
  const hook_event_name = mode === 'batch' ? 'PostToolBatch' : 'PostToolUse'
  const result = spawnSync('node', [SCRIPT, mode], {
    input: JSON.stringify({ hook_event_name, session_id: 's1', ...event }),
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
