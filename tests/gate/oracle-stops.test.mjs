// S4, S5 and the T5 hardening (odd/tasks/oracle-separation.md): early stops for a locked oracle (surface-guard,
// delegation-admission), the `construct-gate oracle` CLI, the command-guard deny, and the fail-closed record rules.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { applyFiles, commitAll, git, makeRepo, scratchDir, write } from '../helpers/repo.mjs'
import { readOracles, writeOracle } from '../../plugins/construct/hooks/scripts/review-store.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const S = (name) => join(PLUGIN, 'hooks/scripts', name)
const GATE = join(PLUGIN, 'bin/construct-gate')
const PATH_ = 'tests/a.test.mjs'
const FEATURE = (status) => `# Feature\n\n## Tasks\n\n| ID | Specs | Task | Route | Risk | Status | Commit |\n|---|---|---|---|---|---|---|\n| T1 | S1 | work | worker | none | ${status} | - |\n\n## Log\n`
// The store directory name is built here: review-store-guard denies the literal text in an edit.
const oraclesDir = (repo) => join(repo, '.git', ['construct', 'review'].join('-'), 'oracles')

const run = (script, input, extra = {}) => {
  const r = spawnSync('node', [script], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_DATA: scratchDir('odd-stops-data-'), ...extra } })
  let json = null
  try {
    json = JSON.parse(r.stdout)
  } catch {
    // no output
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, reason: json?.hookSpecificOutput?.permissionDecisionReason, decision: json?.hookSpecificOutput?.permissionDecision }
}
const denied = (r, ...needles) => {
  assert.equal(r.status, 0)
  assert.equal(r.decision, 'deny', r.stdout)
  for (const n of needles) assert.match(r.reason, n)
}
const silent = (r) => assert.deepEqual([r.status, r.stdout], [0, ''])

// lockedRepo: the oracle file and the feature document are committed on main; the oracle is locked for odd/tasks/f.md.
function lockedRepo({ doc = FEATURE('pending'), feature = 'odd/tasks/f.md', path = PATH_ } = {}) {
  const repo = makeRepo({ [path]: 'one\n', 'odd/tasks/f.md': doc, 'src/a.js': 'a\n' })
  writeOracle(repo, { path, blob: git(repo, 'hash-object', path).trim(), feature, task: 'T1', at: Date.now() })
  return repo
}
// withRemote: origin/main exists, so a finished document on main releases the lock.
function withRemote(repo) {
  const bare = join(scratchDir('odd-stops-remote-'), 'origin.git')
  git(repo, 'clone', '-q', '--bare', repo, bare)
  git(repo, 'remote', 'add', 'origin', bare)
  git(repo, 'fetch', '-q', 'origin')
  git(repo, 'remote', 'set-head', 'origin', 'main')
  return repo
}
const released = () => withRemote(lockedRepo({ doc: FEATURE('done (ok)') }))
const push = (repo, extra) => run(S('publication-gate.mjs'), { session_id: 's1', cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push' } }, extra)
const featBranch = (repo) => {
  git(repo, 'checkout', '-q', '-b', 'feat')
  applyFiles(repo, { 'src/a.js': 'x\n' })
  commitAll(repo, 'unit')
}

describe('surface-guard: a locked oracle', () => {
  const guard = (repo, tool_name, tool_input, extra = {}) => run(S('surface-guard.mjs'), { session_id: 's1', cwd: repo, tool_name, tool_input, ...extra })
  test('is denied to the main thread for Write, Edit, MultiEdit and NotebookEdit, with the way out', () => {
    const repo = lockedRepo()
    const file = join(repo, PATH_)
    for (const [tool, input] of [['Write', { file_path: file, content: 'x\n' }], ['Edit', { file_path: file, old_string: 'one', new_string: 'two' }], ['MultiEdit', { file_path: file, edits: [{ old_string: 'one', new_string: 'two' }] }], ['NotebookEdit', { notebook_path: file, new_source: 'x' }]]) {
      denied(guard(repo, tool, input), /locked oracle for odd\/tasks\/f\.md/, /oracle_conflict/, /construct-gate oracle unlock tests\/a\.test\.mjs/)
    }
  })
  test('is denied to a subagent too', () => {
    const repo = lockedRepo()
    denied(guard(repo, 'Write', { file_path: join(repo, PATH_), content: 'x\n' }, { agent_id: 'a1' }), /locked oracle/)
  })
  test('a relative path is denied too', () => {
    denied(guard(lockedRepo(), 'Write', { file_path: PATH_, content: 'x\n' }), /locked oracle/)
  })
  test('another path stays allowed, and so does the oracle when its lock is released', () => {
    silent(guard(lockedRepo(), 'Write', { file_path: 'src/a.js', content: 'x\n' }))
    silent(guard(released(), 'Write', { file_path: PATH_, content: 'x\n' }))
  })
  test('fails open on bad input', () => {
    silent(run(S('surface-guard.mjs'), 'not json'))
  })
})

describe('delegation-admission: locked oracles', () => {
  const surfaces = (...p) => `## Allowed edit surfaces\n${p.join('\n')}\n`
  const launch = (repo, type, prompt) => run(S('delegation-admission.mjs'), { session_id: 's1', cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: type, prompt, description: 'unit' } })
  const SPEC = 'Spec: odd/tasks/f.md, T1, S1\n'
  test('a worker whose surfaces cover a locked path is denied (exact, glob, directory)', () => {
    const repo = lockedRepo()
    for (const s of [PATH_, 'tests/**/*.test.mjs', 'tests']) denied(launch(repo, 'construct:worker', SPEC + surfaces(s)), /locked oracle/, /tests\/a\.test\.mjs/)
  })
  test('a worker elsewhere is admitted, and so is one over a released lock', () => {
    silent(launch(lockedRepo(), 'construct:worker', SPEC + surfaces('src/a.js')))
    silent(launch(released(), 'construct:worker', SPEC + surfaces(PATH_)))
  })
  test('an oracle over a path locked for another feature that is still active is denied (T5)', () => {
    const repo = lockedRepo()
    write(repo, 'odd/tasks/g.md', FEATURE('pending'))
    denied(launch(repo, 'construct:oracle', `Spec: odd/tasks/g.md, T1\n${surfaces(PATH_)}`), /locked oracle for odd\/tasks\/f\.md/)
  })
  test('an oracle over a path whose lock is released is admitted', () => {
    const repo = released()
    write(repo, 'odd/tasks/g.md', FEATURE('pending'))
    silent(launch(repo, 'construct:oracle', `Spec: odd/tasks/g.md, T1\n${surfaces(PATH_)}`))
  })
})

const featBranch2 = (repo) => {
  applyFiles(repo, { 'src/a.js': 'x\n' })
  commitAll(repo, 'unit')
}

describe('oracle-record: released locks and unlockable surfaces', () => {
  const transcript = (...paths) => {
    const file = join(scratchDir('odd-stops-t-'), 't.jsonl')
    const text = `Write tests.\n\nSpec: odd/tasks/g.md, T2 (covers S1)\n\n## Allowed edit surfaces\n${paths.join('\n')}\n`
    writeFileSync(file, `${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`)
    return file
  }
  const stop = (repo, ...paths) => run(S('oracle-record.mjs'), { session_id: 's1', agent_id: 'a1', agent_type: 'construct:oracle', cwd: repo, agent_transcript_path: transcript(...paths) })
  test('a new oracle run replaces a released lock', () => {
    const repo = released()
    write(repo, PATH_, 'two\n')
    stop(repo, PATH_)
    const [lock] = readOracles(repo)
    assert.equal(lock.feature, 'odd/tasks/g.md')
    assert.equal(lock.blob, git(repo, 'hash-object', PATH_).trim())
  })
  test('an active lock is still kept', () => {
    const repo = lockedRepo()
    write(repo, PATH_, 'two\n')
    stop(repo, PATH_)
    assert.equal(readOracles(repo)[0].feature, 'odd/tasks/f.md')
  })
  test('a symlink surface is locked with a sentinel the gate reports as changed', () => {
    const repo = makeRepo({ 'odd/tasks/f.md': FEATURE('pending'), 'real.txt': 'r\n' })
    symlinkSync('real.txt', join(repo, 'tests-link'))
    stop(repo, 'tests-link')
    const [lock] = readOracles(repo)
    assert.equal(lock.path, 'tests-link')
    assert.doesNotMatch(lock.blob, /^[0-9a-f]{40}$/)
    git(repo, 'checkout', '-q', '-b', 'feat')
    applyFiles(repo, { 'tests-link': 'x\n', 'src/a.js': 'x\n' })
    commitAll(repo, 'unit')
    denied(push(repo), /tests-link/, /locked/)
  })
  test('a sentinel lock denies only a ref that carries the path', () => {
    const repo = makeRepo({ 'odd/tasks/f.md': FEATURE('pending'), 'real.txt': 'r\n' })
    symlinkSync('real.txt', join(repo, 'tests-link'))
    stop(repo, 'tests-link')
    git(repo, 'checkout', '-q', '-b', 'feat')
    unlinkSync(join(repo, 'tests-link')) // commitAll adds everything: the ref must never carry the path
    featBranch2(repo)
    silent(push(repo))
  })
  test('a directory surface is locked with the sentinel too', () => {
    const repo = makeRepo({ 'odd/tasks/f.md': FEATURE('pending') })
    mkdirSync(join(repo, 'tests/dir'), { recursive: true })
    write(repo, 'tests/dir/x.mjs', 'x\n')
    stop(repo, 'tests/dir')
    assert.equal(readOracles(repo).length, 1)
  })
})

describe('publication-gate: record faults and bounded work', () => {
  test('a corrupt lock record is skipped: it does not deny every publication', () => {
    const repo = lockedRepo()
    writeFileSync(join(oraclesDir(repo), readdirSync(oraclesDir(repo))[0]), '{not json')
    featBranch(repo)
    silent(push(repo))
    assert.deepEqual(readOracles(repo), [])
  })
  test('a valid record whose git probe errors still denies', () => {
    const repo = makeRepo({ 'odd/tasks/f.md': FEATURE('pending') })
    writeOracle(repo, { path: PATH_, blob: 'not-an-object-id', feature: 'odd/tasks/f.md', task: 'T1', at: Date.now() })
    featBranch(repo)
    denied(push(repo), /could not be checked/)
  })
  test('a lock whose release state cannot be read is kept alone: an unrelated ref still publishes', () => {
    const repo = withRemote(makeRepo({ 'odd/tasks/f.md': FEATURE('pending'), 'tests/a.test.mjs': 'one\n', 'src/a.js': 'a\n' }))
    writeOracle(repo, { path: 'tests/zzz.test.mjs', blob: '1'.repeat(40), feature: 'odd/tasks/f\u0000.md', task: 'T1', at: Date.now() })
    writeOracle(repo, { path: PATH_, blob: git(repo, 'hash-object', PATH_).trim(), feature: 'odd/tasks/f.md', task: 'T1', at: Date.now() })
    featBranch(repo)
    silent(push(repo))
    const r = spawnSync('node', [GATE, 'oracle', 'list'], { cwd: repo, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /tests\/zzz\.test\.mjs.*\terror\b/)
    assert.match(r.stdout, /tests\/a\.test\.mjs\s+odd\/tasks\/f\.md\s+T1\s+active/)
  })
  test('the feature document is read once per feature, however many locks share it', () => {
    const tests = ['tests/a.test.mjs', 'tests/b.test.mjs', 'tests/c.test.mjs']
    const repo = withRemote(makeRepo({ 'odd/tasks/f.md': FEATURE('pending'), 'tests/a.test.mjs': '1\n', 'tests/b.test.mjs': '2\n', 'tests/c.test.mjs': '3\n' }))
    for (const p of tests) writeOracle(repo, { path: p, blob: git(repo, 'hash-object', p).trim(), feature: 'odd/tasks/f.md', task: 'T1', at: Date.now() })
    featBranch(repo)
    const trace = join(scratchDir('odd-stops-trace-'), 'trace')
    const bin = scratchDir('odd-stops-bin-')
    const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim()
    writeFileSync(join(bin, 'git'), `#!/bin/sh\necho "$@" >> ${trace}\nexec ${realGit} "$@"\n`, { mode: 0o755 })
    silent(push(repo, { PATH: `${bin}:${process.env.PATH}` }))
    const lines = readFileSync(trace, 'utf8').split('\n').map((l) => l.replace(/^--no-replace-objects (-C \S+ )?/, ''))
    assert.equal(lines.filter((l) => /^show .*odd\/tasks\/f\.md/.test(l)).length, 1)
    assert.equal(lines.filter((l) => /^ls-tree .*odd\/tasks\/f\.md/.test(l)).length, 1)
    assert.equal(lines.filter((l) => /^rev-parse --verify -q [0-9a-f]{40}:tests\//.test(l)).length, 3)
    assert.equal(lines.filter((l) => /^(cat-file|log) /.test(l)).length, 0)
  })
})

describe('construct-gate oracle', () => {
  const cli = (repo, ...args) => {
    const r = spawnSync('node', [GATE, 'oracle', ...args], { cwd: repo, encoding: 'utf8' })
    return { status: r.status, stdout: r.stdout, stderr: r.stderr }
  }
  test('list shows path, feature, task, active, and whether the file matches the blob', () => {
    const repo = lockedRepo()
    const first = cli(repo, 'list')
    assert.equal(first.status, 0)
    assert.match(first.stdout, /tests\/a\.test\.mjs\s+odd\/tasks\/f\.md\s+T1\s+active\s+matches/)
    write(repo, PATH_, 'edited\n')
    assert.match(cli(repo, 'list').stdout, /active\s+differs/)
    git(repo, 'rm', '-q', '-f', PATH_)
    assert.match(cli(repo, 'list').stdout, /active\s+missing/)
  })
  test('list marks a lock whose feature is finished as released', () => {
    assert.match(cli(released(), 'list').stdout, /released/)
  })
  test('list says so when there are no locks', () => {
    assert.match(cli(makeRepo({}), 'list').stdout, /no oracle locks/)
  })
  test('list shows a corrupt record, and unlock removes it by the name shown', () => {
    const repo = lockedRepo()
    writeFileSync(join(oraclesDir(repo), 'bad.json'), '{nope')
    assert.match(cli(repo, 'list').stdout, /corrupt\s+bad\.json/)
    const r = cli(repo, 'unlock', 'bad.json')
    assert.equal(r.status, 0)
    assert.match(r.stdout, /bad\.json/)
    assert.doesNotMatch(cli(repo, 'list').stdout, /corrupt/)
  })
  test('unlock removes that path, prints what it removed, and the lock is gone', () => {
    const repo = lockedRepo()
    const r = cli(repo, 'unlock', PATH_)
    assert.equal(r.status, 0)
    assert.match(r.stdout, /unlocked tests\/a\.test\.mjs/)
    assert.match(r.stdout, /odd\/tasks\/f\.md/)
    assert.deepEqual(readOracles(repo), [])
  })
  test('unlock of a path with no lock, or with no argument, is an error', () => {
    const repo = lockedRepo()
    const none = cli(repo, 'unlock', 'src/a.js')
    assert.equal(none.status, 1)
    assert.match(none.stderr, /no oracle lock/)
    assert.equal(cli(repo, 'unlock').status, 1)
    assert.equal(cli(repo, 'frobnicate').status, 1)
    assert.equal(readOracles(repo).length, 1)
  })
  test('the usage names the oracle commands', () => {
    const r = spawnSync('node', [GATE, 'help'], { encoding: 'utf8' })
    assert.match(r.stdout, /oracle list/)
    assert.match(r.stdout, /oracle unlock <path>/)
  })
})

describe('command-guard: oracle unlock', () => {
  const guard = (command) => run(S('command-guard.mjs'), { session_id: 's1', cwd: process.cwd(), hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } })
  test('denies construct-gate oracle unlock however it is launched', () => {
    for (const c of ['construct-gate oracle unlock tests/a.test.mjs', '/x/bin/construct-gate oracle unlock a', 'node /x/bin/construct-gate oracle unlock a', 'cd x && construct-gate oracle unlock a', 'sh -c "construct-gate oracle unlock a"', 'node --no-warnings /x/bin/construct-gate oracle unlock a', 'env construct-gate oracle unlock a', 'command construct-gate oracle unlock a', 'xargs construct-gate oracle unlock a', 'npx construct-gate oracle unlock a', 'xargs -I construct-gate construct-gate oracle unlock a']) denied(guard(c), /unlock/, /user/)
  })
  test('oracle list, status and unrelated commands stay allowed', () => {
    for (const c of ['construct-gate oracle list', 'construct-gate status', 'echo oracle unlock', 'ls']) silent(guard(c))
  })
})

describe('delegation-admission: an error in the lock check', () => {
  // The lock check throws when the lock's feature path cannot be read once a release ref exists (a NUL byte).
  const adm = (repo, prompt) => run(S('delegation-admission.mjs'), { session_id: 's1', cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'construct:worker', prompt, description: 'u' } })
  const repoBroken = () => {
    const repo = withRemote(makeRepo({ [PATH_]: 'one\n', 'odd/tasks/f.md': FEATURE('pending') }))
    writeOracle(repo, { path: PATH_, blob: git(repo, 'hash-object', PATH_).trim(), feature: 'odd/tasks/f\u0000.md', task: 'T1', at: Date.now() })
    return repo
  }
  test('a writer over a recorded lock is denied, and a writer without a Spec line still is', () => {
    const repo = repoBroken()
    denied(adm(repo, `Spec: odd/tasks/f.md, T1, S1\n\n## Allowed edit surfaces\n${PATH_}\n\n## Verification\n- x\n`), /locked oracle/)
    denied(adm(repo, '## Allowed edit surfaces\nsrc/a.js\n\n## Verification\n- x\n'), /Spec/)
  })
})

describe('command-guard: moving the release ref', () => {
  const guard = (command) => run(S('command-guard.mjs'), { session_id: 's1', cwd: process.cwd(), hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } })
  test('denies writing refs/remotes locally', () => {
    for (const c of ['git update-ref refs/remotes/origin/main HEAD', 'git update-ref -d refs/remotes/origin/main', 'git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/x', 'git remote set-head origin main', 'git remote set-head origin -d', 'git fetch origin +HEAD:refs/remotes/origin/main', 'git fetch origin HEAD:refs/remotes/origin/main', 'git -C x update-ref refs/remotes/origin/master abc', 'sh -c "git update-ref refs/remotes/origin/main HEAD"']) denied(guard(c), /Release refs/, /fetching/)
  })
  test('plain fetch, pull, and a local update-ref stay allowed', () => {
    for (const c of ['git fetch', 'git fetch origin', 'git fetch origin main', 'git pull', 'git pull origin main', 'git update-ref refs/heads/x HEAD', 'git symbolic-ref HEAD refs/heads/x', 'git symbolic-ref refs/remotes/origin/HEAD', 'git fetch origin x:refs/heads/y']) silent(guard(c))
  })
})
