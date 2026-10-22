// S15 of odd/tasks/construct-memory.md: suggest-topic-key, timeline, pin/unpin, stats, and prompt search,
// through the store API and the CLI on throwaway git repositories.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { makeRepo } from '../helpers/repo.mjs'

const BIN = new URL('../../plugins/construct/bin/construct-memory', import.meta.url).pathname
const { openMemory, suggestTopicKey } = await import(new URL('../../plugins/construct/hooks/scripts/memory-store.mjs', import.meta.url))

const cli = (cwd, args, input = '') => spawnSync(BIN, args, { cwd, input, encoding: 'utf8' })
const ok = (r) => {
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stderr, '')
  return r.stdout
}
const fails = (r, pattern) => {
  assert.equal(r.status, 1)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, pattern)
  assert.equal(r.stderr.trim().split('\n').length, 1, 'one line on stderr')
}
const open = () => {
  const repo = makeRepo()
  return { repo, store: openMemory(repo, { now: () => new Date('2026-01-15T12:00:00Z') }) }
}
const note = (title, extra = {}) => ({ title, content: `${title} body`, type: 'discovery', ...extra })
// manual notes never come due, so CLI output (real clock) has no needs_review marker
const plain = (title, extra = {}) => note(title, { type: 'manual', ...extra })

describe('suggest-topic-key', () => {
  test('family from the type, slug from the title', () => {
    assert.equal(suggestTopicKey({ type: 'bugfix', title: 'Fix login redirect loop' }), 'bug/fix-login-redirect-loop')
    assert.equal(suggestTopicKey({ type: 'architecture', title: 'Auth Service Boundaries' }), 'architecture/auth-service-boundaries')
    assert.equal(suggestTopicKey({ type: 'design', title: 'Cache layer' }), 'architecture/cache-layer')
  })

  test('drops a title prefix equal to the family and falls back to general', () => {
    assert.equal(suggestTopicKey({ type: 'decision', title: 'Decision: use sqlite' }), 'decision/use-sqlite')
    assert.equal(suggestTopicKey({ type: 'decision', title: 'Decision' }), 'decision/general')
  })

  test('an unknown type uses keywords in the text, then the type itself, then topic', () => {
    assert.equal(suggestTopicKey({ type: 'manual', title: 'Crash on startup' }), 'bug/crash-on-startup')
    assert.equal(suggestTopicKey({ type: 'preference', title: 'Tabs' }), 'preference/tabs')
    assert.equal(suggestTopicKey({ title: 'Tabs' }), 'topic/tabs')
  })

  test('without a title the slug comes from the first eight words of the content', () => {
    assert.equal(suggestTopicKey({ type: 'pattern', content: 'one two three four five six seven eight nine ten' }), 'pattern/one-two-three-four-five-six-seven-eight')
  })

  test('private text is redacted and a non-ASCII title gets a stable hash suffix', () => {
    assert.equal(suggestTopicKey({ type: 'config', title: 'Setup <private>secret</private> db' }), 'config/setup-redacted-db')
    const a = suggestTopicKey({ type: 'decision', title: 'Decisión café' })
    assert.match(a, /^decision\/decisi-n-caf-u-[0-9a-f]{12}$/)
    assert.equal(suggestTopicKey({ type: 'decision', title: 'Decisión café' }), a)
    assert.notEqual(suggestTopicKey({ type: 'decision', title: 'Decisión café!é' }), a)
  })

  test('the key stays within 120 bytes', () => {
    assert.ok(Buffer.byteLength(suggestTopicKey({ type: 'decision', title: 'é'.repeat(300) })) <= 120)
    assert.ok(Buffer.byteLength(suggestTopicKey({ type: 'decision', title: 'word '.repeat(60) })) <= 120)
  })

  test('CLI prints the key and writes nothing', () => {
    const { repo, store } = open()
    assert.equal(ok(cli(repo, ['suggest-topic-key'], JSON.stringify({ type: 'bugfix', title: 'Fix N+1 query' }))), 'bug/fix-n-1-query\n')
    assert.equal(store.stats().observations, 0)
  })

  test('CLI errors: bad JSON, nothing to name, wrong types', () => {
    const { repo } = open()
    fails(cli(repo, ['suggest-topic-key'], 'nope'), /invalid JSON on stdin/)
    fails(cli(repo, ['suggest-topic-key'], '{"type":"bugfix"}'), /title or content is required/)
    fails(cli(repo, ['suggest-topic-key'], '{"title":5}'), /title must be a string/)
  })
})

describe('timeline', () => {
  function session() {
    const { repo, store } = open()
    const ids = []
    for (let i = 1; i <= 8; i++) ids.push(store.save(plain(`s1 note ${i}`, { session_id: 's1' })).id)
    const other = store.save(plain('other session', { session_id: 's2' })).id
    return { repo, store, ids, other }
  }

  test('same-session live neighbours, oldest first, default 5 and 5', () => {
    const { store, ids } = session()
    const t = store.timeline(ids[3])
    assert.equal(t.session_id, 's1')
    assert.equal(t.total, 8)
    assert.deepEqual(t.before.map((r) => r.id), ids.slice(0, 3))
    assert.equal(t.focus.id, ids[3])
    assert.deepEqual(t.after.map((r) => r.id), ids.slice(4))
    assert.equal(store.timeline(ids[7]).before.length, 5)
  })

  test('--before and --after bound each side; other sessions and soft-deleted rows are left out', () => {
    const { store, ids, other } = session()
    store.remove(ids[4])
    const t = store.timeline(ids[3], { before: 1, after: 2 })
    assert.deepEqual(t.before.map((r) => r.id), [ids[2]])
    assert.deepEqual(t.after.map((r) => r.id), [ids[5], ids[6]])
    assert.equal(t.total, 7)
    assert.ok(![...t.before, ...t.after].some((r) => r.id === other))
  })

  test('unknown and soft-deleted ids give null', () => {
    const { store, ids } = session()
    store.remove(ids[0])
    assert.equal(store.timeline(ids[0]), null)
    assert.equal(store.timeline(999), null)
  })

  test('CLI marks the focus', () => {
    const { repo, ids } = (() => {
      const s = session()
      s.store.close()
      return s
    })()
    const out = ok(cli(repo, ['timeline', String(ids[1]), '--before', '1', '--after', '1']))
    assert.equal(out, [
      'session s1: 8 observations',
      `  #${ids[0]} [manual] s1 note 1 - s1 note 1 body`,
      `> #${ids[1]} [manual] s1 note 2 - s1 note 2 body`,
      `  #${ids[2]} [manual] s1 note 3 - s1 note 3 body`,
      '',
    ].join('\n'))
  })

  test('CLI errors', () => {
    const { repo } = open()
    fails(cli(repo, ['timeline']), /an observation id/)
    fails(cli(repo, ['timeline', '42']), /observation #42 not found/)
  })
})

describe('pin and unpin', () => {
  test('pin flags a live observation; unknown and deleted ids return false', () => {
    const { store } = open()
    const id = store.save(note('keep me')).id
    assert.equal(store.pin(id), true)
    assert.equal(store.search('keep')[0].pinned, true)
    assert.equal(store.pin(id, false), true)
    assert.equal(store.search('keep')[0].pinned, false)
    store.remove(id)
    assert.equal(store.pin(id), false)
    assert.equal(store.pin(999), false)
  })

  test('the context lists pinned observations in their own section, not again under recent', () => {
    const { store } = open()
    const a = store.save(note('always load me')).id
    store.save(note('just recent'))
    store.pin(a)
    const text = store.context()
    assert.match(text, /### Pinned\n- \[discovery\] \*\*always load me\*\*\n\n### Recent Observations\n- \[discovery\] \*\*just recent\*\*\n/)
    assert.equal(text.split('always load me').length, 2)
    store.pin(a, false)
    assert.doesNotMatch(store.context(), /### Pinned/)
  })

  test('the pinned section holds at most 20, newest first', () => {
    const { store } = open()
    for (let i = 1; i <= 22; i++) store.pin(store.save(note(`pin ${String(i).padStart(2, '0')}`)).id)
    const section = store.context().split('### Pinned\n')[1].split('\n\n')[0].split('\n')
    assert.equal(section.length, 20)
    assert.match(section[0], /pin 22/)
    assert.match(section[19], /pin 03/)
  })

  test('a pinned-only store still gets a context', () => {
    const { store } = open()
    store.pin(store.save(note('solo')).id)
    assert.match(store.context(), /### Pinned/)
  })

  test('the +0.10 boost reorders two otherwise equal hits', () => {
    const { store } = open()
    const first = store.save({ title: 'cache alpha', content: 'shared cache body', type: 'discovery' }).id
    const second = store.save({ title: 'cache bravo', content: 'shared cache body', type: 'discovery' }).id
    assert.deepEqual(store.search('cache').map((r) => r.id), [first, second])
    store.pin(second)
    assert.deepEqual(store.search('cache').map((r) => r.id), [second, first])
  })

  test('survives export and import', () => {
    const { store } = open()
    const id = store.save(note('pinned thing')).id
    store.save(note('plain thing'))
    store.pin(id)
    const data = store.exportData()
    assert.deepEqual(data.observations.map((o) => o.pinned), [true, false])
    const { store: target } = open()
    target.importExport(data, { project: data.observations[0].project })
    assert.deepEqual(target.search('thing').map((r) => [r.title, r.pinned]).sort(), [['pinned thing', true], ['plain thing', false]])
  })

  test('an import without the field stays unpinned', () => {
    const { store } = open()
    store.importExport({ version: '0.2.0', sessions: [], prompts: [], observations: [{ id: 1, sync_id: 'x1', project: 'p', title: 'old', content: 'old body', type: 'discovery', created_at: '2025-01-01T00:00:00Z' }] })
    assert.equal(store.search('old')[0].pinned, false)
  })

  test('CLI pin, unpin, errors, and the pinned marker in search', () => {
    const { repo, store } = open()
    const id = store.save(plain('cli pinned')).id
    store.close()
    assert.equal(ok(cli(repo, ['pin', String(id)])), `pinned #${id}\n`)
    assert.match(ok(cli(repo, ['search', 'cli'])), /\[manual\] cli pinned pinned - /)
    assert.equal(ok(cli(repo, ['unpin', String(id)])), `unpinned #${id}\n`)
    assert.doesNotMatch(ok(cli(repo, ['search', 'cli'])), /pinned pinned/)
    fails(cli(repo, ['pin', '77']), /observation #77 not found/)
    fails(cli(repo, ['unpin', 'x']), /an observation id/)
  })
})

describe('stats', () => {
  test('counts live, soft-deleted, needing review, and pinned observations, sessions, prompts, and size', () => {
    const { store } = open()
    const a = store.save(note('a', { type: 'decision' })).id
    const b = store.save(note('b', { type: 'decision' })).id
    const c = store.save(note('c', { type: 'manual' })).id
    store.save(note('d', { type: 'manual' }))
    store.pin(a)
    store.pin(c)
    store.startSession('s1')
    store.addPrompt('s1', 'hello')
    store.addPrompt('s1', 'world')
    store.remove(b)
    store.remove(c, { hard: true })
    const s = store.stats()
    assert.deepEqual({ ...s, bytes: 0 }, { observations: 2, deleted: 1, needing_review: 0, pinned: 1, sessions: 1, prompts: 2, bytes: 0 })
    assert.ok(s.bytes > 0)
  })

  test('needing review counts only live rows past review_after', () => {
    const repo = makeRepo()
    let t = Date.parse('2026-01-15T12:00:00Z')
    const store = openMemory(repo, { now: () => new Date(t) })
    store.save(note('old', { type: 'preference' }))
    const gone = store.save(note('gone', { type: 'preference' })).id
    store.remove(gone)
    assert.equal(store.stats().needing_review, 0)
    t += 120 * 24 * 60 * 60 * 1000
    assert.equal(store.stats().needing_review, 1)
  })

  test('CLI prints one line per count', () => {
    const { repo, store } = open()
    store.save(plain('x'))
    store.close()
    const out = ok(cli(repo, ['stats']))
    assert.match(out, /^observations: 1\nsoft-deleted observations: 0\nneeding review: 0\npinned observations: 0\nsessions: 0\nprompts: 0\ndatabase size: \d+ bytes\n$/)
  })
})

describe('prompt search', () => {
  function withPrompts() {
    const { repo, store } = open()
    for (const p of ['deploy the staging server', 'fix the login page', 'deploy to production', 'ok go', '100% done_ish']) store.addPrompt('s1', p)
    return { repo, store }
  }

  test('FTS matches every term, newest first among equals', () => {
    const { store } = withPrompts()
    assert.deepEqual(store.prompts({ search: 'deploy' }).map((p) => p.content), ['deploy to production', 'deploy the staging server'])
    assert.deepEqual(store.prompts({ search: 'deploy staging' }).map((p) => p.content), ['deploy the staging server'])
    assert.deepEqual(store.prompts({ search: 'nothing here' }), [])
  })

  test('quotes in the query do not break it', () => {
    const { store } = withPrompts()
    assert.deepEqual(store.prompts({ search: '"deploy" "he"r"' }), [])
    assert.equal(store.prompts({ search: '"login"' }).length, 1)
  })

  test('a term under 3 characters falls back to an escaped LIKE scan', () => {
    const { store } = withPrompts()
    assert.deepEqual(store.prompts({ search: 'go' }).map((p) => p.content), ['ok go'])
    assert.deepEqual(store.prompts({ search: '%' }).map((p) => p.content), ['100% done_ish'])
    assert.deepEqual(store.prompts({ search: '_' }).map((p) => p.content), ['100% done_ish'])
  })

  test('--limit bounds the result and a deleted prompt is not found', () => {
    const { store } = withPrompts()
    assert.equal(store.prompts({ search: 'deploy', limit: 1 }).length, 1)
    store.deletePrompt(store.prompts({ search: 'login' })[0].id)
    assert.deepEqual(store.prompts({ search: 'login' }), [])
  })

  test('CLI prints the same lines as prompts, and reports no match', () => {
    const { repo, store } = withPrompts()
    store.close()
    const out = ok(cli(repo, ['prompts', '--search', 'deploy']))
    const lines = out.trim().split('\n')
    assert.equal(lines.length, 2)
    assert.match(lines[0], /^#3 \S+ deploy to production$/)
    assert.equal(ok(cli(repo, ['prompts', '--search', 'zzzzz'])), 'no prompts found\n')
    assert.match(ok(cli(repo, ['prompts', '--search', 'go'])), /ok go/)
    fails(cli(repo, ['prompts', '--search', '  ']), /prompts --search needs a query/)
  })

  test('plain prompts still lists newest first', () => {
    const { repo, store } = withPrompts()
    store.close()
    assert.equal(ok(cli(repo, ['prompts', '--limit', '2'])).trim().split('\n').length, 2)
  })
})
