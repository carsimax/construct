// construct-memory review stale (S5 of odd/tasks/wave3-loops.md): live observations whose Where: paths are gone.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { makeRepo, write } from '../helpers/repo.mjs'

const BIN = new URL('../../plugins/construct/bin/construct-memory', import.meta.url).pathname
const cli = (cwd, args, input = '') => spawnSync(BIN, args, { cwd, input, encoding: 'utf8' })
const save = (repo, title, where, type = 'bugfix') => cli(repo, ['save'], JSON.stringify({ title, type, content: `What: x\nWhere: ${where}` }))
const stale = (repo, ...args) => {
  const r = cli(repo, ['review', 'stale', ...args])
  assert.equal(r.status, 0, r.stderr)
  return r.stdout
}

describe('construct-memory review stale', () => {
  test('lists only memories whose path is gone, with the missing paths', () => {
    const repo = makeRepo()
    write(repo, 'src/here.mjs', 'x')
    save(repo, 'Present', 'src/here.mjs')
    save(repo, 'Gone', 'src/gone.mjs', 'decision')
    save(repo, 'Mixed', 'src/here.mjs, src/lost.mjs:12 and src/*.js ~/x /abs/p')
    save(repo, 'Prose', 'the parser')
    const out = stale(repo)
    assert.doesNotMatch(out, /Present/)
    assert.doesNotMatch(out, /Prose/)
    assert.match(out, /Gone.*src\/gone\.mjs/)
    const mixed = out.split('\n').find((l) => l.includes('Mixed'))
    assert.match(mixed, /src\/lost\.mjs/)
    assert.doesNotMatch(mixed, /here\.mjs|\*|~|\/abs/)
  })

  test('resolves from a subdirectory, skips deleted rows, prints json, and changes nothing', () => {
    const repo = makeRepo()
    write(repo, 'sub/keep.txt', 'x')
    save(repo, 'Gone', 'src/gone.mjs')
    save(repo, 'Deleted', 'src/del.mjs')
    cli(repo, ['delete', '2'])
    const dump = () => JSON.stringify(JSON.parse(cli(repo, ['export']).stdout).observations)
    const before = dump()
    const out = stale(join(repo, 'sub'))
    assert.match(out, /Gone/)
    assert.doesNotMatch(out, /Deleted/)
    const rows = JSON.parse(stale(repo, '--json'))
    assert.deepEqual(rows.map((r) => [r.id, r.missing]), [[1, ['src/gone.mjs']]])
    assert.equal(dump(), before)
    assert.equal(stale(makeRepo()), 'nothing stale\n')
  })

  test('help names the command and other review forms keep working', () => {
    const repo = makeRepo()
    assert.match(cli(repo, ['help']).stdout, /review stale/)
    assert.equal(cli(repo, ['review', 'list']).stdout, 'nothing to review\n')
    assert.notEqual(cli(repo, ['review', 'stale', 'x']).status, 0)
  })
})
