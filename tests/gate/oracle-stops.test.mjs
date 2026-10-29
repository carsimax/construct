// S4, S5 and the T5 hardening (.vault/tasks/oracle-separation.md): early stops for a locked oracle (surface-guard,
// delegation-admission), the `construct-gate oracle` CLI, the command-guard deny, and the fail-closed record rules.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { applyFiles, commitAll, git, makeRepo, scratchDir, write } from '../helpers/repo.mjs'
import { readOracles, writeEnvelope, writeOracle } from '../../plugins/construct/hooks/scripts/review-store.mjs'

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

// lockedRepo: the oracle file and the feature document are committed on main; the oracle is locked for .vault/tasks/f.md.
function lockedRepo({ doc = FEATURE('pending'), feature = '.vault/tasks/f.md', path = PATH_ } = {}) {
  const repo = makeRepo({ [path]: 'one\n', '.vault/tasks/f.md': doc, 'src/a.js': 'a\n' })
  writeOracle(repo, { path, blob: git(repo, 'hash-object', path).trim(), feature, task: 'T1', at: Date.now() })
  // The oracle's envelope covers every path, so a worker on code is admitted (S1 of oracle-limits).
  writeEnvelope(repo, { feature, task: 'T1', command: 'true', surfaces: ['**'], attempts: 5, minutes: 30, lines: 400, at: 1 })
  return repo
}
// withRemote: origin/main exists, so a finished document on main releases the lock.
function withRemote(repo) {
  const bare = join(scratchDir('odd-stops-remote-'), 'origin.git')
  git(repo, 'clone', '-q', '--bare', repo, bare)
  git(repo, 'remote', 'add', 'origin', bare)
  git(repo, 'fetch', '-q', 'origin')
  git(repo, 'remote', 'set-head', 'origin', 'main')
  for (const lock of readOracles(repo)) writeOracle(repo, { ...lock, remote: bare }) // the lock pins the URL it was recorded against
  return repo
}
// breakRelease makes every git read of the release ref fail.
const breakRelease = (repo) => writeFileSync(join(repo, '.git', 'refs', 'remotes', 'origin', 'HEAD'), 'garbage\n')
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
      denied(guard(repo, tool, input), /locked oracle for \.vault\/tasks\/f\.md/, /oracle_conflict/, /construct-gate oracle unlock tests\/a\.test\.mjs/)
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
    // Main thread: code is never written inline (oracle-limits S1); a writer over src/a.js is not blocked by the lock.
    const repo = lockedRepo()
    denied(guard(repo, 'Write', { file_path: 'src/a.js', content: 'x\n' }), /construct:worker/)
    const data = { CLAUDE_PLUGIN_DATA: scratchDir('odd-stops-writer-') }
    const spawn = (args, input) => spawnSync('node', [S('delegation-admission.mjs'), ...args], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ...data } })
    spawn([], { session_id: 's1', cwd: repo, tool_name: 'Agent', tool_input: { subagent_type: 'construct:worker', prompt: 'Spec: .vault/tasks/f.md, T1, S1\n\n## Allowed edit surfaces\nsrc/a.js\n\n## Verification\n- x\n', description: 'u' } })
    spawn(['start'], { session_id: 's1', agent_id: 'a1', agent_type: 'construct:worker' })
    silent(run(S('surface-guard.mjs'), { session_id: 's1', cwd: repo, agent_id: 'a1', tool_name: 'Write', tool_input: { file_path: 'src/a.js', content: 'x\n' } }, data))
    // A released lock no longer denies as a lock: the main thread is stopped only by the code rule.
    const open = guard(released(), 'Write', { file_path: PATH_, content: 'x\n' })
    denied(open, /is code/)
    assert.doesNotMatch(open.reason, /locked oracle/)
  })
  test('fails open on bad input', () => {
    silent(run(S('surface-guard.mjs'), 'not json'))
  })
})

describe('delegation-admission: locked oracles', () => {
  const surfaces = (...p) => `## Allowed edit surfaces\n${p.join('\n')}\n`
  const launch = (repo, type, prompt) => run(S('delegation-admission.mjs'), { session_id: 's1', cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: type, prompt, description: 'unit' } })
  const SPEC = 'Spec: .vault/tasks/f.md, T1, S1\n'
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
    write(repo, '.vault/tasks/g.md', FEATURE('pending'))
    denied(launch(repo, 'construct:oracle', `Spec: .vault/tasks/g.md, T1\n${surfaces(PATH_)}`), /locked oracle for \.vault\/tasks\/f\.md/)
  })
  test('an oracle over a path whose lock is released is admitted', () => {
    const repo = released()
    write(repo, '.vault/tasks/g.md', FEATURE('pending'))
    silent(launch(repo, 'construct:oracle', `Spec: .vault/tasks/g.md, T1\n${surfaces(PATH_)}`))
  })
})

const featBranch2 = (repo) => {
  applyFiles(repo, { 'src/a.js': 'x\n' })
  commitAll(repo, 'unit')
}

describe('oracle-record: released locks and unlockable surfaces', () => {
  const transcript = (...paths) => {
    const file = join(scratchDir('odd-stops-t-'), 't.jsonl')
    const text = `Write tests.\n\nSpec: .vault/tasks/g.md, T2 (covers S1)\n\n## Allowed edit surfaces\n${paths.join('\n')}\n`
    writeFileSync(file, `${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`)
    return file
  }
  const stop = (repo, ...paths) => run(S('oracle-record.mjs'), { session_id: 's1', agent_id: 'a1', agent_type: 'construct:oracle', cwd: repo, agent_transcript_path: transcript(...paths) })
  test('a new oracle run replaces a released lock', () => {
    const repo = released()
    write(repo, PATH_, 'two\n')
    stop(repo, PATH_)
    const [lock] = readOracles(repo)
    assert.equal(lock.feature, '.vault/tasks/g.md')
    assert.equal(lock.blob, git(repo, 'hash-object', PATH_).trim())
  })
  test('an active lock is still kept', () => {
    const repo = lockedRepo()
    write(repo, PATH_, 'two\n')
    stop(repo, PATH_)
    assert.equal(readOracles(repo)[0].feature, '.vault/tasks/f.md')
  })
  test('a symlink surface is locked with a sentinel the gate reports as changed', () => {
    const repo = makeRepo({ '.vault/tasks/f.md': FEATURE('pending'), 'real.txt': 'r\n' })
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
    const repo = makeRepo({ '.vault/tasks/f.md': FEATURE('pending'), 'real.txt': 'r\n' })
    symlinkSync('real.txt', join(repo, 'tests-link'))
    stop(repo, 'tests-link')
    git(repo, 'checkout', '-q', '-b', 'feat')
    unlinkSync(join(repo, 'tests-link')) // commitAll adds everything: the ref must never carry the path
    featBranch2(repo)
    silent(push(repo))
  })
  test('a directory surface is locked with the sentinel too', () => {
    const repo = makeRepo({ '.vault/tasks/f.md': FEATURE('pending') })
    mkdirSync(join(repo, 'tests/dir'), { recursive: true })
    write(repo, 'tests/dir/x.mjs', 'x\n')
    stop(repo, 'tests/dir')
    assert.equal(readOracles(repo).length, 1)
  })
})

describe('publication-gate: record faults and bounded work', () => {
  test('a corrupt lock record denies publishing naming the file (S3 of guarantees); it is not a lock', () => {
    const repo = lockedRepo()
    const name = readdirSync(oraclesDir(repo))[0]
    writeFileSync(join(oraclesDir(repo), name), '{not json')
    featBranch(repo)
    denied(push(repo), new RegExp(name.replace('.', '\\.')))
    assert.deepEqual(readOracles(repo), [])
  })
  test('a valid record whose git probe errors still denies', () => {
    const repo = makeRepo({ '.vault/tasks/f.md': FEATURE('pending') })
    writeOracle(repo, { path: PATH_, blob: 'not-an-object-id', feature: '.vault/tasks/f.md', task: 'T1', at: Date.now() })
    featBranch(repo)
    denied(push(repo), /could not be checked/)
  })
  test('a lock whose release state cannot be read is kept alone: an unrelated ref still publishes', () => {
    const repo = withRemote(makeRepo({ '.vault/tasks/f.md': FEATURE('pending'), 'tests/a.test.mjs': 'one\n', 'src/a.js': 'a\n' }))
    writeOracle(repo, { path: 'tests/zzz.test.mjs', blob: '1'.repeat(40), feature: '.vault/tasks/f\u0000.md', task: 'T1', at: Date.now() })
    writeOracle(repo, { path: PATH_, blob: git(repo, 'hash-object', PATH_).trim(), feature: '.vault/tasks/f.md', task: 'T1', at: Date.now() })
    featBranch(repo)
    silent(push(repo))
    const r = spawnSync('node', [GATE, 'oracle', 'list'], { cwd: repo, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /tests\/zzz\.test\.mjs.*\terror\b/)
    assert.match(r.stdout, /tests\/a\.test\.mjs\s+\.vault\/tasks\/f\.md\s+T1\s+active/)
  })
  test('the feature document is read once per feature, however many locks share it', () => {
    const tests = ['tests/a.test.mjs', 'tests/b.test.mjs', 'tests/c.test.mjs']
    const repo = withRemote(makeRepo({ '.vault/tasks/f.md': FEATURE('pending'), 'tests/a.test.mjs': '1\n', 'tests/b.test.mjs': '2\n', 'tests/c.test.mjs': '3\n' }))
    for (const p of tests) writeOracle(repo, { path: p, blob: git(repo, 'hash-object', p).trim(), feature: '.vault/tasks/f.md', task: 'T1', at: Date.now() })
    featBranch(repo)
    const trace = join(scratchDir('odd-stops-trace-'), 'trace')
    const bin = scratchDir('odd-stops-bin-')
    const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim()
    writeFileSync(join(bin, 'git'), `#!/bin/sh\necho "$@" >> ${trace}\nexec ${realGit} "$@"\n`, { mode: 0o755 })
    silent(push(repo, { PATH: `${bin}:${process.env.PATH}` }))
    const lines = readFileSync(trace, 'utf8').split('\n').map((l) => l.replace(/^--no-replace-objects (-C \S+ )?/, ''))
    assert.equal(lines.filter((l) => /^show .*\.vault\/tasks\/f\.md/.test(l)).length, 1)
    assert.equal(lines.filter((l) => /^ls-tree .*\.vault\/tasks\/f\.md/.test(l)).length, 1)
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
    assert.match(first.stdout, /tests\/a\.test\.mjs\s+\.vault\/tasks\/f\.md\s+T1\s+active\s+matches/)
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
    assert.match(r.stdout, /\.vault\/tasks\/f\.md/)
    assert.deepEqual(readOracles(repo), [])
  })
  test('unlock accepts ./path, a doubled slash and an absolute path inside the repository, and rejects one outside', () => {
    for (const spelling of ['./tests/a.test.mjs', 'tests//a.test.mjs', 'tests/./a.test.mjs', (repo) => join(repo, PATH_)]) {
      const repo = lockedRepo()
      const r = cli(repo, 'unlock', typeof spelling === 'function' ? spelling(repo) : spelling)
      assert.equal(r.status, 0, r.stderr)
      assert.match(r.stdout, /unlocked tests\/a\.test\.mjs/)
      assert.deepEqual(readOracles(repo), [])
    }
    const repo = lockedRepo()
    const outside = cli(repo, 'unlock', join(scratchDir('odd-stops-out-'), 'a.test.mjs'))
    assert.equal(outside.status, 1)
    assert.match(outside.stderr, /outside the repository/)
    assert.equal(cli(repo, 'unlock', '../a.test.mjs').status, 1)
    assert.equal(readOracles(repo).length, 1)
  })
  test('unlock refuses a path with a symlink under the repository root, so it never follows a link to another lock', () => {
    const repo = lockedRepo()
    symlinkSync('a.test.mjs', join(repo, 'tests/link.test.mjs'))
    symlinkSync('tests', join(repo, 'dir'))
    for (const p of ['tests/link.test.mjs', 'dir/a.test.mjs']) {
      const r = cli(repo, 'unlock', p)
      assert.equal(r.status, 1, p)
      assert.match(r.stderr, /symlink/)
    }
    assert.equal(readOracles(repo).length, 1)
    assert.equal(cli(repo, 'unlock', PATH_).status, 0)
  })
  test('unlock releases a lock stored for the symlink itself, matched as typed without following it', () => {
    const repo = lockedRepo()
    symlinkSync('a.test.mjs', join(repo, 'tests/link.test.mjs'))
    writeOracle(repo, { path: 'tests/link.test.mjs', blob: 'unlockable', feature: '.vault/tasks/f.md', task: 'T1', at: Date.now() })
    const r = cli(repo, 'unlock', 'tests/link.test.mjs')
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(readOracles(repo).map((l) => l.path), [PATH_])
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
    const repo = withRemote(makeRepo({ [PATH_]: 'one\n', '.vault/tasks/f.md': FEATURE('pending') }))
    writeOracle(repo, { path: PATH_, blob: git(repo, 'hash-object', PATH_).trim(), feature: '.vault/tasks/f\u0000.md', task: 'T1', at: Date.now() })
    return repo
  }
  test('a writer over a recorded lock is denied, and a writer without a Spec line still is', () => {
    const repo = repoBroken()
    denied(adm(repo, `Spec: .vault/tasks/f.md, T1, S1\n\n## Allowed edit surfaces\n${PATH_}\n\n## Verification\n- x\n`), /locked oracle/)
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

describe('activeLocks never throws', () => {
  const transcript = (path) => {
    const file = join(scratchDir('odd-stops-t-'), 't.jsonl')
    writeFileSync(file, `${JSON.stringify({ type: 'user', message: { role: 'user', content: `Write.\n\nSpec: .vault/tasks/g.md, T2 (covers S1)\n\n## Allowed edit surfaces\n${path}\n` } })}\n`)
    return file
  }
  test('oracle-record still records a new lock when the release ref cannot be read, and keeps the old one', () => {
    const repo = withRemote(lockedRepo())
    breakRelease(repo)
    write(repo, 'tests/b.test.mjs', 'b\n')
    run(S('oracle-record.mjs'), { session_id: 's1', agent_id: 'a1', agent_type: 'construct:oracle', cwd: repo, agent_transcript_path: transcript('tests/b.test.mjs') })
    assert.deepEqual(readOracles(repo).map((l) => l.path).sort(), [PATH_, 'tests/b.test.mjs'])
  })
  test('oracle list exits 0 and shows every lock with the error', () => {
    const repo = withRemote(lockedRepo())
    breakRelease(repo)
    const r = spawnSync('node', [GATE, 'oracle', 'list'], { cwd: repo, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /tests\/a\.test\.mjs.*\terror\t/)
  })
})

describe('oracle-record: pins the remote URL', () => {
  test('the new lock records remote.origin.url at lock time', () => {
    const repo = withRemote(makeRepo({ '.vault/tasks/f.md': FEATURE('pending') }))
    write(repo, PATH_, 'one\n')
    const file = join(scratchDir('odd-stops-t-'), 't.jsonl')
    writeFileSync(file, `${JSON.stringify({ type: 'user', message: { role: 'user', content: `W.\n\nSpec: .vault/tasks/g.md, T2 (covers S1)\n\n## Allowed edit surfaces\n${PATH_}\n` } })}\n`)
    run(S('oracle-record.mjs'), { session_id: 's1', agent_id: 'a1', agent_type: 'construct:oracle', cwd: repo, agent_transcript_path: file })
    assert.equal(readOracles(repo)[0].remote, git(repo, 'config', '--get', 'remote.origin.url').trim())
  })
})

describe('publication-gate: the release ref is verified against the recorded remote', () => {
  // A commit on a side branch that finishes the feature; the lock was recorded against the real origin.
  const setup = () => {
    const repo = withRemote(lockedRepo())
    git(repo, 'checkout', '-q', '-b', 'side')
    applyFiles(repo, { '.vault/tasks/f.md': FEATURE('done (ok)') })
    commitAll(repo, 'finish')
    featBranch2(repo)
    return repo
  }
  const featBranch2 = (repo) => {
    git(repo, 'checkout', '-q', 'main')
    git(repo, 'checkout', '-q', '-b', 'feat')
    applyFiles(repo, { [PATH_]: 'two\n' })
    commitAll(repo, 'edit oracle')
  }
  test('a release ref moved locally to a finished document keeps the lock', () => {
    const repo = setup()
    git(repo, 'update-ref', 'refs/remotes/origin/main', 'side')
    denied(push(repo), /changed/)
  })
  test('pointing remote.origin.url at the local repo does not release the lock', () => {
    const repo = setup()
    git(repo, 'update-ref', 'refs/remotes/origin/main', 'side')
    git(repo, 'branch', '-f', 'main', 'side')
    git(repo, 'config', 'remote.origin.url', '.')
    denied(push(repo), /changed/)
  })
  test('repository config cannot redirect the recorded remote (url.insteadOf)', () => {
    const repo = setup()
    git(repo, 'update-ref', 'refs/remotes/origin/main', 'side')
    git(repo, 'branch', '-f', 'main', 'side')
    const url = readOracles(repo)[0].remote
    git(repo, 'config', `url.${repo}.insteadOf`, url)
    denied(push(repo), /changed/)
  })
  test('a feature genuinely finished on origin and fetched releases the lock', () => {
    const repo = setup()
    git(repo, 'push', '-q', 'origin', 'side:main')
    git(repo, 'fetch', '-q', 'origin')
    silent(push(repo))
  })
  test('an unreachable remote keeps the lock', () => {
    const repo = setup()
    git(repo, 'push', '-q', 'origin', 'side:main')
    git(repo, 'fetch', '-q', 'origin')
    for (const lock of readOracles(repo)) writeOracle(repo, { ...lock, remote: join(scratchDir('odd-stops-none-'), 'missing.git') })
    denied(push(repo), /changed/)
  })
  test('a remote whose transport hangs past the ls-remote timeout keeps the lock', async () => {
    const repo = setup()
    git(repo, 'push', '-q', 'origin', 'side:main')
    git(repo, 'fetch', '-q', 'origin')
    // The kernel accepts the connection into the backlog; nobody answers, so git:// waits until the timeout kills it.
    const server = createServer()
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      for (const lock of readOracles(repo)) writeOracle(repo, { ...lock, remote: `git://127.0.0.1:${server.address().port}/x.git` })
      const started = Date.now()
      denied(push(repo, { CONSTRUCT_LS_REMOTE_TIMEOUT_MS: '500' }), /changed/)
      assert.ok(Date.now() - started < 10000)
    } finally {
      server.close()
    }
  })
  test('a recorded remote that reads as an option is never passed to git, and keeps the lock', () => {
    const repo = setup()
    git(repo, 'push', '-q', 'origin', 'side:main')
    git(repo, 'fetch', '-q', 'origin')
    const marker = join(scratchDir('odd-stops-opt-'), 'ran')
    for (const lock of readOracles(repo)) writeOracle(repo, { ...lock, remote: `--upload-pack=touch ${marker}` })
    denied(push(repo), /changed/)
    assert.equal(existsSync(marker), false)
  })
  test('a lock without a recorded remote is kept', () => {
    const repo = setup()
    git(repo, 'push', '-q', 'origin', 'side:main')
    git(repo, 'fetch', '-q', 'origin')
    for (const { remote, ...lock } of readOracles(repo)) writeOracle(repo, lock)
    denied(push(repo), /changed/)
  })
})
