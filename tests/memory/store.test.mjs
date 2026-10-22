// The per-repository memory store (S1-S4 of odd/tasks/construct-memory.md), driven through its
// public API on throwaway git repositories, with a controllable clock.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { git, makeRepo, scratchDir } from '../helpers/repo.mjs'

const MODULE = new URL('../../plugins/construct/hooks/scripts/memory-store.mjs', import.meta.url)
const { openMemory, normalizedHash } = await import(MODULE)

const MIN = 60 * 1000
const DAY = 24 * 60 * MIN

// open returns a store on a fresh repository whose clock the test moves with clock.t.
function open(repo = makeRepo()) {
  const clock = { t: Date.parse('2026-01-15T12:00:00Z') }
  const store = openMemory(repo, { now: () => new Date(clock.t) })
  return { repo, clock, store }
}
const obs = (title, extra = {}) => ({ title, content: `${title} body`, type: 'discovery', ...extra })
const raw = (store, sql, ...args) => new DatabaseSync(store.path).prepare(sql).all(...args)

describe('store location (S1)', () => {
  test('lives under the git common dir and is shared by a worktree', () => {
    const { repo, store } = open()
    const common = realpathSync(join(repo, '.git'))
    assert.equal(realpathSync(store.path), join(common, 'construct-memory', 'memory.db'))
    const tree = join(scratchDir('mem-wt-'), 'wt')
    git(repo, 'worktree', 'add', '-q', tree, '-b', 'other')
    const other = openMemory(tree)
    assert.equal(realpathSync(other.path), realpathSync(store.path))
    const { id } = store.save(obs('shared fact'))
    assert.equal(other.get(id).title, 'shared fact')
    other.close()
    store.close()
  })

  test('is null outside a git repository', () => {
    assert.equal(openMemory(scratchDir('mem-nogit-')), null)
  })

  test('refuses a newer schema version and leaves the file untouched', () => {
    const { repo, store } = open()
    store.close()
    const path = store.path
    const db = new DatabaseSync(path)
    db.exec('PRAGMA user_version = 99')
    db.close()
    assert.throws(() => openMemory(repo), /newer/i)
    const after = new DatabaseSync(path)
    assert.equal(after.prepare('PRAGMA user_version').get().user_version, 99)
    after.close()
  })

  test('sets WAL, a busy timeout, and the schema version', () => {
    const { store } = open()
    const db = new DatabaseSync(store.path)
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal')
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1)
    db.close()
    store.close()
  })

  test('prints nothing on stderr (node:sqlite ExperimentalWarning included)', async () => {
    const repo = makeRepo()
    const code = `const { openMemory } = await import(${JSON.stringify(MODULE.href)}); const s = openMemory(${JSON.stringify(repo)}); s.save({ title: 'x', content: 'y' }); s.close()`
    const result = await child(['--input-type=module', '-e', code])
    assert.equal(result.status, 0)
    assert.equal(result.stderr, '')
  })
})

describe('schema (S2)', () => {
  test('has the tables, columns, and trigram FTS tables', () => {
    const { store } = open()
    const names = raw(store, "SELECT name FROM sqlite_master WHERE type IN ('table')").map((r) => r.name)
    for (const n of ['observations', 'observation_versions', 'sessions', 'user_prompts', 'observations_fts', 'prompts_fts', 'import_tombstones', 'meta']) {
      assert.ok(names.includes(n), n)
    }
    const columns = raw(store, 'PRAGMA table_info(observations)').map((r) => r.name)
    assert.deepEqual(columns, [
      'id', 'session_id', 'type', 'title', 'content', 'topic_key', 'normalized_hash', 'revision_count',
      'duplicate_count', 'last_seen_at', 'review_after', 'created_at', 'updated_at', 'deleted_at', 'import_id', 'pinned',
    ])
    assert.deepEqual(raw(store, 'PRAGMA table_info(import_tombstones)').map((r) => r.name), ['import_id', 'deleted_at'])
    assert.deepEqual(raw(store, 'SELECT key FROM meta').map((r) => r.key), ['db_id'])
    assert.match(raw(store, "SELECT sql FROM sqlite_master WHERE name = 'observations_fts'")[0].sql, /trigram/)
    assert.match(raw(store, "SELECT sql FROM sqlite_master WHERE name = 'prompts_fts'")[0].sql, /trigram/)
    store.close()
  })

  test('soft delete removes the row from the observation index; update reindexes', () => {
    const { store } = open()
    const { id } = store.save({ title: 'searchable alpha', content: 'zzz' })
    const hits = () => raw(store, "SELECT rowid FROM observations_fts WHERE observations_fts MATCH '\"alpha\"'").length
    assert.equal(hits(), 1)
    store.update(id, { title: 'renamed beta', content: 'zzz' })
    assert.equal(hits(), 0)
    assert.equal(raw(store, "SELECT rowid FROM observations_fts WHERE observations_fts MATCH '\"beta\"'").length, 1)
    store.remove(id)
    assert.equal(raw(store, "SELECT rowid FROM observations_fts WHERE observations_fts MATCH '\"beta\"'").length, 0)
    assert.equal(raw(store, 'SELECT deleted_at FROM observations WHERE id = ?', id)[0].deleted_at !== null, true)
    store.close()
  })

  test('prompts are indexed', () => {
    const { store } = open()
    store.addPrompt('s1', 'please refactor the parser')
    assert.equal(raw(store, "SELECT rowid FROM prompts_fts WHERE prompts_fts MATCH '\"parser\"'").length, 1)
    store.close()
  })
  test('prompts lists newest first with a limit (default 20, max 100)', () => {
    const { store } = open()
    for (let i = 1; i <= 25; i++) store.addPrompt('s1', `prompt ${i}`)
    const rows = store.prompts()
    assert.equal(rows.length, 20)
    assert.deepEqual(Object.keys(rows[0]), ['id', 'session_id', 'created_at', 'content'])
    assert.equal(rows[0].content, 'prompt 25')
    assert.equal(rows[19].content, 'prompt 6')
    assert.deepEqual(store.prompts({ limit: 2 }).map((r) => r.content), ['prompt 25', 'prompt 24'])
    for (let i = 26; i <= 120; i++) store.addPrompt('s1', `prompt ${i}`)
    assert.equal(store.prompts({ limit: 500 }).length, 100)
    store.close()
  })

  test('deletePrompt removes the row, the FTS match, and the context line', () => {
    const { store } = open()
    store.addPrompt('s1', 'my password is hunter2parser')
    store.addPrompt('s1', 'keep this one')
    const [, secret] = store.prompts()
    assert.match(secret.content, /hunter2/)
    assert.match(store.context(), /hunter2/)
    assert.equal(store.deletePrompt(secret.id), true)
    assert.deepEqual(store.prompts().map((r) => r.content), ['keep this one'])
    assert.equal(raw(store, "SELECT rowid FROM prompts_fts WHERE prompts_fts MATCH '\"hunter2\"'").length, 0)
    assert.doesNotMatch(store.context(), /hunter2/)
    assert.equal(store.deletePrompt(secret.id), false)
    assert.equal(store.deletePrompt(99999), false)
    store.close()
  })
})

describe('hard delete (S13)', () => {
  const fts = (store, word) => raw(store, `SELECT rowid FROM observations_fts WHERE observations_fts MATCH '"${word}"'`).length

  test('remove with hard erases the row, every version, and the FTS match', () => {
    const { store } = open()
    const { id } = store.save(obs('Token note', { content: 'the token is zebrafinch99' }))
    store.update(id, { content: 'the token was rotated, see vault' })
    assert.equal(raw(store, 'SELECT * FROM observation_versions WHERE observation_id = ?', id).length, 1)
    assert.equal(store.remove(id, { hard: true }), true)
    assert.equal(raw(store, 'SELECT * FROM observations WHERE id = ?', id).length, 0)
    assert.equal(raw(store, 'SELECT * FROM observation_versions WHERE observation_id = ?', id).length, 0)
    assert.equal(fts(store, 'zebrafinch99'), 0)
    assert.equal(fts(store, 'rotated'), 0)
    assert.equal(store.get(id, { history: true }), null)
    assert.deepEqual(store.search('zebrafinch99'), [])
    assert.equal(store.remove(id, { hard: true }), false)
    assert.equal(store.remove(99999, { hard: true }), false)
    store.close()
  })

  test('hard delete works on an already soft-deleted observation and leaves the index sound', () => {
    const { store } = open()
    const { id } = store.save(obs('Old secret', { content: 'swordfish77 lives here' }))
    const keep = store.save(obs('Keeper', { content: 'keeper text stays' })).id
    assert.equal(store.remove(id), true)
    assert.equal(raw(store, 'SELECT count(*) AS n FROM observations WHERE id = ?', id)[0].n, 1)
    assert.equal(store.remove(id, { hard: true }), true)
    assert.equal(raw(store, 'SELECT count(*) AS n FROM observations WHERE id = ?', id)[0].n, 0)
    assert.equal(fts(store, 'swordfish77'), 0)
    assert.equal(store.search('keeper')[0].id, keep)
    store.close()
  })

  test('plain remove stays a soft delete that keeps the row and its versions', () => {
    const { store } = open()
    const { id } = store.save(obs('Soft', { content: 'softly removed' }))
    store.update(id, { content: 'softly removed again' })
    assert.equal(store.remove(id), true)
    assert.equal(store.remove(id), false)
    assert.equal(raw(store, 'SELECT deleted_at FROM observations WHERE id = ?', id).length, 1)
    assert.equal(raw(store, 'SELECT * FROM observation_versions WHERE observation_id = ?', id).length, 1)
    assert.equal(store.get(id), null)
    store.close()
  })
})

describe('write rules (S3)', () => {
  test('an unclosed <private> redacts to the end of the text', () => {
    const { store } = open()
    const { id } = store.save({ title: 'key <Private>abc', content: 'ok <private>a</private> mid <PRIVATE>secret\nmore' })
    const row = store.get(id)
    assert.equal(row.title, 'key [REDACTED]')
    assert.equal(row.content, 'ok [REDACTED] mid [REDACTED]')
    store.endSession('s', 'done <private>tail')
    assert.ok(!JSON.stringify(raw(store, 'SELECT summary FROM sessions')).includes('tail'))
    store.close()
  })

  test('redacts <private> spans in title and content', () => {
    const { store } = open()
    const { id } = store.save({ title: 'key <private>abc</private> here', content: 'a <PRIVATE>x\ny</private> b <private>z</private>' })
    const row = store.get(id)
    assert.equal(row.title, 'key [REDACTED] here')
    assert.equal(row.content, 'a [REDACTED] b [REDACTED]')
    store.close()
  })

  test('caps content at 50,000 bytes on a UTF-8 boundary', () => {
    const { store } = open()
    const content = `${'a'.repeat(49999)}${'é'.repeat(10)}`
    const row = store.get(store.save({ title: 't', content }).id)
    assert.ok(row.content.endsWith('... [truncated]'))
    const body = row.content.slice(0, -'... [truncated]'.length)
    assert.equal(body, 'a'.repeat(49999))
    assert.equal(Buffer.from(row.content).toString('utf8'), row.content)
    const exact = store.get(store.save({ title: 't2', content: 'b'.repeat(50000) }).id)
    assert.equal(exact.content.length, 50000)
    store.close()
  })

  test('topic_key upserts the live row and saves the previous state as a version', () => {
    const { store, clock } = open()
    const first = store.save(obs('v1 title', { topic_key: 'Architecture/Auth Model', content: 'one' }))
    assert.equal(first.action, 'inserted')
    clock.t += DAY
    const second = store.save(obs('v2 title', { topic_key: 'architecture/auth-model', content: 'two' }))
    assert.deepEqual(second, { id: first.id, action: 'upserted' })
    const row = store.get(first.id, { history: true })
    assert.equal(row.title, 'v2 title')
    assert.equal(row.content, 'two')
    assert.equal(row.topic_key, 'architecture/auth-model')
    assert.equal(row.revision_count, 1)
    assert.equal(row.versions.length, 1)
    assert.equal(row.versions[0].title, 'v1 title')
    assert.equal(row.versions[0].content, 'one')
    assert.equal(raw(store, 'SELECT count(*) AS n FROM observations')[0].n, 1)
    store.close()
  })

  test('topic_key is cut to 120 bytes on a character boundary', () => {
    const { store } = open()
    const row = store.get(store.save(obs('t', { topic_key: `k/${'é'.repeat(100)}` })).id)
    assert.ok(Buffer.byteLength(row.topic_key) <= 120)
    assert.ok(!row.topic_key.includes('�'))
    assert.ok(Buffer.byteLength(row.topic_key) >= 118)
    store.close()
  })

  test('a deleted row is not upserted: the key gets a new row', () => {
    const { store } = open()
    const a = store.save(obs('a', { topic_key: 'k/one' }))
    store.remove(a.id)
    const b = store.save(obs('b', { topic_key: 'k/one' }))
    assert.equal(b.action, 'inserted')
    assert.notEqual(b.id, a.id)
    store.close()
  })

  test('the same hash, type, and title within 15 minutes increments duplicate_count', () => {
    const { store, clock } = open()
    const a = store.save({ title: 'Same', content: 'Some   Content', type: 'discovery' })
    clock.t += 14 * MIN
    const b = store.save({ title: 'Same', content: 'some content', type: 'discovery' })
    assert.deepEqual(b, { id: a.id, action: 'deduplicated' })
    assert.equal(store.get(a.id).duplicate_count, 1)
    assert.equal(normalizedHash('Some   Content'), normalizedHash('some content'))
    clock.t += 16 * MIN
    const c = store.save({ title: 'Same', content: 'some content', type: 'discovery' })
    assert.equal(c.action, 'inserted')
    const d = store.save({ title: 'Same', content: 'some content', type: 'decision' })
    assert.equal(d.action, 'inserted')
    store.close()
  })

  test('review_after follows the type in months; other types have none; needs_review is derived', () => {
    const { store, clock } = open()
    const months = { decision: 6, policy: 12, preference: 3, config: 3, discovery: 6, pattern: 6, architecture: 12, bugfix: 12 }
    for (const [type, n] of Object.entries(months)) {
      const row = store.get(store.save({ title: type, content: type, type }).id)
      const expected = new Date(clock.t)
      expected.setUTCMonth(expected.getUTCMonth() + n)
      assert.equal(row.review_after, expected.toISOString(), type)
      assert.equal(row.needs_review, false)
    }
    const other = store.get(store.save({ title: 'x', content: 'x', type: 'manual' }).id)
    assert.equal(other.review_after, null)
    assert.equal(other.needs_review, false)
    const pref = store.save({ title: 'p', content: 'p', type: 'preference' })
    assert.deepEqual(store.needingReview(), [])
    clock.t += 100 * DAY
    assert.ok(store.needingReview().every((r) => r.needs_review === true))
    assert.deepEqual(store.needingReview().map((r) => r.title).sort(), ['config', 'p', 'preference'])
    assert.equal(store.get(pref.id).needs_review, true)
    assert.equal(store.markReviewed(pref.id), true)
    assert.equal(store.get(pref.id).needs_review, false)
    assert.deepEqual(store.needingReview().map((r) => r.title).sort(), ['config', 'preference'])
    store.close()
  })

  test('update changes content or find/replace (not both), versioned first', () => {
    const { store } = open()
    const { id } = store.save(obs('doc', { content: 'foo bar foo' }))
    assert.throws(() => store.update(id, { content: 'x', find: 'foo', replace: 'baz' }), /find/i)
    assert.throws(() => store.update(id, { find: 'foo' }), /replace/i)
    store.update(id, { find: 'foo', replace: 'baz' })
    let row = store.get(id, { history: true })
    assert.equal(row.content, 'baz bar baz')
    assert.equal(row.revision_count, 1)
    assert.equal(row.versions[0].content, 'foo bar foo')
    store.update(id, { content: 'fresh <private>s</private>', type: 'decision' })
    row = store.get(id, { history: true })
    assert.equal(row.content, 'fresh [REDACTED]')
    assert.equal(row.type, 'decision')
    assert.equal(row.versions.length, 2)
    assert.equal(store.update(9999, { title: 'x' }), null)
    store.close()
  })

  test('remove is soft: the row hides from get and search, and a second remove is false', () => {
    const { store } = open()
    const { id } = store.save(obs('gone entry'))
    assert.equal(store.remove(id), true)
    assert.equal(store.get(id), null)
    assert.deepEqual(store.search('gone entry'), [])
    assert.equal(raw(store, 'SELECT count(*) AS n FROM observations')[0].n, 1)
    assert.equal(store.remove(id), false)
    store.close()
  })
})

describe('search (S4)', () => {
  test('default 10 results, max 20, previews truncated', () => {
    const { store } = open()
    for (let i = 0; i < 25; i++) store.save({ title: `widget ${i}`, content: `widget ${'x'.repeat(400)} ${i}` })
    assert.equal(store.search('widget').length, 10)
    assert.equal(store.search('widget', { limit: 50 }).length, 20)
    assert.equal(store.search('widget', { limit: 3 }).length, 3)
    const hit = store.search('widget')[0]
    assert.equal(hit.preview.length, 300)
    assert.equal(hit.truncated, true)
    assert.equal(hit.content, undefined)
    store.close()
  })

  test('a query with / matches topic_key exactly and ranks first', () => {
    const { store } = open()
    store.save({ title: 'auth model notes', content: 'mentions architecture/auth-model many times architecture/auth-model', topic_key: 'misc/other' })
    const exact = store.save({ title: 'unrelated', content: 'nothing', topic_key: 'architecture/auth-model' })
    const hits = store.search('architecture/auth-model')
    assert.equal(hits[0].id, exact.id)
    assert.equal(hits.length, 2)
    store.close()
  })

  test('a term shorter than 3 characters falls back to an escaped LIKE scan', () => {
    const { store } = open()
    store.save({ title: 'go tooling', content: 'uses 100% of the cpu_core' })
    store.save({ title: 'other', content: 'plain text' })
    assert.deepEqual(store.search('go').map((r) => r.title), ['go tooling'])
    assert.deepEqual(store.search('100%').map((r) => r.title), ['go tooling'])
    assert.deepEqual(store.search('c_u').map((r) => r.title), [])
    assert.deepEqual(store.search('cpu_core').map((r) => r.title), ['go tooling'])
    store.close()
  })

  test('quotes in terms cannot break the query', () => {
    const { store } = open()
    store.save({ title: 'say "hello" there', content: 'quoted text' })
    assert.equal(store.search('"hello"').length, 1)
    assert.equal(store.search('say"hello').length, 0)
    assert.doesNotThrow(() => store.search('a"b" "unclosed AND OR NEAR(x)'))
    assert.doesNotThrow(() => store.search('hello* ^col:x -y'))
    store.close()
  })

  test('terms are ANDed by default and ORed with any', () => {
    const { store } = open()
    store.save({ title: 'first', content: 'alpha only' })
    store.save({ title: 'second', content: 'beta only' })
    store.save({ title: 'third', content: 'alpha and beta' })
    assert.deepEqual(store.search('alpha beta').map((r) => r.title), ['third'])
    assert.deepEqual(store.search('alpha beta', { any: true }).map((r) => r.title).sort(), ['first', 'second', 'third'])
    assert.deepEqual(store.search('go alpha').map((r) => r.title), [])
    store.close()
  })

  test('filters by type, ranks title above content, and matches substrings (trigram)', () => {
    const { store } = open()
    store.save({ title: 'planner', content: 'scheduling', type: 'decision' })
    store.save({ title: 'other', content: 'planner mentioned once', type: 'bugfix' })
    assert.deepEqual(store.search('planner', { type: 'bugfix' }).map((r) => r.title), ['other'])
    assert.deepEqual(store.search('planner').map((r) => r.title), ['planner', 'other'])
    assert.equal(store.search('anne').length, 2)
    assert.deepEqual(store.search('   '), [])
    store.close()
  })
})

describe('context (S4)', () => {
  test('is empty with no data', () => {
    const { store } = open()
    assert.equal(store.context(), '')
    store.close()
  })

  test('lists sessions, prompts, and observations with their limits', () => {
    const { store, clock } = open()
    for (let i = 0; i < 7; i++) {
      store.startSession(`sess-${i}`)
      clock.t += MIN
    }
    store.endSession('sess-6', `${'s'.repeat(250)}`)
    store.endSession('sess-5', 'short summary')
    for (let i = 0; i < 12; i++) {
      store.addPrompt('sess-6', `prompt number ${i} ${'p'.repeat(300)}`)
      clock.t += MIN
    }
    for (let i = 0; i < 25; i++) {
      store.save({ title: `title ${i}`, content: `c${i}`, type: 'decision' })
      clock.t += MIN
    }
    const text = store.context()
    assert.ok(text.startsWith('## Memory from Previous Sessions\n'))
    assert.ok(text.includes('### Recent Sessions'))
    assert.equal(text.match(/^- \*\*sess-/gm).length, 5)
    assert.ok(text.includes('sess-6'))
    assert.ok(!text.includes('sess-0'))
    assert.ok(text.includes(`${'s'.repeat(200)}`) && !text.includes('s'.repeat(201)))
    assert.ok(text.includes('short summary'))
    const prompts = text.split('### Recent User Prompts')[1].split('###')[0]
    assert.equal(prompts.match(/^- /gm).length, 10)
    assert.ok(prompts.includes('prompt number 11') && !prompts.includes('prompt number 1 '))
    const observations = text.split('### Recent Observations')[1]
    assert.equal(observations.match(/^- \[decision\] \*\*title \d+\*\*$/gm).length, 20)
    assert.ok(observations.indexOf('title 24') < observations.indexOf('title 23'))
    assert.ok(!observations.includes('**title 4**'))
    store.close()
  })

  test('hides deleted observations', () => {
    const { store } = open()
    const { id } = store.save(obs('visible one'))
    store.save(obs('hidden one'))
    store.remove(store.search('hidden')[0].id)
    const text = store.context()
    assert.ok(text.includes('visible one') && !text.includes('hidden one'))
    assert.ok(id)
    store.close()
  })

  test('is capped at 16,384 bytes on a UTF-8 boundary with a marker', () => {
    const { store } = open()
    for (let i = 0; i < 20; i++) store.save({ title: `${'é'.repeat(1500)} ${i}`, content: `c${i}` })
    const text = store.context()
    assert.ok(Buffer.byteLength(text) <= 16384)
    assert.ok(text.endsWith('\n[truncated]\n'))
    assert.ok(!text.includes('�'))
    store.close()
  })
})

describe('sessions and prompts', () => {
  test('lastSaveAt tracks the newest save and is null when empty', () => {
    const { store, clock } = open()
    assert.equal(store.lastSaveAt(), null)
    store.save(obs('a'))
    clock.t += 5 * MIN
    store.save(obs('b'))
    assert.equal(store.lastSaveAt(), new Date(clock.t).toISOString())
    store.close()
  })

  test('endSession creates a missing session and stores the summary', () => {
    const { store } = open()
    store.endSession('late', 'done')
    const [row] = raw(store, "SELECT summary, ended_at FROM sessions WHERE id = 'late'")
    assert.equal(row.summary, 'done')
    assert.ok(row.ended_at)
    store.startSession('late')
    assert.equal(raw(store, "SELECT count(*) AS n FROM sessions WHERE id = 'late'")[0].n, 1)
    store.close()
  })
})

describe('concurrent writers (S1)', () => {
  test('several processes write at once without errors or lost rows', async () => {
    const repo = makeRepo()
    const WRITERS = 6
    const EACH = 25
    const code = `const { openMemory } = await import(${JSON.stringify(MODULE.href)})
      const w = process.argv[1]
      const s = openMemory(${JSON.stringify(repo)})
      for (let i = 0; i < ${EACH}; i++) {
        s.save({ title: 'w' + w + ' n' + i, content: 'body ' + w + ' ' + i })
        s.addPrompt('s' + w, 'prompt ' + i)
      }
      s.save({ title: 'shared', content: 'shared', topic_key: 'k/shared' })
      s.close()`
    const results = await Promise.all(
      Array.from({ length: WRITERS }, (_, w) => child(['--input-type=module', '-e', code, String(w)])),
    )
    for (const r of results) {
      assert.equal(r.stderr, '')
      assert.equal(r.status, 0)
    }
    const store = openMemory(repo)
    assert.equal(raw(store, 'SELECT count(*) AS n FROM observations')[0].n, WRITERS * EACH + 1)
    assert.equal(raw(store, 'SELECT count(*) AS n FROM user_prompts')[0].n, WRITERS * EACH)
    assert.equal(raw(store, "SELECT revision_count AS n FROM observations WHERE topic_key = 'k/shared'")[0].n + 1, WRITERS)
    assert.equal(raw(store, "SELECT count(*) AS n FROM observations_fts WHERE observations_fts MATCH '\"body\"'")[0].n, WRITERS * EACH)
    store.close()
  })
})

function child(args) {
  return new Promise((resolve) => {
    const p = spawn('node', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    p.stdout.on('data', (d) => (stdout += d))
    p.stderr.on('data', (d) => (stderr += d))
    p.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

describe('hasHash', () => {
  test('is true for a live observation with that normalized hash, false for unknown or soft-deleted', () => {
    const { store } = open()
    const { id } = store.save({ title: 'Hash me', content: 'Some   Content here', type: 'discovery' })
    assert.equal(store.hasHash(normalizedHash('some content HERE')), true)
    assert.equal(store.hasHash(normalizedHash('other')), false)
    store.remove(id)
    assert.equal(store.hasHash(normalizedHash('some content here')), false)
    store.close()
  })

  test('endSession redacts <private> text in the summary and in context', () => {
    const { store } = open()
    store.endSession('priv', 'kept <private>secret</private> done')
    const [row] = raw(store, "SELECT summary FROM sessions WHERE id = 'priv'")
    assert.equal(row.summary, 'kept [REDACTED] done')
    assert.match(store.context(), /\[REDACTED\]/)
    assert.doesNotMatch(store.context(), /secret/)
    store.close()
  })
})
