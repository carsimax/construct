// S5: one Bash hook. bash-guard.mjs prints exactly what the first denying script of review-store-guard,
// command-guard, and publication-gate prints, and the Bash PreToolUse registration is a single entry.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeRepo } from '../helpers/repo.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const script = (name) => join(PLUGIN, 'hooks/scripts', name)
const ORDER = ['review-store-guard.mjs', 'command-guard.mjs', 'publication-gate.mjs']
const repo = makeRepo({ 'a.txt': 'a\n' })

const run = (name, input) => {
  const r = spawnSync('node', [script(name)], { input, encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout }
}
const bash = (command, cwd = repo) => JSON.stringify({ cwd, session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } })

describe('bash-guard output equals the separate hooks, in order', () => {
  const cases = {
    'plain command': 'ls -la',
    'review hook run': 'node plugins/construct/hooks/scripts/review-capture.mjs',
    'review store named': 'cat .git/construct-review/x',
    'no-verify commit': 'git commit --no-verify -m x',
    'hooksPath config': 'git config core.hooksPath /tmp/x',
    'push with no remote default': 'git push',
    'unparseable text': 'echo $(',
    'nested sh -c': "sh -c 'git commit -n -m x'",
  }
  for (const [name, command] of Object.entries(cases)) {
    test(name, () => {
      const input = bash(command)
      const expected = ORDER.map((s) => run(s, input)).find((r) => r.stdout !== '') ?? { status: 0, stdout: '' }
      const got = run('bash-guard.mjs', input)
      assert.equal(got.status, 0)
      assert.equal(got.stdout, expected.stdout)
    })
  }

  test('the denials come from the expected guard', () => {
    assert.match(run('bash-guard.mjs', bash('cat .git/construct-review/x')).stdout, /review-store-guard/)
    assert.match(run('bash-guard.mjs', bash('git commit --no-verify -m x')).stdout, /command-guard/)
    assert.match(run('bash-guard.mjs', bash('git push')).stdout, /publication-gate/)
    assert.equal(run('bash-guard.mjs', bash('ls')).stdout, '')
  })

  test('unreadable input and other tools give no output', () => {
    assert.equal(run('bash-guard.mjs', 'not json').stdout, '')
    assert.equal(run('bash-guard.mjs', JSON.stringify({ cwd: repo, tool_name: 'Read', tool_input: {} })).stdout, '')
  })
})

describe('registration', () => {
  test('PreToolUse on Bash has exactly one Construct entry: bash-guard.mjs, exec form, onFailure block, the longest old timeout', () => {
    const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks/hooks.json'), 'utf8')).hooks
    const entries = hooks.PreToolUse.filter((g) => g.matcher.split('|').includes('Bash'))
    assert.equal(entries.length, 1)
    assert.equal(entries[0].matcher, 'Bash')
    assert.deepEqual(entries[0].hooks, [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/bash-guard.mjs'], timeout: 30, onFailure: 'block' }])
  })
})
