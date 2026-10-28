// S2: command-guard never asks before destructive commands and `command_guard_asks` is gone from
// userConfig; the verifier-bypass denies stay.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = new URL('../../plugins/construct/', import.meta.url).pathname
const HOOK = join(ROOT, 'hooks/scripts/command-guard.mjs')
const SCRATCH = mkdtempSync(join(tmpdir(), 'construct-s2-'))

// The removed option is set on: a hook that still read it would ask.
function run(command) {
  const env = { ...process.env, HOME: SCRATCH, TMPDIR: SCRATCH, CLAUDE_PLUGIN_OPTION_COMMAND_GUARD_ASKS: 'true' }
  const result = spawnSync('node', [HOOK], {
    env,
    input: JSON.stringify({ session_id: 's2', cwd: process.cwd(), hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
  })
  let json = null
  try {
    json = JSON.parse(result.stdout)
  } catch {
    // No output.
  }
  return { status: result.status, stdout: result.stdout, decision: json?.hookSpecificOutput?.permissionDecision, reason: json?.hookSpecificOutput?.permissionDecisionReason }
}

describe('S2: userConfig', () => {
  test('plugin.json userConfig has no command_guard_asks', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/plugin.json'), 'utf8'))
    assert.equal(Object.hasOwn(manifest.userConfig ?? {}, 'command_guard_asks'), false)
  })
})

describe('S2: destructive commands give no output', () => {
  for (const command of [
    'rm -rf build',
    'git push --force origin main',
    'git reset --hard HEAD~1',
    'git clean -fd',
    'git checkout .',
    'git restore .',
    "find . -name '*.tmp' -delete",
  ]) {
    test(`no output: ${command}`, () => {
      const r = run(command)
      assert.equal(r.status, 0)
      assert.equal(r.stdout, '')
    })
  }
})

describe('S2: bypass denies stay', () => {
  for (const [command, why] of [
    ['git commit --no-verify -m x', /no-verify/],
    ['git -c core.hooksPath=/dev/null commit -m x', /hooksPath/i],
  ]) {
    test(`deny: ${command}`, () => {
      const r = run(command)
      assert.equal(r.status, 0)
      assert.equal(r.decision, 'deny', r.stdout)
      assert.match(r.reason, /^command-guard: .+\./)
      assert.match(r.reason, why)
      assert.equal(r.stdout.trim().split('\n').length, 1)
    })
  }
})
