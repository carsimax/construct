// S2 of .vault/tasks/oracle-autonomy.md: command-guard allows `construct-gate oracle unlock <path>` from the main thread
// once, right after the user answered an AskUserQuestion with `Unlock` for a question naming that path in backticks.
// The answer is recorded in the review store by unlock-approval.mjs (PostToolUse on AskUserQuestion); the transcript is never read.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { makeRepo, scratchDir } from '../helpers/repo.mjs'

const GUARD = new URL('../../plugins/construct/hooks/scripts/command-guard.mjs', import.meta.url).pathname
const RECORDER = new URL('../../plugins/construct/hooks/scripts/unlock-approval.mjs', import.meta.url).pathname
const HOOKS = new URL('../../plugins/construct/hooks/hooks.json', import.meta.url).pathname
const PATH_ = 'tests/a.test.mjs'
const data = scratchDir('unlock-data-')
const env = { ...process.env, CLAUDE_PLUGIN_DATA: data }
const tick = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5) // records are ordered by millisecond

// A fresh repository per test: the latest recorded answer is per repository.
const fresh = () => makeRepo({ [PATH_]: 'one\n', 'tests/a': 'two\n' })
const question = (path = PATH_) => `oracle_conflict: \`${path}\` contradicts S2. Unlock it?`
// record runs the PostToolUse hook; `extra` overrides the input (a pre-filled tool_input.answers, a missing tool_response).
const record = (repo, { q = question(), label = 'Unlock', id = 'toolu_1', ...extra } = {}) => {
  tick()
  return spawnSync('node', [RECORDER], { encoding: 'utf8', env, input: JSON.stringify({ session_id: 's1', cwd: repo, hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_use_id: id, tool_input: { questions: [{ question: q }] }, tool_response: { questions: [], answers: { [q]: label } }, ...extra }) })
}
const guard = (repo, command, extra = {}) => {
  const r = spawnSync('node', [GUARD], { encoding: 'utf8', input: JSON.stringify({ session_id: 's1', cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, ...extra }), env })
  return { status: r.status, stdout: r.stdout, decision: r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : null, reason: r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason : '' }
}
const unlock = (p = PATH_) => `construct-gate oracle unlock ${p}`
const allowed = (r) => assert.deepEqual([r.status, r.stdout], [0, ''])
const denied = (r) => {
  assert.equal(r.decision, 'deny', r.stdout)
  assert.match(r.reason, /AskUserQuestion/)
  assert.match(r.reason, /Keep the test/)
}

describe('command-guard: unlock after a recorded AskUserQuestion approval', () => {
  test('allowed after a matching Unlock answer, in the wrapper forms and with a case-insensitive padded label', () => {
    for (const [command, label] of [[unlock(), 'Unlock'], [`sh -c "${unlock()}"`, ' UNLOCK '], [`node /x/bin/construct-gate oracle unlock ${PATH_}`, 'Unlock']]) {
      const repo = fresh()
      record(repo, { label })
      allowed(guard(repo, command))
    }
  })
  test('the path is matched after normalization, from any directory of the repository: ./p, a//b, absolute, and a quoted ./p', () => {
    for (const p of ['./tests/a.test.mjs', 'tests//a.test.mjs']) {
      const repo = fresh()
      record(repo)
      allowed(guard(repo, unlock(p)))
    }
    const repo = fresh()
    record(repo, { q: question(`./${PATH_}`) })
    allowed(guard(repo, unlock(`${repo}/${PATH_}`)))
  })
  test('the guard and the CLI resolve a path against the repository root, not the cwd', () => {
    const repo = fresh()
    record(repo, { q: question('tests/a') })
    // From tests/, `a.test.mjs` would be tests/a.test.mjs by cwd but is root/a.test.mjs for the CLI: not the approved path.
    allowed(guard(repo, unlock('tests/a'), { cwd: `${repo}/tests` }))
    const other = fresh()
    record(other)
    denied(guard(other, unlock('a.test.mjs'), { cwd: `${other}/tests` }))
  })
  test('denied without an answer, with a record from a pre-filled call, and with a malformed or missing tool_response', () => {
    const repo = fresh()
    denied(guard(repo, unlock()))
    record(repo, { tool_input: { questions: [], answers: { [question()]: 'Unlock' } } })
    denied(guard(repo, unlock()))
    for (const bad of [{ tool_response: undefined }, { tool_response: 'User has answered' }, { tool_response: { answers: 'Unlock' } }, { tool_response: { answers: ['Unlock'] } }, { tool_use_id: undefined }]) {
      record(repo, bad)
      denied(guard(repo, unlock()))
    }
  })
  test('denied for a different path, a path that only contains or is contained by the approved one, and the label Keep the test', () => {
    let repo = fresh()
    record(repo)
    denied(guard(repo, unlock('tests/b.test.mjs')))
    repo = fresh()
    record(repo)
    denied(guard(repo, unlock('tests/a.test.mjs.bak')))
    repo = fresh()
    record(repo) // an approval for tests/a.test.mjs must not unlock tests/a
    denied(guard(repo, unlock('tests/a')))
    repo = fresh()
    record(repo, { q: question('tests/a') })
    denied(guard(repo, unlock()))
    repo = fresh()
    record(repo, { label: 'Keep the test' })
    denied(guard(repo, unlock()))
  })
  test('the question must name exactly one path in backticks', () => {
    for (const q of [`Unlock ${PATH_}?`, `\`${PATH_}\` and \`tests/a\`: unlock?`, `\`${PATH_}\`\`: unlock?`, `${PATH_}" = "Unlock`, '``']) {
      const repo = fresh()
      record(repo, { q })
      denied(guard(repo, unlock()))
    }
  })
  test('only the most recent answer counts', () => {
    const repo = fresh()
    record(repo, { id: 't1' })
    record(repo, { id: 't2', label: 'Keep the test' })
    denied(guard(repo, unlock()))
  })
  test('a subagent is always denied, even with an approval, and the approval stays for the main thread', () => {
    const repo = fresh()
    record(repo)
    denied(guard(repo, unlock(), { agent_id: 'ag1', agent_type: 'construct:worker' }))
    allowed(guard(repo, unlock()))
  })
  test('a refused unlock does not use the approval; one approval unlocks once', () => {
    const repo = fresh()
    record(repo)
    denied(guard(repo, unlock('tests/b.test.mjs')))
    allowed(guard(repo, unlock()))
    denied(guard(repo, unlock()))
  })
  test('outside a repository, or without a cwd, the unlock is denied', () => {
    record(fresh())
    denied(guard(scratchDir('unlock-none-'), unlock()))
    denied(guard(undefined, unlock(), { cwd: undefined }))
  })
  test('a path argument that cannot be read, or two unlocks in one command, is denied', () => {
    const repo = fresh()
    record(repo)
    denied(guard(repo, 'construct-gate oracle unlock'))
    denied(guard(repo, 'xargs construct-gate oracle unlock'))
    denied(guard(repo, `${unlock()} && ${unlock()}`))
  })
  test('other command-guard behavior is unchanged: unrelated commands and verifier bypasses', () => {
    const repo = fresh()
    allowed(guard(repo, 'ls'))
    record(repo)
    assert.equal(guard(repo, 'git commit --no-verify -m x').decision, 'deny')
  })
})

describe('unlock-approval recorder', () => {
  test('is registered on PostToolUse for AskUserQuestion, in exec form, in its own group', () => {
    const groups = JSON.parse(readFileSync(HOOKS, 'utf8')).hooks.PostToolUse.filter((g) => g.hooks.some((h) => h.args?.[0]?.endsWith('unlock-approval.mjs')))
    assert.equal(groups.length, 1)
    assert.equal(groups[0].matcher, 'AskUserQuestion')
    assert.deepEqual(groups[0].hooks, [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/unlock-approval.mjs'], timeout: 10 }])
  })
  test('writes nothing and exits 0 for another tool or unreadable input', () => {
    const repo = fresh()
    assert.equal(record(repo, { tool_name: 'Read' }).status, 0)
    denied(guard(repo, unlock()))
    assert.equal(spawnSync('node', [RECORDER], { input: 'not json', env }).status, 0)
  })
})
