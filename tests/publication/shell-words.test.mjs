// S2: shell redirections are not words. A digit glued to a redirection operator is its file
// descriptor, and `&>` / `&>>` redirect instead of ending the command.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { splitCommands } from '../../plugins/construct/hooks/scripts/shell-words.mjs'
import { applyFiles, commitAll, git, makeRepo, scratchDir } from '../helpers/repo.mjs'
import { spawnSync } from 'node:child_process'

const texts = (input) => splitCommands(input).map((words) => words.filter((w) => !w.r).map((w) => w.t))

describe('redirection file descriptors are dropped', () => {
  const cases = [
    ['git push -u origin feat/x 2>&1 | tail -5', [['git', 'push', '-u', 'origin', 'feat/x'], ['tail', '-5']]],
    ['git push origin feat/x 2>/dev/null', [['git', 'push', 'origin', 'feat/x']]],
    ['git push origin feat/x &>log', [['git', 'push', 'origin', 'feat/x']]],
    ['git push origin feat/x &>>log', [['git', 'push', 'origin', 'feat/x']]],
    ['git push origin feat/x >out 2>&1', [['git', 'push', 'origin', 'feat/x']]],
    ['cmd 1>out 2>>log 0<in 3>&- a', [['cmd', 'a']]],
    ['echo 2 > f', [['echo', '2']]],
    ['echo a2>f', [['echo', 'a2']]],
    ['echo "2">f', [['echo', '2']]],
  ]
  for (const [input, want] of cases) {
    test(input, () => assert.deepEqual(texts(input), want))
  }

  test('the target of &> is marked as a redirection target', () => {
    const [words] = splitCommands('cat x &>log')
    assert.deepEqual(words.map((w) => [w.t, w.r]), [['cat', false], ['x', false], ['log', true]])
  })
})

describe('the gate does not read a descriptor as a refspec', () => {
  const HOOK = new URL('../../plugins/construct/hooks/scripts/publication-gate.mjs', import.meta.url).pathname
  const TABLE = '# F\n\n## Tasks\n\n| ID | Specs | Task | Route | Risk | Status | Commit |\n|---|---|---|---|---|---|---|\n| T1 | S1 | w | odd-worker | 2 | done | `abc` |\n\n## Log\n\n- 1 | none | x\n'
  const repo = makeRepo({ 'src/app.js': 'a\n' })
  git(repo, 'checkout', '-q', '-b', 'feat/x')
  applyFiles(repo, { 'odd/tasks/f.md': TABLE, 'src/app.js': 'b\n' })
  commitAll(repo, 'unit')
  const run = (command) => {
    const r = spawnSync('node', [HOOK], {
      input: JSON.stringify({ session_id: 's1', cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PLUGIN_DATA: scratchDir('odd-sw-data-'), XDG_CONFIG_HOME: scratchDir('odd-sw-xdg-') },
    })
    return JSON.parse(r.stdout).hookSpecificOutput
  }
  for (const command of ['git push -u origin feat/x 2>&1 | tail -5', 'git push origin feat/x 2>/dev/null', 'git push origin feat/x &>log', 'git push origin feat/x >out 2>&1']) {
    test(command, () => {
      const out = run(command)
      assert.equal(out.permissionDecision, 'deny')
      assert.doesNotMatch(out.permissionDecisionReason, /does not resolve/)
      assert.match(out.permissionDecisionReason, /review-risk/)
    })
  }
})
