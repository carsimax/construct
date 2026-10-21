// The shared git helpers of the risk-line and mirror-drift hooks.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
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
