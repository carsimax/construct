// Export (S14 of odd/tasks/construct-memory.md): store.exportData and the CLI `export`,
// round-tripped through `import` between throwaway repositories.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { makeRepo, scratchDir } from '../helpers/repo.mjs'

const BIN = new URL('../../plugins/construct/bin/construct-memory', import.meta.url).pathname
const FIXTURE = new URL('./fixtures/engram-export.json', import.meta.url).pathname
const { openMemory } = await import(new URL('../../plugins/construct/hooks/scripts/memory-store.mjs', import.meta.url))

const cli = (cwd, args) => spawnSync(BIN, args, { cwd, encoding: 'utf8' })
const engram = () => JSON.parse(readFileSync(FIXTURE, 'utf8'))
const raw = (store, sql) => {
  const db = new DatabaseSync(store.path)
  try {
    return db.prepare(sql).all()
  } finally {
    db.close()
  }
}
const OBS = 'SELECT session_id, type, title, content, topic_key, revision_count, duplicate_count, last_seen_at, created_at, updated_at FROM observations WHERE deleted_at IS NULL ORDER BY title'
const PROMPTS = 'SELECT session_id, content, created_at FROM user_prompts ORDER BY content'
const SESSIONS = 'SELECT * FROM sessions ORDER BY id'

// source: a repo holding engram-imported rows, typed rows, a summary, prompts, and deleted rows.
function source() {
  const repo = makeRepo()
  const store = openMemory(repo)
  store.importExport(engram(), { project: 'alpha' })
  store.startSession('own-1')
  const a = store.save({ title: 'Typed one', content: 'first typed note', type: 'decision', topic_key: 'Arch/Typed', session_id: 'own-1' }).id
  store.save({ title: 'Typed one', content: 'first typed note, revised', type: 'decision', topic_key: 'Arch/Typed', session_id: 'own-1' })
  const soft = store.save({ title: 'Soft gone', content: 'soft deleted note', type: 'discovery' }).id
  const hard = store.save({ title: 'Hard gone', content: 'hard deleted note', type: 'discovery' }).id
  store.remove(soft)
  store.remove(hard, { hard: true })
  store.addPrompt('own-1', 'a typed prompt')
  store.endSession('own-1', 'Goal: export. Accomplished: yes.')
  return { repo, store, a }
}

describe('exportData', () => {
  test('writes the engram 0.2.0 shape with one project named after the repository directory', () => {
    const { repo, store } = source()
    const out = store.exportData()
    assert.equal(out.version, '0.2.0')
    assert.match(out.exported_at, /^\d{4}-\d\d-\d\dT/)
    for (const list of [out.sessions, out.observations, out.prompts]) assert.ok(list.length > 0)
    const names = new Set([...out.sessions, ...out.observations, ...out.prompts].map((r) => r.project))
    assert.deepEqual([...names], [basename(repo)])
    assert.equal(out.observations.length, 4) // three imported alpha rows + one typed
    assert.ok(out.observations.every((o) => o.sync_id && !o.deleted_at))
    assert.ok(out.prompts.every((p) => p.sync_id))
    assert.ok(!out.observations.some((o) => /gone/.test(o.title)))
    const typed = out.observations.find((o) => o.title === 'Typed one')
    assert.equal(typed.sync_id, `cm-obs-${typed.id}`)
    assert.equal(typed.topic_key, 'arch/typed')
    assert.equal(typed.revision_count, 1)
    assert.equal(out.sessions.find((s) => s.id === 'own-1').summary, 'Goal: export. Accomplished: yes.')
    store.close()
  })

  test('a row imported from engram keeps its engram key', () => {
    const { store } = source()
    const out = store.exportData()
    assert.ok(out.observations.some((o) => o.sync_id === 'obs-a-1'))
    store.close()
  })
})

describe('round trip through import', () => {
  test('another clone gets the same rows, and a second import inserts nothing', () => {
    const { repo, store } = source()
    const out = store.exportData()
    const target = openMemory(makeRepo())
    const first = target.importExport(JSON.parse(JSON.stringify(out)), { project: basename(repo) })
    assert.deepEqual(first, { observations: out.observations.length, sessions: out.sessions.length, prompts: out.prompts.length, skipped: 0, deleted: 0 })
    assert.deepEqual(raw(target, OBS), raw(store, OBS))
    assert.deepEqual(raw(target, PROMPTS), raw(store, PROMPTS))
    assert.deepEqual(raw(target, SESSIONS), raw(store, SESSIONS))
    const again = target.importExport(out, { project: basename(repo) })
    assert.equal(again.observations + again.sessions + again.prompts, 0)
    assert.equal(raw(target, 'SELECT count(*) AS n FROM observations')[0].n, out.observations.length)
    // the original engram file adds nothing either: engram keys survived
    assert.deepEqual(target.importExport(engram(), { project: 'alpha' }), { observations: 0, sessions: 0, prompts: 0, skipped: 7, deleted: 1 })
    store.close()
    target.close()
  })

  test('soft- and hard-deleted rows do not reach the other clone', () => {
    const { repo, store } = source()
    const target = openMemory(makeRepo())
    target.importExport(store.exportData(), { project: basename(repo) })
    assert.equal(raw(target, "SELECT count(*) AS n FROM observations WHERE title LIKE '%gone'")[0].n, 0)
    store.close()
    target.close()
  })
})

describe('CLI export', () => {
  test('stdout mode prints only valid JSON', () => {
    const { repo, store } = source()
    store.close()
    const r = cli(repo, ['export'])
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stderr, '')
    assert.equal(JSON.parse(r.stdout).version, '0.2.0')
  })

  test('file mode writes the file, prints a one-line count, and imports back', () => {
    const { repo, store } = source()
    store.close()
    const file = join(scratchDir('export-'), 'mem.json')
    const r = cli(repo, ['export', file])
    assert.equal(r.status, 0, r.stderr)
    const out = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(r.stdout, `exported ${out.observations.length} observations, ${out.sessions.length} sessions, ${out.prompts.length} prompts to ${file}\n`)
    const other = makeRepo()
    const imp = cli(other, ['import', file, '--project', basename(repo)])
    assert.equal(imp.status, 0, imp.stderr)
    assert.match(imp.stdout, new RegExp(`imported ${out.observations.length} observations`))
    assert.match(cli(other, ['import', file, '--project', basename(repo)]).stdout, /imported 0 observations, 0 sessions, 0 prompts/)
  })

  test('file mode refuses an existing file and leaves it alone', () => {
    const repo = makeRepo()
    const file = join(scratchDir('export-'), 'mem.json')
    writeFileSync(file, 'keep me')
    const r = cli(repo, ['export', file])
    assert.equal(r.status, 1)
    assert.match(r.stderr, /^construct-memory: .*already exists/)
    assert.equal(r.stderr.trim().split('\n').length, 1)
    assert.equal(readFileSync(file, 'utf8'), 'keep me')
  })

  test('an empty store exports empty lists and no file is made on refusal paths', () => {
    const repo = makeRepo()
    const out = JSON.parse(cli(repo, ['export']).stdout)
    assert.deepEqual([out.sessions, out.observations, out.prompts], [[], [], []])
    assert.ok(!existsSync(join(repo, 'nope.json')))
  })

  test('help documents export', () => {
    assert.match(cli(makeRepo(), ['help']).stdout, /export \[file\]/)
  })
})

describe('import_tombstones', () => {
  test('the tombstone table has its new name and the old one is gone', () => {
    const store = openMemory(makeRepo())
    const names = raw(store, "SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name)
    assert.ok(names.includes('import_tombstones'))
    assert.ok(!names.includes('prompt_tombstones'))
    store.close()
  })
})
