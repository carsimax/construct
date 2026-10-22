// Erasing is real (S21b): after `remove(id, {hard})` and `deletePrompt`, the deleted text is gone from
// the raw database file and the WAL, not only from the tables.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { makeRepo } from '../helpers/repo.mjs'

const { openMemory } = await import(new URL('../../plugins/construct/hooks/scripts/memory-store.mjs', import.meta.url))

const bytes = (path) => (existsSync(path) ? readFileSync(path).toString('latin1') : '')
const filler = (store) => {
  for (let i = 0; i < 20; i++) store.save({ title: `filler ${i}`, content: `unrelated filler text number ${i} `.repeat(20) })
}

describe('secure erase (S21b)', () => {
  test('a hard-deleted observation and its versions leave no bytes in the database or the WAL', () => {
    const store = openMemory(makeRepo())
    const marker = 'ZQXMARKERobs7731'
    filler(store)
    const { id } = store.save({ title: `title ${marker}`, content: `first ${marker} body`, topic_key: 'erase/me' })
    store.update(id, { content: `second ${marker} body` })
    assert.ok(bytes(store.path).includes(marker) || bytes(`${store.path}-wal`).includes(marker), 'marker is stored before the delete')
    assert.equal(store.remove(id, { hard: true }), true)
    store.close()
    assert.ok(!bytes(store.path).includes(marker), 'marker left in memory.db')
    assert.ok(!bytes(`${store.path}-wal`).includes(marker), 'marker left in memory.db-wal')
  })

  test('a deleted prompt leaves no bytes in the database or the WAL', () => {
    const store = openMemory(makeRepo())
    const marker = 'ZQXMARKERprompt5512'
    filler(store)
    store.startSession('s')
    store.addPrompt('s', `please remember ${marker} for later`)
    const [{ id }] = store.prompts({ limit: 1 })
    assert.equal(store.deletePrompt(id), true)
    store.close()
    assert.ok(!bytes(store.path).includes(marker), 'marker left in memory.db')
    assert.ok(!bytes(`${store.path}-wal`).includes(marker), 'marker left in memory.db-wal')
  })
})
