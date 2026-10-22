// `doctor` (S16 of odd/tasks/construct-memory.md): read-only health checks, in the store and the CLI.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { makeRepo } from '../helpers/repo.mjs'

const BIN = new URL('../../plugins/construct/bin/construct-memory', import.meta.url).pathname
const { openMemory } = await import(new URL('../../plugins/construct/hooks/scripts/memory-store.mjs', import.meta.url))

const cli = (cwd, args, input = '') => spawnSync(BIN, args, { cwd, input, encoding: 'utf8' })
const CHECKS = ['schema', 'integrity', 'fts observations', 'fts prompts', 'orphaned versions', 'orphaned relations', 'wal', 'db id', 'writable']

// seeded returns a repo whose store holds an observation with a version and a prompt.
function seeded() {
  const repo = makeRepo()
  const store = openMemory(repo)
  store.save({ title: 'Chose SQLite', content: 'One db per repo', topic_key: 'arch/db', session_id: 's1' })
  store.save({ title: 'Chose SQLite', content: 'One db per repo, reviewed', topic_key: 'arch/db', session_id: 's1' })
  store.addPrompt('s1', 'a prompt about databases')
  const path = store.path
  store.close()
  return { repo, path }
}
const raw = (path, sql) => {
  const db = new DatabaseSync(path)
  db.exec(sql)
  db.close()
}
const doctor = (repo) => {
  const store = openMemory(repo)
  try {
    return store.doctor()
  } finally {
    store.close()
  }
}
const byCheck = (list, name) => list.find((c) => c.check === name)

describe('store doctor', () => {
  test('a healthy store passes every check', () => {
    const { repo } = seeded()
    const list = doctor(repo)
    assert.deepEqual(list.map((c) => c.check), CHECKS)
    for (const c of list) {
      assert.equal(c.ok, true, `${c.check}: ${c.detail}`)
      assert.equal(typeof c.detail, 'string')
    }
  })

  test('an index missing a row fails the observations FTS check only', () => {
    const { repo, path } = seeded()
    raw(path, "INSERT INTO observations_fts(observations_fts, rowid, title, content, type, topic_key) SELECT 'delete', id, title, content, type, topic_key FROM observations")
    const list = doctor(repo)
    const bad = byCheck(list, 'fts observations')
    assert.equal(bad.ok, false)
    assert.match(bad.detail, /\S/)
    assert.equal(byCheck(list, 'fts prompts').ok, true)
  })

  test('an index with a row that has no content fails the prompts FTS check', () => {
    const { repo, path } = seeded()
    raw(path, "INSERT INTO prompts_fts(rowid, content) VALUES (999, 'ghost prompt text')")
    assert.equal(byCheck(doctor(repo), 'fts prompts').ok, false)
  })

  test('an orphaned version fails', () => {
    const { repo, path } = seeded()
    raw(path, "INSERT INTO observation_versions (observation_id, type, title, content, created_at) VALUES (999, 'manual', 't', 'c', 'now')")
    const c = byCheck(doctor(repo), 'orphaned versions')
    assert.equal(c.ok, false)
    assert.match(c.detail, /1/)
  })

  test('a different schema version and a missing db_id fail', () => {
    const { repo, path } = seeded()
    raw(path, "DELETE FROM meta WHERE key = 'db_id'")
    const store = openMemory(repo) // init puts a db_id back, so break it after opening
    const db = new DatabaseSync(path)
    db.exec("DELETE FROM meta WHERE key = 'db_id'; PRAGMA user_version = 0")
    db.close()
    const list = store.doctor()
    store.close()
    assert.equal(byCheck(list, 'db id').ok, false)
    assert.equal(byCheck(list, 'schema').ok, false)
  })

  test('a read-only directory fails writability', { skip: process.getuid?.() === 0 }, () => {
    const { repo, path } = seeded()
    const dir = dirname(path)
    const store = openMemory(repo) // opening needs a writable directory (WAL files), so lock it afterwards
    chmodSync(dir, 0o555)
    try {
      assert.equal(byCheck(store.doctor(), 'writable').ok, false)
    } finally {
      chmodSync(dir, 0o755)
      store.close()
    }
  })

  test('doctor changes nothing', () => {
    const { repo, path } = seeded()
    raw(path, "INSERT INTO observation_versions (observation_id, type, title, content, created_at) VALUES (999, 'manual', 't', 'c', 'now')")
    const store = openMemory(repo)
    const counts = () => {
      const db = new DatabaseSync(path)
      const rows = db.prepare('SELECT (SELECT count(*) FROM observations) o, (SELECT count(*) FROM observation_versions) v, (SELECT count(*) FROM observations_fts_docsize) f, (SELECT count(*) FROM meta) m').get()
      db.close()
      return { ...rows }
    }
    const before = counts()
    const probe = new DatabaseSync(path)
    let version
    try { version = store.stats && probe.prepare('PRAGMA data_version').get().data_version } finally { probe.close() }
    store.doctor()
    store.doctor()
    assert.deepEqual(counts(), before)
    const reader = new DatabaseSync(path)
    assert.equal(reader.prepare('PRAGMA data_version').get().data_version, version, 'no other connection saw a commit from doctor')
    reader.close()
    store.close()
  })
})

describe('construct-memory doctor', () => {
  test('prints one ok line per check and exits 0 on a healthy store', () => {
    const { repo } = seeded()
    const r = cli(repo, ['doctor'])
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stderr, '')
    assert.deepEqual(r.stdout.trim().split('\n'), CHECKS.map((c) => `ok ${c}`))
  })

  test('prints a fail line with the detail and exits 1 when a check fails', () => {
    const { repo, path } = seeded()
    raw(path, "INSERT INTO observation_versions (observation_id, type, title, content, created_at) VALUES (999, 'manual', 't', 'c', 'now')")
    const r = cli(repo, ['doctor'])
    assert.equal(r.status, 1)
    const lines = r.stdout.trim().split('\n')
    assert.equal(lines.length, CHECKS.length)
    assert.match(lines.find((l) => l.includes('orphaned versions')), /^fail orphaned versions: .+/)
    assert.equal(lines.filter((l) => l.startsWith('ok ')).length, CHECKS.length - 1)
  })

  test('--json prints the list and keeps the exit code', () => {
    const { repo, path } = seeded()
    const good = cli(repo, ['doctor', '--json'])
    assert.equal(good.status, 0, good.stderr)
    const list = JSON.parse(good.stdout)
    assert.deepEqual(list.map((c) => c.check), CHECKS)
    for (const c of list) assert.deepEqual(Object.keys(c).sort(), ['check', 'detail', 'ok'])
    raw(path, "INSERT INTO observation_versions (observation_id, type, title, content, created_at) VALUES (999, 'manual', 't', 'c', 'now')")
    const bad = cli(repo, ['doctor', '--json'])
    assert.equal(bad.status, 1)
    assert.equal(JSON.parse(bad.stdout).filter((c) => !c.ok).length, 1)
  })
})
