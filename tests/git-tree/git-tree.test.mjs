// The shared git helpers of the risk-line hook.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWrite, freezeWorkingTree, git, headCommit, repositoryRoot } from '../../plugins/construct/hooks/scripts/git-tree.mjs'
import { applyFiles, git as sh, makeRepo, scratchDir } from '../helpers/repo.mjs'

describe('git-tree', () => {
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
