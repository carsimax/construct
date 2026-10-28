// T2 security fixes (.vault/tasks/oracle-separation.md, S4): lock matching in delegation-admission and surface-guard.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { git, makeRepo, scratchDir } from '../helpers/repo.mjs'
import { UNLOCKABLE, writeOracle } from '../../plugins/construct/hooks/scripts/review-store.mjs'

const S = (name) => new URL(`../../plugins/construct/hooks/scripts/${name}`, import.meta.url).pathname
const DOC = '# F\n\n## Tasks\n\n| ID | Specs | Task | Route | Risk | Status | Commit |\n|---|---|---|---|---|---|---|\n| T1 | S1 | work | worker | none | pending | - |\n\n## Log\n'
const run = (script, args, input, env = {}) => {
  const r = spawnSync('node', [script, ...args], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_DATA: scratchDir('odd-locks-data-'), ...env } })
  let json = null
  try {
    json = JSON.parse(r.stdout)
  } catch {
    // no output
  }
  return { status: r.status, stdout: r.stdout, decision: json?.hookSpecificOutput?.permissionDecision, reason: json?.hookSpecificOutput?.permissionDecisionReason }
}
const lock = (repo, path, blob, feature = '.vault/tasks/f.md') => writeOracle(repo, { path, blob, feature, task: 'T1', at: Date.now() })
const repoWith = () => makeRepo({ 'tests/a.test.mjs': 'one\n', '.vault/tasks/f.md': DOC, 'src/a.js': 'a\n' })

describe('delegation-admission: an oracle over an equivalent spelling of a locked path', () => {
  const launch = (repo, surface) => run(S('delegation-admission.mjs'), [], { session_id: 's1', cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'construct:oracle', prompt: `Spec: .vault/tasks/g.md, T1\n## Allowed edit surfaces\n${surface}\n`, description: 'u' } })
  test('is denied for ./path, a doubled slash and a dot segment', () => {
    const repo = repoWith()
    lock(repo, 'tests/a.test.mjs', git(repo, 'hash-object', 'tests/a.test.mjs').trim())
    for (const s of ['./tests/a.test.mjs', 'tests//a.test.mjs', 'tests/./a.test.mjs']) {
      const r = launch(repo, s)
      assert.equal(r.decision, 'deny', s)
      assert.match(r.reason, /locked oracle/)
    }
  })
})

describe('surface-guard: locks on symlinks and directories', () => {
  const guard = (repo, file_path, extra = {}) => run(S('surface-guard.mjs'), [], { session_id: 's1', cwd: repo, tool_name: 'Write', tool_input: { file_path, content: 'x\n' }, ...extra })
  test('a lock on a symlink denies a write through the link and to the link path', () => {
    const repo = repoWith()
    symlinkSync('a.test.mjs', join(repo, 'tests/link.test.mjs'))
    lock(repo, 'tests/link.test.mjs', UNLOCKABLE)
    for (const p of ['tests/link.test.mjs', 'tests/a.test.mjs']) {
      const r = guard(repo, join(repo, p))
      // the target a.test.mjs is not itself locked: only the link path is
      if (p === 'tests/link.test.mjs') assert.equal(r.decision, 'deny', p)
    }
  })
  test('a lock on a directory denies a path under it', () => {
    const repo = repoWith()
    lock(repo, 'tests', UNLOCKABLE)
    assert.equal(guard(repo, join(repo, 'tests/a.test.mjs')).decision, 'deny')
    assert.equal(guard(repo, join(repo, 'tests/new.test.mjs')).decision, 'deny')
    assert.equal(guard(repo, join(repo, 'src/a.js')).stdout, '')
  })
  test('a lock stored under a symlinked directory is matched by the canonical path', () => {
    const repo = repoWith()
    symlinkSync('tests', join(repo, 'alias'))
    lock(repo, 'alias', UNLOCKABLE)
    assert.equal(guard(repo, join(repo, 'tests/a.test.mjs')).decision, 'deny')
    assert.equal(guard(repo, join(repo, 'alias/a.test.mjs')).decision, 'deny')
  })
  test('a sibling with a common prefix is not locked', () => {
    const repo = repoWith()
    writeFileSync(join(repo, 'tests2.txt'), 'x\n')
    lock(repo, 'tests', UNLOCKABLE)
    assert.equal(guard(repo, join(repo, 'tests2.txt')).stdout, '')
  })
})

describe('surface-guard: an error in the lock check', () => {
  // A lock whose feature has a NUL byte makes the git read throw once a release ref exists, so activeLocks throws.
  function broken(repo = repoWith()) {
    const bare = join(scratchDir('odd-locks-remote-'), 'o.git')
    git(repo, 'clone', '-q', '--bare', repo, bare)
    git(repo, 'remote', 'add', 'origin', bare)
    git(repo, 'fetch', '-q', 'origin')
    git(repo, 'remote', 'set-head', 'origin', 'main')
    lock(repo, 'tests/a.test.mjs', git(repo, 'hash-object', 'tests/a.test.mjs').trim(), '.vault/tasks/f\u0000.md')
    return repo
  }
  const guard = (repo, path, extra, env) => run(S('surface-guard.mjs'), [], { session_id: 's1', cwd: repo, tool_name: 'Write', tool_input: { file_path: join(repo, path), content: 'x\n' }, ...extra }, env)
  test('fails closed for the locked path and keeps writer confinement', () => {
    const env = { CLAUDE_PLUGIN_DATA: scratchDir('odd-locks-w-') }
    // The worker is admitted before the lock record breaks activeLocks (admission would fail open otherwise).
    const clean = repoWith()
    const adm = (args, input) => run(S('delegation-admission.mjs'), args, input, env)
    adm([], { session_id: 's1', cwd: clean, tool_name: 'Agent', tool_input: { subagent_type: 'construct:worker', prompt: 'Spec: .vault/tasks/f.md, T1, S1\n\n## Allowed edit surfaces\nsrc/b.js\n\n## Verification\n- x\n', description: 'u' } })
    adm(['start'], { session_id: 's1', agent_id: 'a1', agent_type: 'construct:worker' })
    const repo = broken(clean)
    assert.equal(guard(repo, 'tests/a.test.mjs').decision, 'deny')
    assert.match(guard(repo, 'tests/a.test.mjs').reason, /locked oracle/)
    assert.equal(guard(repo, 'src/a.js').stdout, '')
    const r = guard(repo, 'src/a.js', { agent_id: 'a1' }, env)
    assert.equal(r.decision, 'deny')
    assert.match(r.reason, /outside your allowed edit surfaces/)
  })
})
