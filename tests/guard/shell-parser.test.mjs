// T2 of .vault/tasks/shell-parser.md: command-guard on the shell shapes that hid a verifier bypass from
// the heuristic parser, and on the common idioms that must keep passing.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { allowIdioms, dataShapes, denyShapes, NO_VERIFY, NO_VERIFY_LONG, unparseable } from '../publication/shell-parser-cases.mjs'

const HOOK = join(new URL('../../plugins/construct/', import.meta.url).pathname, 'hooks/scripts/command-guard.mjs')
function run(command) {
  const env = { ...process.env }
  delete env.CLAUDE_PLUGIN_OPTION_COMMAND_GUARD_ASKS
  const r = spawnSync('node', [HOOK], { env, encoding: 'utf8', input: JSON.stringify({ session_id: 's1', cwd: process.cwd(), hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }) })
  const json = r.stdout ? JSON.parse(r.stdout) : null
  return { status: r.status, stdout: r.stdout, decision: json?.hookSpecificOutput?.permissionDecision, reason: json?.hookSpecificOutput?.permissionDecisionReason }
}

describe('command-guard denies a hidden verifier bypass', () => {
  for (const [plain, spelled] of [NO_VERIFY, NO_VERIFY_LONG]) {
    for (const command of denyShapes(plain, spelled)) {
      test(JSON.stringify(command), () => {
        const r = run(command)
        assert.equal(r.status, 0)
        assert.equal(r.decision, 'deny', r.stdout)
        assert.match(r.reason, /command-guard: .*(no-verify|could not be parsed)/)
      })
    }
  }
})

describe('command-guard lets a command that is only text pass', () => {
  for (const command of dataShapes(NO_VERIFY[0])) {
    test(JSON.stringify(command), () => assert.equal(run(command).stdout, ''))
  }
})

describe('command-guard lets the common idioms pass', () => {
  for (const command of allowIdioms) {
    test(JSON.stringify(command), () => {
      const r = run(command)
      assert.equal(r.status, 0)
      assert.equal(r.stdout, '')
    })
  }
})

describe('command-guard denies what it cannot parse', () => {
  for (const command of unparseable) {
    test(JSON.stringify(command), () => {
      const r = run(command)
      assert.equal(r.status, 0)
      assert.equal(r.decision, 'deny', r.stdout)
      assert.match(r.reason, /command-guard: .*could not be parsed/)
    })
  }
})
