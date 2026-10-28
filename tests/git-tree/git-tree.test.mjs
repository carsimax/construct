// The shared git helpers of the risk-line hook.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, lutimesSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { atomicWrite, freezeWorkingTree, git, headCommit, repositoryRoot } from '../../plugins/construct/hooks/scripts/git-tree.mjs'
import { applyFiles, git as sh, makeRepo, scratchDir } from '../helpers/repo.mjs'

describe('git-tree', () => {
  test('freezeWorkingTree sees a same-size rewrite whose mtime was restored, in a settled (non-racy) index', () => {
    const repo = makeRepo({ 'a.txt': 'a\n' })
    // The rewrite's ctime only differs when it crosses a second boundary; ignore ctime so the stat cache always matches.
    sh(repo, 'config', 'core.trustctime', 'false')
    const second = Math.floor(Date.now() / 1000) - 100
    utimesSync(join(repo, 'a.txt'), second, second)
    sh(repo, 'update-index', '--refresh')
    utimesSync(join(repo, '.git', 'index'), second + 50, second + 50)
    const { baseTree } = freezeWorkingTree(repo)
    writeFileSync(join(repo, 'a.txt'), 'b\n')
    utimesSync(join(repo, 'a.txt'), second, second)
    const frozen = freezeWorkingTree(repo)
    assert.notEqual(frozen.candidateTree, baseTree)
    assert.equal(frozen.degraded, false)
    // the degraded, index-seeded snapshot trusts the stat cache: that is the weakness the full hash removes
    assert.equal(freezeWorkingTree(repo, { indexSeeded: true }).candidateTree, baseTree)
  })

  test('freezeWorkingTree falls back to the index-seeded snapshot when the budget runs out, and says so', () => {
    const repo = makeRepo({ 'a.txt': 'a\n' })
    applyFiles(repo, { 'new.txt': 'n\n' })
    const full = freezeWorkingTree(repo)
    // A private TMPDIR: other test files freeze trees in the shared one concurrently.
    const saved = process.env.TMPDIR
    process.env.TMPDIR = scratchDir('odd-git-tree-tmp-')
    try {
      const frozen = freezeWorkingTree(repo, { budgetMs: 1 })
      assert.equal(frozen.degraded, true)
      assert.equal(frozen.candidateTree, full.candidateTree)
      assert.deepEqual(readdirSync(tmpdir()).filter((n) => n.startsWith('construct-index-')), [])
    } finally {
      if (saved === undefined) delete process.env.TMPDIR
      else process.env.TMPDIR = saved
    }
  })

  test('freezeWorkingTree throws a timed-out error when the HEAD-seeded fallback exceeds its budget', () => {
    const repo = makeRepo({ 'a.txt': 'a\n' })
    // an assume-unchanged entry forces the fallback to seed from HEAD instead of the real index
    sh(repo, 'update-index', '--assume-unchanged', 'a.txt')
    const saved = process.env.TMPDIR
    process.env.TMPDIR = scratchDir('odd-git-tree-tmp-')
    try {
      assert.throws(() => freezeWorkingTree(repo, { budgetMs: 1, fallbackBudgetMs: 1 }), (error) => error.name === 'GitError' && error.timedOut === true)
      assert.deepEqual(readdirSync(tmpdir()).filter((n) => n.startsWith('construct-index-')), [])
      assert.equal(freezeWorkingTree(repo, { budgetMs: 1 }).degraded, true)
    } finally {
      if (saved === undefined) delete process.env.TMPDIR
      else process.env.TMPDIR = saved
    }
  })

  test('freezeWorkingTree gives the right tree with a split index', () => {
    const repo = makeRepo({ 'a.txt': 'a\n', 'b.txt': 'b\n' })
    sh(repo, 'config', 'core.splitIndex', 'true')
    sh(repo, 'update-index', '--split-index')
    writeFileSync(join(repo, 'a.txt'), 'changed\n')
    applyFiles(repo, { 'new.txt': 'n\n' })
    const fresh = join(scratchDir('odd-git-tree-'), 'index')
    const env = { GIT_INDEX_FILE: fresh }
    git(repo, ['read-tree', 'HEAD'], { env })
    git(repo, ['add', '-A'], { env })
    const expected = git(repo, ['write-tree'], { env }).toString().trim()
    assert.equal(freezeWorkingTree(repo).candidateTree, expected)
    assert.equal(freezeWorkingTree(repo, { indexSeeded: true }).candidateTree, expected)
  })

  test('pruneState removes stale construct-index directories only', () => {
    const tmp = scratchDir('odd-git-tree-')
    const week = new Date(Date.now() - 8 * 24 * 3600 * 1000)
    for (const name of ['construct-index-old', 'construct-index-new', 'other-old']) mkdirSync(join(tmp, name), { mode: 0o700 })
    // a stale one others can write is not a snapshot of ours
    mkdirSync(join(tmp, 'construct-index-shared'))
    chmodSync(join(tmp, 'construct-index-shared'), 0o777)
    utimesSync(join(tmp, 'construct-index-shared'), week, week)
    // a stale entry that is not a directory (here a symlink) is never followed or removed
    symlinkSync(join(tmp, 'other-old'), join(tmp, 'construct-index-link'))
    for (const name of ['construct-index-old', 'other-old']) utimesSync(join(tmp, name), week, week)
    lutimesSync(join(tmp, 'construct-index-link'), week, week)
    const hookIo = new URL('../../plugins/construct/hooks/scripts/hook-io.mjs', import.meta.url).pathname
    const r = spawnSync('node', ['-e', `import(${JSON.stringify(hookIo)}).then((m) => m.pruneState())`], {
      env: { ...process.env, TMPDIR: tmp, CLAUDE_PLUGIN_DATA: scratchDir('odd-git-tree-') },
    })
    assert.equal(r.status, 0)
    assert.deepEqual(readdirSync(tmp).sort(), ['construct-index-link', 'construct-index-new', 'construct-index-shared', 'other-old'])
  })

  test('freezeWorkingTree includes an untracked file and leaves the index alone', () => {
    const repo = makeRepo({ 'a.txt': 'a\n' })
    const { baseTree, candidateTree } = freezeWorkingTree(repo)
    assert.equal(candidateTree, baseTree)
    applyFiles(repo, { 'new.txt': 'n\n' })
    const frozen = freezeWorkingTree(repo)
    assert.equal(frozen.baseTree, baseTree)
    assert.notEqual(frozen.candidateTree, baseTree)
    assert.match(git(repo, ['ls-tree', '-r', '--name-only', frozen.candidateTree]).toString(), /^new\.txt$/m)
    assert.equal(sh(repo, 'status', '--porcelain', '--', 'new.txt').trim(), '?? new.txt')
  })

  test('freezeWorkingTree gives the same tree as a fresh HEAD index, whatever the real index holds', () => {
    const repo = makeRepo({ 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n' })
    writeFileSync(join(repo, 'a.txt'), 'staged\n')
    sh(repo, 'add', 'a.txt')
    writeFileSync(join(repo, 'a.txt'), 'worktree\n')
    sh(repo, 'rm', '-q', '--cached', 'b.txt')
    rmSync(join(repo, 'c.txt'))
    applyFiles(repo, { 'new.txt': 'n\n' })
    const index = readFileSync(join(repo, '.git', 'index'))
    const fresh = join(scratchDir('odd-git-tree-'), 'index')
    const env = { GIT_INDEX_FILE: fresh }
    git(repo, ['read-tree', 'HEAD'], { env })
    git(repo, ['add', '-A'], { env })
    const expected = git(repo, ['write-tree'], { env }).toString().trim()
    assert.equal(freezeWorkingTree(repo).candidateTree, expected)
    assert.deepEqual(readFileSync(join(repo, '.git', 'index')), index)
  })

  test('freezeWorkingTree sees a change to an assume-unchanged or skip-worktree file', () => {
    for (const flag of ['--assume-unchanged', '--skip-worktree']) {
      const repo = makeRepo({ 'a.txt': 'a\n' })
      const { baseTree } = freezeWorkingTree(repo)
      sh(repo, 'update-index', flag, 'a.txt')
      writeFileSync(join(repo, 'a.txt'), 'changed\n')
      assert.notEqual(freezeWorkingTree(repo).candidateTree, baseTree, flag)
    }
  })

  test('freezeWorkingTree sees a same-size change made in the same second as the index (racily clean)', () => {
    const repo = makeRepo({ 'a.txt': 'a\n' })
    const second = Math.floor(Date.now() / 1000) - 100
    utimesSync(join(repo, 'a.txt'), second, second)
    sh(repo, 'update-index', '--refresh')
    utimesSync(join(repo, '.git', 'index'), second, second)
    const { baseTree } = freezeWorkingTree(repo)
    writeFileSync(join(repo, 'a.txt'), 'b\n')
    utimesSync(join(repo, 'a.txt'), second, second)
    assert.notEqual(freezeWorkingTree(repo).candidateTree, baseTree)
  })

  test('headCommit is null on an unborn repository and freezeWorkingTree uses the empty tree', () => {
    const repo = scratchDir('odd-git-tree-')
    sh(repo, 'init', '-q', '-b', 'main')
    assert.equal(headCommit(repo), null)
    const { baseTree, candidateTree } = freezeWorkingTree(repo)
    assert.equal(candidateTree, baseTree)
    assert.equal(repositoryRoot(repo), git(repo, ['rev-parse', '--show-toplevel']).toString().trim())
  })

  test('headCommit names HEAD, and git throws on a failing command', () => {
    const repo = makeRepo()
    assert.equal(headCommit(repo), sh(repo, 'rev-parse', 'HEAD').trim())
    assert.throws(() => git(repo, ['rev-parse', '--verify', 'no-such-ref']), /failed/)
  })

  test('atomicWrite creates parents, replaces the file, and leaves no temporary file', () => {
    const dir = scratchDir('odd-git-tree-')
    const file = join(dir, 'a', 'b.json')
    atomicWrite(file, 'one\n')
    atomicWrite(file, 'two\n')
    assert.equal(readFileSync(file, 'utf8'), 'two\n')
    assert.equal(existsSync(join(dir, 'a', 'b.json.tmp')), false)
  })
})
