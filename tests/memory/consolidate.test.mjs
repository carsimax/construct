// Consolidate (S18 of odd/tasks/construct-memory.md): preview with a fingerprint, confirm in one transaction.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { makeRepo } from '../helpers/repo.mjs'

const BIN = new URL('../../plugins/construct/bin/construct-memory', import.meta.url).pathname
const { openMemory } = await import(new URL('../../plugins/construct/hooks/scripts/memory-store.mjs', import.meta.url))

const cli = (cwd, args, input = '') => spawnSync(BIN, args, { cwd, encoding: 'utf8', input })
const rows = (store, sql) => {
  const db = new DatabaseSync(store.path)
  try {
    return db.prepare(sql).all()
  } finally {
    db.close()
  }
}
const version = (store) => rows(store, 'PRAGMA data_version')[0].data_version
const counts = (store) => rows(store, 'SELECT (SELECT count(*) FROM observations) o, (SELECT count(*) FROM memory_relations) r, (SELECT count(*) FROM observation_versions) v')[0]
const setup = () => {
  const repo = makeRepo()
  const store = openMemory(repo)
  const a = store.save({ title: 'Cache v1', content: 'cache is 5 minutes', type: 'decision' }).id
  const b = store.save({ title: 'Cache v2', content: 'cache is 10 minutes', type: 'decision' }).id
  const c = store.save({ title: 'Cache v3', content: 'cache is 30 minutes' }).id
  return { repo, store, a, b, c }
}
const merged = { title: 'Cache policy', content: 'cache is 30 minutes', type: 'decision' }

describe('store.consolidate', () => {
  test('without confirm it previews and writes nothing', () => {
    const { store, a, b } = setup()
    const before = counts(store)
    const v = version(store)
    const p = store.consolidate([a, b], merged)
    assert.deepEqual(p.sources, [
      { id: a, type: 'decision', title: 'Cache v1' },
      { id: b, type: 'decision', title: 'Cache v2' },
    ])
    assert.equal(p.title, 'Cache policy')
    assert.match(p.fingerprint, /^[0-9a-f]{64}$/)
    assert.deepEqual(counts(store), before)
    assert.equal(version(store), v)
    assert.equal(store.consolidate([b, a], merged).fingerprint, p.fingerprint, 'id order does not matter')
    assert.notEqual(store.consolidate([a, b], { ...merged, content: 'other' }).fingerprint, p.fingerprint)
  })

  test('confirm creates one row, soft-deletes the sources, and records supersedes relations', () => {
    const { store, a, b, c } = setup()
    const { fingerprint } = store.consolidate([a, b], { ...merged, topic_key: 'Cache Policy' })
    const out = store.consolidate([a, b], { ...merged, topic_key: 'Cache Policy', confirm: fingerprint })
    assert.equal(out.id, c + 1)
    assert.deepEqual(out.sources, [a, b])
    const row = store.get(out.id)
    assert.equal(row.title, 'Cache policy')
    assert.equal(row.type, 'decision')
    assert.equal(row.topic_key, 'cache-policy')
    assert.ok(row.review_after, 'decision gets review_after')
    assert.match(row.normalized_hash, /^[0-9a-f]{64}$/)
    assert.equal(store.get(a), null)
    assert.equal(store.get(b), null)
    assert.ok(store.get(c))
    assert.deepEqual(row.marks, [`supersedes #${a} (deleted)`, `supersedes #${b} (deleted)`])
    const rels = rows(store, 'SELECT * FROM memory_relations ORDER BY rowid')
    assert.equal(rels.length, 2)
    for (const [i, id] of [a, b].entries()) {
      assert.equal(rels[i].source_id, out.id)
      assert.equal(rels[i].target_id, id)
      assert.equal(rels[i].relation, 'supersedes')
      assert.equal(rels[i].status, 'judged')
    }
    assert.equal(rows(store, 'SELECT count(*) n FROM observations').at(0).n, 4)
  })

  test('get on the consolidated row shows its supersedes relations to the deleted sources', () => {
    const { store, a, b } = setup()
    const { fingerprint } = store.consolidate([a, b], merged)
    const { id } = store.consolidate([a, b], { ...merged, confirm: fingerprint })
    assert.deepEqual(store.get(id).marks, [`supersedes #${a} (deleted)`, `supersedes #${b} (deleted)`])
    assert.deepEqual(store.search('policy')[0].marks, [`supersedes #${a} (deleted)`, `supersedes #${b} (deleted)`])
    assert.equal(rows(store, "SELECT count(*) n FROM memory_relations WHERE relation = 'supersedes' AND source_id = " + id)[0].n, 2)
  })

  test('the merged row is searchable and the sources are not', () => {
    const { store, a, b } = setup()
    const { fingerprint } = store.consolidate([a, b], merged)
    const { id } = store.consolidate([a, b], { ...merged, confirm: fingerprint })
    assert.deepEqual(store.search('Cache').map((r) => r.id).sort((x, y) => x - y), [3, id])
  })

  test('redaction and the content cap apply', () => {
    const { store, a, b } = setup()
    const input = { title: 'T <private>x</private>', content: `keep <private>secret</private> ${'z'.repeat(60000)}` }
    const { fingerprint } = store.consolidate([a, b], input)
    const { id } = store.consolidate([a, b], { ...input, confirm: fingerprint })
    const row = store.get(id)
    assert.equal(row.title, 'T [REDACTED]')
    assert.match(row.content, /^keep \[REDACTED\] z+\.\.\. \[truncated\]$/)
    assert.doesNotMatch(row.content, /secret/)
  })

  test('a source updated after the preview makes the fingerprint stale', () => {
    const { store, a, b } = setup()
    const { fingerprint } = store.consolidate([a, b], merged)
    store.update(b, { content: 'cache is 11 minutes' })
    const before = counts(store)
    assert.throws(() => store.consolidate([a, b], { ...merged, confirm: fingerprint }), /changed|deleted/)
    assert.deepEqual(counts(store), before)
    assert.ok(store.get(a))
  })

  test('a source deleted after the preview is refused with nothing written', () => {
    const { store, a, b } = setup()
    const { fingerprint } = store.consolidate([a, b], merged)
    store.remove(a)
    const before = counts(store)
    assert.throws(() => store.consolidate([a, b], { ...merged, confirm: fingerprint }), /not found|changed|deleted/)
    assert.deepEqual(counts(store), before)
    assert.ok(store.get(b))
  })

  test('a confirm with a different type or topic key than previewed is refused with nothing written', () => {
    const { store, a, b } = setup()
    const { fingerprint } = store.consolidate([a, b], { ...merged, topic_key: 'cache/policy' })
    const before = counts(store)
    assert.throws(() => store.consolidate([a, b], { ...merged, type: 'manual', topic_key: 'cache/policy', confirm: fingerprint }), /changed|deleted/)
    assert.throws(() => store.consolidate([a, b], { ...merged, topic_key: 'cache/other', confirm: fingerprint }), /changed|deleted/)
    assert.deepEqual(counts(store), before)
  })

  test('a wrong fingerprint, or different title or content than previewed, is refused', () => {
    const { store, a, b } = setup()
    const { fingerprint } = store.consolidate([a, b], merged)
    const before = counts(store)
    assert.throws(() => store.consolidate([a, b], { ...merged, confirm: 'nope' }), /changed|deleted/)
    assert.throws(() => store.consolidate([a, b], { ...merged, title: 'Other', confirm: fingerprint }), /changed|deleted/)
    assert.deepEqual(counts(store), before)
  })

  test('fewer than 2 ids, duplicates, unknown, and deleted ids are refused', () => {
    const { store, a, b } = setup()
    store.remove(b)
    assert.throws(() => store.consolidate([a], merged), /at least 2/)
    assert.throws(() => store.consolidate([], merged), /at least 2/)
    assert.throws(() => store.consolidate([a, a], merged), /duplicate/)
    assert.throws(() => store.consolidate([a, 999], merged), /#999 not found/)
    assert.throws(() => store.consolidate([a, b], merged), new RegExp(`#${b} not found`))
    assert.throws(() => store.consolidate([a, 3], { content: 'x' }), /title is required/)
    assert.throws(() => store.consolidate([a, 3], { title: 'x' }), /content is required/)
  })
})

describe('construct-memory consolidate', () => {
  const save = (repo, title, content) => cli(repo, ['save'], JSON.stringify({ title, content }))

  test('prints the preview and the confirm line, then consolidates with --confirm', () => {
    const repo = makeRepo()
    save(repo, 'Cache v1', 'five minutes')
    save(repo, 'Cache v2', 'ten minutes')
    const p = cli(repo, ['consolidate', '1', '2', '--title', 'Cache policy'], 'ten minutes')
    assert.equal(p.status, 0, p.stderr)
    assert.equal(p.stderr, '')
    assert.match(p.stdout, /#1 \[manual\] Cache v1/)
    assert.match(p.stdout, /#2 \[manual\] Cache v2/)
    assert.match(p.stdout, /new: Cache policy/)
    const m = p.stdout.match(/confirm with: construct-memory consolidate 1 2 --title "Cache policy" --confirm ([0-9a-f]{64})/)
    assert.ok(m, p.stdout)
    assert.match(cli(repo, ['search', 'Cache']).stdout, /#1/)
    const c = cli(repo, ['consolidate', '1', '2', '--title', 'Cache policy', '--confirm', m[1]], 'ten minutes')
    assert.equal(c.status, 0, c.stderr)
    assert.equal(c.stdout, 'consolidated #3 from #1, #2\n')
    assert.equal(c.stderr, '')
    assert.equal(cli(repo, ['get', '1']).status, 1)
    assert.match(cli(repo, ['get', '3']).stdout, /Cache policy/)
  })

  test('--type and --topic-key reach the new row', () => {
    const repo = makeRepo()
    save(repo, 'A one', 'a')
    save(repo, 'B two', 'b')
    const args = ['consolidate', '1', '2', '--title', 'AB', '--type', 'decision', '--topic-key', 'x/ab']
    const fp = cli(repo, args, 'merged').stdout.match(/--confirm ([0-9a-f]{64})/)[1]
    assert.equal(cli(repo, [...args, '--confirm', fp], 'merged').stdout, 'consolidated #3 from #1, #2\n')
    const g = cli(repo, ['get', '3']).stdout
    assert.match(g, /\[decision\]/)
    assert.match(g, /topic_key: x\/ab/)
  })

  test('errors are one line on stderr with exit 1 and nothing on stdout', () => {
    const repo = makeRepo()
    save(repo, 'A one', 'a')
    save(repo, 'B two', 'b')
    const bad = (args, input, re) => {
      const r = cli(repo, args, input)
      assert.equal(r.status, 1)
      assert.equal(r.stdout, '')
      assert.match(r.stderr, re)
      assert.equal(r.stderr.trim().split('\n').length, 1)
    }
    bad(['consolidate', '1', '--title', 'T'], 'c', /at least 2/)
    bad(['consolidate', '1', '1', '--title', 'T'], 'c', /duplicate/)
    bad(['consolidate', '1', '2'], 'c', /--title/)
    bad(['consolidate', '1', '2', '--title', 'T'], '  ', /content/)
    bad(['consolidate', '1', 'x', '--title', 'T'], 'c', /observation id/)
    bad(['consolidate', '1', '9', '--title', 'T'], 'c', /#9 not found/)
    bad(['consolidate', '1', '2', '--title', 'T', '--confirm', 'bad'], 'c', /changed|deleted/)
  })
})
