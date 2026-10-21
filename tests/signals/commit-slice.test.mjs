// S7(a): the commit slice signal after a successful `git commit` (PostToolUse on Bash).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { applyFiles, commitAll, git, makeRepo } from '../helpers/repo.mjs'
import { featureRepo, hook, lines, PLUGIN, SCRIPT } from './helpers.mjs'

const commit = (repo, extra = {}, command = 'git commit -m unit') =>
  hook({ cwd: repo, tool_name: 'Bash', tool_input: { command }, tool_response: { stdout: '[feat abc] unit', stderr: '', interrupted: false }, ...extra })

describe('commit slice', () => {
  test('under 400 reports the count and the lines left', () => {
    const r = commit(featureRepo({ 'src/b.js': lines(120) }))
    assert.equal(r.status, 0)
    assert.equal(r.json.hookSpecificOutput.hookEventName, 'PostToolUse')
    assert.match(r.context, /Commit slice: 120 authored changed lines in 1 commit on feat since main/)
    assert.match(r.context, /280 lines left before the ~400-line slice/)
    assert.doesNotMatch(r.context, /Past the/)
  })

  test('exactly 400 is not past the slice', () => {
    const r = commit(featureRepo({ 'src/b.js': lines(400) }))
    assert.match(r.context, /400 authored changed lines/)
    assert.match(r.context, /0 lines left/)
  })

  test('over 400 adds the slice notice', () => {
    const r = commit(featureRepo({ 'src/b.js': lines(450) }))
    assert.match(r.context, /450 authored changed lines/)
    assert.match(r.context, /Past the ~400-line slice: apply the feature's delivery strategy/)
  })

  test('additions and deletions both count, lockfiles and minified files do not', () => {
    const repo = makeRepo({ 'src/a.js': lines(30, 'old') })
    git(repo, 'checkout', '-q', '-b', 'feat')
    applyFiles(repo, {
      'src/a.js': lines(10, 'new'),
      'package-lock.json': lines(900),
      'sub/yarn.lock': lines(900),
      'dist/app.min.js': lines(900),
      'go.sum': lines(900),
    })
    commitAll(repo, 'unit')
    const r = commit(repo)
    assert.match(r.context, /Commit slice: 40 authored changed lines/)
  })

  test('commits on several commits are summed against the merge base', () => {
    const repo = featureRepo({ 'src/b.js': lines(10) })
    applyFiles(repo, { 'src/c.js': lines(5) })
    commitAll(repo, 'second')
    assert.match(commit(repo).context, /15 authored changed lines in 2 commits/)
  })

  test('a subagent commit gets the signal too', () => {
    const r = commit(featureRepo({ 'src/b.js': lines(3) }), { agent_id: 'a1', agent_type: 'construct:odd-worker' })
    assert.match(r.context, /3 authored changed lines/)
  })

  test('git -C and a preceding cd pick the repository', () => {
    const repo = featureRepo({ 'src/b.js': lines(7) })
    const other = makeRepo({})
    assert.match(commit(other, {}, `git -C ${repo} commit -m x`).context, /7 authored changed lines/)
    assert.match(commit(other, {}, `cd ${repo} && git commit -m x`).context, /7 authored changed lines/)
  })

  test('chained commands are found, text that only mentions a commit is not', () => {
    const repo = featureRepo({ 'src/b.js': lines(2) })
    assert.match(commit(repo, {}, 'git add -A && git commit -m x').context, /2 authored/)
    assert.equal(commit(repo, {}, 'echo git commit -m x').stdout, '')
    assert.equal(commit(repo, {}, 'git log --oneline').stdout, '')
  })

  test('non-commit and non-Bash calls stay silent', () => {
    const repo = featureRepo({ 'src/b.js': lines(2) })
    assert.equal(commit(repo, {}, 'git status').stdout, '')
    assert.equal(hook({ cwd: repo, tool_name: 'Edit', tool_input: { file_path: 'x' }, tool_response: {} }).stdout, '')
  })

  test('a failed or interrupted commit stays silent', () => {
    const repo = featureRepo({ 'src/b.js': lines(2) })
    assert.equal(commit(repo, { tool_response: { stdout: '', stderr: 'nothing to commit', is_error: true } }).stdout, '')
    assert.equal(commit(repo, { tool_response: { stdout: '', interrupted: true } }).stdout, '')
    assert.equal(commit(repo, { tool_response: { exit_code: 1 } }).stdout, '')
  })

  test('on the default branch, outside a repository, or without commits it is silent', () => {
    const main = makeRepo({ 'src/a.js': 'a\n' })
    assert.equal(commit(main).stdout, '')
    assert.equal(commit('/').stdout, '')
    const fresh = makeRepo({})
    git(fresh, 'checkout', '-q', '-b', 'feat')
    assert.equal(commit(fresh).stdout, '')
  })

  test('unreadable input never fails', () => {
    for (const input of ['', 'not json', '[]', 'null']) {
      const r = spawnSync('node', [SCRIPT, 'post'], { input, encoding: 'utf8' })
      assert.equal(r.status, 0)
      assert.equal(r.stdout, '')
    }
  })
})

describe('registration', () => {
  test('hooks.json registers delivery-signals post on PostToolUse in exec form', () => {
    const hooks = JSON.parse(readFileSync(`${PLUGIN}hooks/hooks.json`, 'utf8'))
    const handlers = hooks.hooks.PostToolUse.flatMap((e) => e.hooks).filter((h) => h.args?.[0]?.endsWith('delivery-signals.mjs'))
    assert.equal(handlers.length, 1)
    assert.deepEqual(handlers[0], { type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/delivery-signals.mjs', 'post'], timeout: 10 })
  })
})
