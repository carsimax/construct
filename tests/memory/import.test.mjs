// Import from an engram export (S7 of odd/tasks/construct-memory.md): store.importExport and
// the CLI `import` command, on throwaway repositories and a hand-written fixture.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { makeRepo, scratchDir } from '../helpers/repo.mjs'

const BIN = new URL('../../plugins/construct/bin/construct-memory', import.meta.url).pathname
const FIXTURE = new URL('./fixtures/engram-export.json', import.meta.url).pathname
const { openMemory, normalizedHash } = await import(new URL('../../plugins/construct/hooks/scripts/memory-store.mjs', import.meta.url))

const cli = (cwd, args) => spawnSync(BIN, args, { cwd, encoding: 'utf8' })
const data = () => JSON.parse(readFileSync(FIXTURE, 'utf8'))
const rows = (store, sql) => {
  const db = new DatabaseSync(store.path)
  try {
    return db.prepare(sql).all()
  } finally {
    db.close()
  }
}
const withStore = (fn) => {
  const store = openMemory(makeRepo())
  try {
    return fn(store)
  } finally {
    store.close()
  }
}
const COUNTS = { observations: 3, sessions: 2, prompts: 2, skipped: 0, deleted: 1 }

describe('importExport', () => {
  test('imports one project and returns counts', () =>
    withStore((store) => {
      assert.deepEqual(store.importExport(data(), { project: 'alpha' }), COUNTS)
      assert.equal(rows(store, 'SELECT count(*) AS n FROM observations')[0].n, 3)
    }))

  test('project is compared trimmed and lowercased', () =>
    withStore((store) => assert.deepEqual(store.importExport(data(), { project: '  ALPHA ' }), COUNTS)))

  test('a file with several projects needs --project and the error lists them', () =>
    withStore((store) => {
      assert.throws(() => store.importExport(data()), /--project.*alpha.*beta/s)
      assert.throws(() => store.importExport(data(), { project: 'gamma' }), /gamma.*alpha.*beta/s)
      assert.equal(rows(store, 'SELECT count(*) AS n FROM observations')[0].n, 0)
    }))

  test('a file with one project needs no --project', () =>
    withStore((store) => {
      const d = data()
      d.sessions = d.sessions.filter((s) => s.project === 'beta')
      d.observations = d.observations.filter((o) => o.project === 'beta')
      d.prompts = d.prompts.filter((p) => p.project === 'beta')
      assert.deepEqual(store.importExport(d), { observations: 1, sessions: 1, prompts: 1, skipped: 0, deleted: 0 })
    }))

  test('other projects and deleted rows are not imported', () =>
    withStore((store) => {
      store.importExport(data(), { project: 'alpha' })
      const titles = rows(store, 'SELECT title FROM observations ORDER BY id').map((r) => r.title)
      assert.deepEqual(titles, ['Use LRU cache', 'Fixed token leak', 'Session two note'])
      assert.deepEqual(rows(store, 'SELECT id FROM sessions ORDER BY id').map((r) => r.id), ['sess-a1', 'sess-a2'])
    }))

  test('original timestamps, counts, topic_key, and session ids are kept', () =>
    withStore((store) => {
      store.importExport(data(), { project: 'alpha' })
      const [first] = rows(store, 'SELECT * FROM observations ORDER BY id')
      assert.equal(first.created_at, '2026-01-10T09:30:00Z')
      assert.equal(first.updated_at, '2026-01-12T08:00:00Z')
      assert.equal(first.last_seen_at, '2026-01-12T08:00:00Z')
      assert.equal(first.topic_key, 'arch/cache')
      assert.equal(first.session_id, 'sess-a1')
      assert.equal(first.type, 'decision')
      assert.equal(first.revision_count, 2)
      assert.equal(first.duplicate_count, 1)
      assert.equal(first.deleted_at, null)
    }))

  test('review_after counts from the original created_at, and needs_review is derived', () =>
    withStore((store) => {
      store.importExport(data(), { project: 'alpha' })
      const byTitle = Object.fromEntries(rows(store, 'SELECT title, review_after FROM observations').map((r) => [r.title, r.review_after]))
      assert.equal(byTitle['Use LRU cache'], '2026-07-10T09:30:00.000Z') // decision: 6 months
      assert.equal(byTitle['Fixed token leak'], '2027-01-11T09:30:00.000Z') // bugfix: 12 months
      assert.equal(byTitle['Session two note'], null)
    }))

  test('sessions keep summary and start and end times; prompts keep time and session', () =>
    withStore((store) => {
      store.importExport(data(), { project: 'alpha' })
      const [a1, a2] = rows(store, 'SELECT * FROM sessions ORDER BY id')
      assert.deepEqual({ ...a1 }, { id: 'sess-a1', started_at: '2026-01-10T09:00:00Z', ended_at: '2026-01-10T10:00:00Z', summary: 'Goal: wire the cache. Accomplished: cache wired.' })
      assert.equal(a2.ended_at, null)
      assert.equal(a2.summary, null)
      const prompts = rows(store, 'SELECT session_id, content, created_at FROM user_prompts ORDER BY id')
      assert.deepEqual(prompts.map((p) => ({ ...p })), [
        { session_id: 'sess-a1', content: 'please wire the cache', created_at: '2026-01-10T09:01:00Z' },
        { session_id: 'sess-a2', content: 'what did we decide about eviction', created_at: '2026-02-01T09:01:00Z' },
      ])
    }))

  test('<private> is redacted and the hash is the normalized content hash', () =>
    withStore((store) => {
      store.importExport(data(), { project: 'alpha' })
      const row = rows(store, "SELECT content, normalized_hash FROM observations WHERE title = 'Fixed token leak'")[0]
      assert.equal(row.content, 'Public note. [REDACTED] Rotated afterwards.')
      assert.equal(row.normalized_hash, normalizedHash(row.content))
      assert.ok(!JSON.stringify(rows(store, 'SELECT * FROM observations')).includes('sk-secret'))
    }))

  test('content is capped at 50,000 bytes', () =>
    withStore((store) => {
      const d = data()
      d.observations[0].content = 'x'.repeat(60000)
      store.importExport(d, { project: 'alpha' })
      const { content } = rows(store, "SELECT content FROM observations WHERE title = 'Use LRU cache'")[0]
      assert.equal(content, `${'x'.repeat(50000)}... [truncated]`)
    }))

  test('imported rows bypass dedup and topic_key upsert', () =>
    withStore((store) => {
      const d = data()
      d.observations.push({ ...d.observations[0], id: 9, sync_id: 'obs-a-9' }, { ...d.observations[0], id: 10, sync_id: 'obs-a-10' })
      assert.equal(store.importExport(d, { project: 'alpha' }).observations, 5)
      assert.equal(rows(store, "SELECT count(*) AS n FROM observations WHERE topic_key = 'arch/cache'")[0].n, 3)
      assert.equal(rows(store, 'SELECT count(*) AS n FROM observation_versions')[0].n, 0)
    }))

  test('a re-run inserts nothing and counts skipped', () =>
    withStore((store) => {
      store.importExport(data(), { project: 'alpha' })
      assert.deepEqual(store.importExport(data(), { project: 'alpha' }), { observations: 0, sessions: 0, prompts: 0, skipped: 7, deleted: 1 })
      assert.equal(rows(store, 'SELECT count(*) AS n FROM observations')[0].n, 3)
      assert.equal(rows(store, 'SELECT count(*) AS n FROM user_prompts')[0].n, 2)
    }))

  test('without sync_id the observation id identifies the row', () =>
    withStore((store) => {
      const d = data()
      for (const o of d.observations) delete o.sync_id
      for (const p of d.prompts) delete p.sync_id
      assert.equal(store.importExport(d, { project: 'alpha' }).observations, 3)
      assert.deepEqual(store.importExport(d, { project: 'alpha' }), { observations: 0, sessions: 0, prompts: 0, skipped: 7, deleted: 1 })
    }))

  test('a second project can be imported after the first', () =>
    withStore((store) => {
      store.importExport(data(), { project: 'alpha' })
      assert.deepEqual(store.importExport(data(), { project: 'beta' }), { observations: 1, sessions: 1, prompts: 1, skipped: 0, deleted: 0 })
    }))

  test('imported rows are found by search and context', () =>
    withStore((store) => {
      store.importExport(data(), { project: 'alpha' })
      assert.match(store.search('cache')[0].title, /LRU/)
      assert.equal(store.search('obsolete').length, 0)
      const ctx = store.context()
      assert.match(ctx, /Use LRU cache/)
      assert.match(ctx, /sess-a1/)
      assert.match(ctx, /please wire the cache/)
      assert.doesNotMatch(ctx, /Postgres/)
    }))

  test('unknown versions are refused with one line and nothing is written', () =>
    withStore((store) => {
      for (const version of ['0.3.0', '1.0.0', undefined]) {
        const d = data()
        d.version = version
        assert.throws(() => store.importExport(d, { project: 'alpha' }), /unsupported export version/)
      }
      assert.equal(rows(store, 'SELECT count(*) AS n FROM observations')[0].n, 0)
    }))

  test('version 0.1.0 is accepted', () =>
    withStore((store) => {
      const d = data()
      d.version = '0.1.0'
      assert.equal(store.importExport(d, { project: 'alpha' }).observations, 3)
    }))

  test('a bad row rolls the whole import back', () =>
    withStore((store) => {
      const d = data()
      d.observations[3].content = ''
      assert.throws(() => store.importExport(d, { project: 'alpha' }), /content is required/)
      for (const t of ['observations', 'sessions', 'user_prompts']) assert.equal(rows(store, `SELECT count(*) AS n FROM ${t}`)[0].n, 0)
    }))
})

describe('construct-memory import', () => {
  const failsOneLine = (r, pattern) => {
    assert.notEqual(r.status, 0)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, pattern)
    assert.equal(r.stderr.trim().split('\n').length, 1, `one line on stderr: ${r.stderr}`)
  }

  test('prints one count line, then reports the re-run as skipped', () => {
    const repo = makeRepo()
    const first = cli(repo, ['import', FIXTURE, '--project', 'alpha'])
    assert.equal(first.status, 0, first.stderr)
    assert.equal(first.stderr, '')
    assert.equal(first.stdout, 'imported 3 observations, 2 sessions, 2 prompts; skipped 0 already imported, 1 deleted\n')
    assert.equal(cli(repo, ['import', FIXTURE, '--project', 'alpha']).stdout, 'imported 0 observations, 0 sessions, 0 prompts; skipped 7 already imported, 1 deleted\n')
    assert.match(cli(repo, ['search', 'cache']).stdout, /Use LRU cache/)
  })

  test('several projects without --project is one error line listing them', () => {
    const r = cli(makeRepo(), ['import', FIXTURE])
    failsOneLine(r, /--project.*alpha.*beta/)
  })

  test('missing file argument, missing file, and malformed JSON are one-line errors', () => {
    const repo = makeRepo()
    const dir = scratchDir('import-bad-')
    const bad = join(dir, 'bad.json')
    writeFileSync(bad, '{ not json')
    const array = join(dir, 'array.json')
    writeFileSync(array, '[]')
    failsOneLine(cli(repo, ['import']), /import needs a file/)
    failsOneLine(cli(repo, ['import', join(dir, 'missing.json')]), /cannot read/)
    failsOneLine(cli(repo, ['import', bad]), /not valid JSON/)
    failsOneLine(cli(repo, ['import', array]), /not an engram export/)
    assert.equal(cli(repo, ['search', 'cache']).stdout, 'no memories found\n')
  })

  test('an unknown version is refused', () => {
    const dir = scratchDir('import-ver-')
    const file = join(dir, 'v.json')
    writeFileSync(file, JSON.stringify({ ...data(), version: '9.9.9' }))
    failsOneLine(cli(makeRepo(), ['import', file, '--project', 'alpha']), /unsupported export version/)
  })

  test('the usage lists import', () => {
    assert.match(cli(makeRepo(), ['help']).stdout, /import <file>/)
  })
})

describe('deleted imported prompts (S12)', () => {
  test('a deleted imported prompt is tombstoned and not re-imported; a typed prompt leaves no tombstone', () =>
    withStore((store) => {
      store.importExport(data(), { project: 'alpha' })
      store.addPrompt('typed', 'typed by hand')
      const [typed, imported] = store.prompts()
      assert.equal(store.deletePrompt(typed.id), true)
      assert.equal(rows(store, 'SELECT count(*) AS n FROM import_tombstones')[0].n, 0)
      assert.equal(store.deletePrompt(imported.id), true)
      const tomb = rows(store, 'SELECT import_id, deleted_at FROM import_tombstones')
      assert.equal(tomb.length, 1)
      assert.match(tomb[0].import_id, /^(prompt:alpha:|[^:]+)/)
      assert.match(tomb[0].deleted_at, /^\d{4}-\d\d-\d\dT/)
      assert.deepEqual(store.importExport(data(), { project: 'alpha' }), { observations: 0, sessions: 0, prompts: 0, skipped: 7, deleted: 1 })
      assert.equal(rows(store, 'SELECT count(*) AS n FROM user_prompts WHERE import_id IS NOT NULL')[0].n, 1)
    }))

  test('a tombstoned prompt is skipped on a first import into a store that already has the tombstone', () =>
    withStore((store) => {
      store.importExport(data(), { project: 'alpha' })
      for (const p of store.prompts()) store.deletePrompt(p.id)
      assert.equal(store.prompts().length, 0)
      const n = store.importExport(data(), { project: 'alpha' })
      assert.equal(n.prompts, 0)
      assert.equal(store.prompts().length, 0)
    }))
})

describe('hard-deleted imported observations (S13)', () => {
  test('an imported observation erased with hard is tombstoned and not re-imported; a typed one leaves no tombstone', () =>
    withStore((store) => {
      store.importExport(data(), { project: 'alpha' })
      const typed = store.save({ title: 'Typed', content: 'typed by hand', type: 'discovery' }).id
      assert.equal(store.remove(typed, { hard: true }), true)
      assert.equal(rows(store, 'SELECT count(*) AS n FROM import_tombstones')[0].n, 0)
      const imported = rows(store, 'SELECT id, import_id FROM observations WHERE import_id IS NOT NULL')[0]
      assert.equal(store.remove(imported.id, { hard: true }), true)
      assert.deepEqual(rows(store, 'SELECT import_id FROM import_tombstones').map((r) => r.import_id), [imported.import_id])
      assert.deepEqual(store.importExport(data(), { project: 'alpha' }), { observations: 0, sessions: 0, prompts: 0, skipped: 7, deleted: 1 })
      assert.equal(rows(store, 'SELECT count(*) AS n FROM observations WHERE import_id IS NOT NULL')[0].n, 2)
    }))

  test('a soft delete of an imported observation leaves no tombstone', () =>
    withStore((store) => {
      store.importExport(data(), { project: 'alpha' })
      const { id } = rows(store, 'SELECT id FROM observations WHERE import_id IS NOT NULL')[0]
      assert.equal(store.remove(id), true)
      assert.equal(rows(store, 'SELECT count(*) AS n FROM import_tombstones')[0].n, 0)
    }))
})
