// Relations and judging (S17 of odd/tasks/construct-memory.md): candidates on save, judge, judge-many,
// compare, marks in search and get, hard-delete cleanup, the doctor check, and export/import of relations.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { makeRepo, scratchDir } from '../helpers/repo.mjs'

const BIN = new URL('../../plugins/construct/bin/construct-memory', import.meta.url).pathname
const { openMemory } = await import(new URL('../../plugins/construct/hooks/scripts/memory-store.mjs', import.meta.url))

const cli = (cwd, args, input) => spawnSync(BIN, args, { cwd, encoding: 'utf8', input })
const raw = (store, sql) => {
  const db = new DatabaseSync(store.path)
  try {
    return db.prepare(sql).all()
  } finally {
    db.close()
  }
}
const rels = (store) => raw(store, 'SELECT * FROM memory_relations ORDER BY rowid')
const fresh = () => {
  const repo = makeRepo()
  return { repo, store: openMemory(repo) }
}
const note = (store, title, content = `body of ${title}`, extra = {}) => store.save({ title, content, ...extra }, { candidates: true })

describe('candidates on save', () => {
  test('an insert records pending relations to live rows sharing title terms, capped at 3', () => {
    const { store } = fresh()
    for (let i = 1; i <= 5; i++) note(store, `Database migration plan ${i}`)
    const out = note(store, 'Database migration plan final')
    assert.equal(out.action, 'inserted')
    assert.equal(out.candidates.length, 3)
    const rows = rels(store).filter((r) => r.source_id === out.id)
    assert.equal(rows.length, 3)
    for (const c of out.candidates) {
      assert.match(c.judgment_id, /^rel-[0-9a-f]{16}$/)
      const row = rows.find((r) => r.id === c.judgment_id)
      assert.equal(row.target_id, c.id)
      assert.equal(row.status, 'pending')
      assert.equal(row.marked_by, 'save')
    }
  })

  test('the saved row, soft-deleted rows, and unrelated titles are never candidates', () => {
    const { store } = fresh()
    const gone = note(store, 'Deploy pipeline notes').id
    store.remove(gone)
    note(store, 'Completely different subject')
    const keep = note(store, 'Deploy pipeline caching').id
    const out = note(store, 'Deploy pipeline secrets')
    assert.deepEqual(out.candidates.map((c) => c.id), [keep])
  })

  test('pairs that already have a relation are excluded, whatever its status', () => {
    const { store } = fresh()
    const a = note(store, 'Shared cache layer').id
    const b = note(store, 'Shared cache layer rules')
    assert.deepEqual(b.candidates.map((c) => c.id), [a])
    const c = note(store, 'Shared cache layer rules', 'other body', { topic_key: 'k/one' })
    assert.deepEqual(c.candidates.map((x) => x.id).sort(), [a, b.id].sort())
    // upsert of the same row: pairs exist now, so nothing new
    const again = note(store, 'Shared cache layer rules', 'third body', { topic_key: 'k/one' })
    assert.equal(again.action, 'upserted')
    assert.deepEqual(again.candidates, [])
    assert.equal(rels(store).length, 3)
  })

  test('an upsert records candidates for the row; a dedup records none', () => {
    const { store } = fresh()
    const other = note(store, 'Retry budget policy').id
    const first = note(store, 'Retry budget design', 'v1', { topic_key: 'a/b' })
    assert.deepEqual(first.candidates.map((c) => c.id), [other])
    const third = note(store, 'Retry budget design', 'v1')
    assert.equal(third.action, 'deduplicated')
    assert.deepEqual(third.candidates ?? [], [])
    assert.equal(rels(store).length, 1)
    const fresher = note(store, 'Retry budget limits', 'v2', { topic_key: 'a/c' })
    const up = note(store, 'Retry budget limits revisited', 'v3', { topic_key: 'a/c' })
    assert.equal(up.action, 'upserted')
    assert.equal(up.id, fresher.id)
    assert.deepEqual(up.candidates, [], 'every neighbour is already paired with this row')
  })

  test('a title of only short words or no shared term gives no candidates', () => {
    const { store } = fresh()
    note(store, 'Alpha beta gamma')
    assert.deepEqual(note(store, 'Go is ok').candidates, [])
    assert.deepEqual(note(store, 'Zeta omega').candidates, [])
  })
})

describe('candidates are opt-in', () => {
  test('the store default records no candidates and no rows', () => {
    const { store } = fresh()
    store.save({ title: 'Shared words here', content: 'one' })
    const out = store.save({ title: 'Shared words here too', content: 'two' })
    assert.equal(out.candidates, undefined)
    assert.deepEqual(rels(store), [])
  })
})

describe('judge, judge-many, compare', () => {
  function pair() {
    const { repo, store } = fresh()
    const a = note(store, 'Logging format json').id
    const b = note(store, 'Logging format text')
    return { repo, store, a, b: b.id, jid: b.candidates[0].judgment_id }
  }

  test('judge sets the verdict and re-judging overwrites it', () => {
    const { store, jid } = pair()
    store.judge(jid, 'conflicts_with', { reason: 'formats differ', evidence: 'ADR 3', confidence: 0.9 })
    let row = rels(store)[0]
    assert.deepEqual([row.relation, row.status, row.reason, row.evidence, row.confidence, row.marked_by], ['conflicts_with', 'judged', 'formats differ', 'ADR 3', 0.9, 'agent'])
    store.judge(jid, 'scoped')
    row = rels(store)[0]
    assert.deepEqual([row.relation, row.reason, row.evidence, row.confidence], ['scoped', null, null, null])
    assert.equal(rels(store).length, 1)
  })

  test('judge refuses an unknown judgment id, a bad relation, and a confidence outside [0,1]', () => {
    const { store, jid } = pair()
    assert.throws(() => store.judge('rel-nope', 'related'), /judgment rel-nope not found/)
    assert.throws(() => store.judge(jid, 'friends'), /relation must be one of related, compatible, scoped, conflicts_with, supersedes, not_conflict/)
    for (const c of [1.5, -0.1, 'abc', '']) assert.throws(() => store.judge(jid, 'related', { confidence: c }), /confidence must be a number between 0 and 1/)
    assert.equal(rels(store)[0].status, 'pending')
  })

  test('judge-many applies every item in one transaction', () => {
    const { store } = fresh()
    const ids = []
    for (let i = 0; i < 3; i++) ids.push(...note(store, `Queue backoff rule ${i}`).candidates.map((c) => c.judgment_id))
    assert.ok(ids.length >= 3)
    const n = store.judgeMany(ids.map((judgment_id) => ({ judgment_id, relation: 'related', confidence: 0.5 })))
    assert.equal(n, ids.length)
    assert.ok(rels(store).every((r) => r.status === 'judged' && r.relation === 'related'))
  })

  test('judge-many with one bad item writes nothing and names the item', () => {
    const { store } = fresh()
    const ids = []
    for (let i = 0; i < 3; i++) ids.push(...note(store, `Queue backoff rule ${i}`).candidates.map((c) => c.judgment_id))
    const items = ids.map((judgment_id) => ({ judgment_id, relation: 'related' }))
    items[2] = { judgment_id: ids[2], relation: 'bogus' }
    assert.throws(() => store.judgeMany(items), /item 3: relation must be one of/)
    assert.throws(() => store.judgeMany([items[0], { judgment_id: 'rel-missing', relation: 'related' }]), /item 2: judgment rel-missing not found/)
    assert.ok(rels(store).every((r) => r.status === 'pending'))
  })

  test('judge-many needs 1 to 32 items', () => {
    const { store } = fresh()
    assert.throws(() => store.judgeMany([]), /1 to 32/)
    assert.throws(() => store.judgeMany(Array.from({ length: 33 }, () => ({ judgment_id: 'x', relation: 'related' }))), /1 to 32/)
    assert.throws(() => store.judgeMany({}), /1 to 32/)
  })

  test('compare creates a relation for a new pair and updates an existing one', () => {
    const { store } = fresh()
    const a = note(store, 'Alpha topic one').id
    const b = note(store, 'Zebra unrelated words').id
    store.compare(a, b, 'supersedes', { confidence: 0.8, reasoning: 'newer' })
    let rows = rels(store)
    assert.equal(rows.length, 1)
    assert.deepEqual([rows[0].source_id, rows[0].target_id, rows[0].relation, rows[0].status, rows[0].reason, rows[0].confidence, rows[0].marked_by], [a, b, 'supersedes', 'judged', 'newer', 0.8, 'agent'])
    store.compare(b, a, 'conflicts_with', { confidence: 1 })
    rows = rels(store)
    assert.equal(rows.length, 1)
    assert.deepEqual([rows[0].source_id, rows[0].target_id, rows[0].relation], [b, a, 'conflicts_with'])
  })

  test('compare updates the pending relation made by save', () => {
    const { store, a, b } = pair()
    store.compare(a, b, 'compatible', { confidence: 0.6 })
    assert.equal(rels(store).length, 1)
    assert.equal(rels(store)[0].status, 'judged')
  })

  test('compare validates its input', () => {
    const { store, a, b } = pair()
    assert.throws(() => store.compare(a, b, 'related', {}), /confidence is required/)
    assert.throws(() => store.compare(a, b, 'related', { confidence: 2 }), /between 0 and 1/)
    assert.throws(() => store.compare(a, b, 'nope', { confidence: 0.5 }), /relation must be one of/)
    assert.throws(() => store.compare(a, a, 'related', { confidence: 0.5 }), /two different/)
    assert.throws(() => store.compare(a, 999, 'related', { confidence: 0.5 }), /observation #999 not found/)
  })
})

describe('marks in search and get', () => {
  test('judged conflicts_with and supersedes are marked; other relations and pending are not', () => {
    const { store } = fresh()
    const a = note(store, 'Mark alpha subject').id
    const b = note(store, 'Mark beta subject').id
    const c = note(store, 'Mark gamma subject').id
    store.compare(a, b, 'conflicts_with', { confidence: 0.9 })
    store.compare(b, c, 'supersedes', { confidence: 0.9 })
    const marks = (q) => Object.fromEntries(store.search(q).map((r) => [r.id, r.marks]))
    const m = marks('subject')
    assert.deepEqual(m[a], [`conflicts with #${b}`])
    assert.deepEqual([...m[b]].sort(), [`conflicts with #${a}`, `supersedes #${c}`])
    assert.deepEqual(m[c], [`superseded by #${b}`])
    assert.deepEqual(store.get(c).marks, [`superseded by #${b}`])
    store.judge(rels(store).find((r) => r.relation === 'supersedes').id, 'related')
    assert.deepEqual(store.get(c).marks, [])
  })

  test('marks come out by relation kind then the other id ascending, whatever the creation order', () => {
    const { store } = fresh()
    const [a, b, c, d, e] = ['Ord alpha subject', 'Ord beta subject', 'Ord gamma subject', 'Ord delta subject', 'Ord eps subject'].map((t) => note(store, t).id)
    store.compare(a, e, 'supersedes', { confidence: 0.9 })
    store.compare(a, d, 'supersedes', { confidence: 0.9 })
    store.compare(a, c, 'supersedes', { confidence: 0.9 })
    store.compare(a, b, 'conflicts_with', { confidence: 0.9 })
    store.remove(c)
    store.remove(e)
    assert.deepEqual(store.get(a).marks, [`conflicts with #${b}`, `supersedes #${c} (deleted)`, `supersedes #${d}`, `supersedes #${e} (deleted)`])
  })

  test('a supersedes mark to a soft-deleted target is shown as deleted; other deleted ends hide the mark', () => {
    const { store } = fresh()
    const a = note(store, 'Ghost alpha subject').id
    const b = note(store, 'Ghost beta subject').id
    store.compare(a, b, 'supersedes', { confidence: 0.9 })
    const c = note(store, 'Ghost gamma subject').id
    const d = note(store, 'Ghost delta subject').id
    store.compare(c, d, 'conflicts_with', { confidence: 0.9 })
    store.remove(b)
    store.remove(d)
    assert.deepEqual(store.get(a).marks, [`supersedes #${b} (deleted)`])
    assert.deepEqual(store.get(c).marks, [])
  })

  test('a superseded row whose superseder is deleted shows no mark', () => {
    const { store } = fresh()
    const a = note(store, 'Rev alpha subject').id
    const b = note(store, 'Rev beta subject').id
    store.compare(a, b, 'supersedes', { confidence: 0.9 })
    store.remove(a)
    assert.deepEqual(store.get(b).marks, [])
  })
})

describe('hard delete and doctor', () => {
  test('a hard delete removes the relations of the observation; a soft delete keeps them', () => {
    const { store } = fresh()
    const a = note(store, 'Erase alpha subject').id
    const b = note(store, 'Erase beta subject').id
    const c = note(store, 'Erase gamma subject').id
    store.compare(a, b, 'related', { confidence: 0.5 })
    store.compare(b, c, 'related', { confidence: 0.5 })
    const n = rels(store).length
    store.remove(a)
    assert.equal(rels(store).length, n)
    store.remove(a, { hard: true })
    assert.ok(rels(store).every((r) => r.source_id !== a && r.target_id !== a))
    assert.equal(rels(store).filter((r) => r.source_id === b && r.target_id === c).length, 1)
  })

  test('doctor reports an orphaned relation and is ok otherwise', () => {
    const { store } = fresh()
    const a = note(store, 'Doctor alpha subject').id
    const b = note(store, 'Doctor beta subject').id
    store.compare(a, b, 'related', { confidence: 0.5 })
    assert.equal(store.doctor().find((c) => c.check === 'orphaned relations').ok, true)
    const db = new DatabaseSync(store.path)
    db.exec(`INSERT INTO memory_relations (id, source_id, target_id, marked_by, created_at, updated_at) VALUES ('rel-x', ${a}, 4040, 'agent', 'now', 'now')`)
    db.close()
    const check = store.doctor().find((c) => c.check === 'orphaned relations')
    assert.equal(check.ok, false)
    assert.match(check.detail, /1 relations/)
  })
})

describe('relation text is redacted (S21a)', () => {
  const TAGGED = ['<private>secret</private> kept', 'kept <private>secret']
  const clean = (store) => {
    const dump = JSON.stringify([rels(store), store.exportData().relations])
    assert.ok(!dump.includes('secret'), dump)
    assert.ok(dump.includes('[REDACTED]'), dump)
  }
  for (const t of TAGGED) {
    test(`judge, judge-many, compare, and import redact ${JSON.stringify(t)}`, () => {
      const { store } = fresh()
      const a = note(store, 'Logging format json').id
      const b = note(store, 'Logging format text')
      store.judge(b.candidates[0].judgment_id, 'conflicts_with', { reason: t, evidence: t })
      clean(store)
      const m = fresh()
      const x = note(m.store, 'Cache policy json').id
      const y = note(m.store, 'Cache policy text')
      m.store.judgeMany([{ judgment_id: y.candidates[0].judgment_id, relation: 'scoped', reason: t, evidence: t }])
      clean(m.store)
      const c = fresh()
      const p = note(c.store, 'Queue layout one').id
      const q = note(c.store, 'Queue layout two').id
      c.store.compare(p, q, 'related', { confidence: 0.5, reasoning: t })
      clean(c.store)
      const data = c.store.exportData()
      data.relations[0].reason = t
      data.relations[0].evidence = t
      const dest = fresh()
      dest.store.importExport(JSON.parse(JSON.stringify(data)), { project: data.observations[0].project })
      assert.equal(rels(dest.store).length, 1)
      clean(dest.store)
    })
  }
})

describe('export and import of relations', () => {
  test('relations whose ends are both exported round-trip, and importing twice adds nothing', () => {
    const src = fresh()
    const a = note(src.store, 'Round alpha subject').id
    const b = note(src.store, 'Round beta subject').id
    const c = note(src.store, 'Round gamma subject').id
    src.store.compare(a, b, 'supersedes', { confidence: 0.9, reasoning: 'newer' })
    src.store.remove(c) // an end that is not exported
    src.store.compare(a, c, 'related', { confidence: 0.5 })
    const before = rels(src.store).length
    const data = src.store.exportData()
    assert.equal(data.relations.length, 1)
    assert.equal(data.relations[0].relation, 'supersedes')
    const dest = fresh()
    const first = dest.store.importExport(JSON.parse(JSON.stringify(data)), { project: data.observations[0].project })
    assert.equal(first.relations, 1)
    const second = dest.store.importExport(JSON.parse(JSON.stringify(data)), { project: data.observations[0].project })
    assert.equal(second.relations, 0)
    const rows = rels(dest.store)
    assert.equal(rows.length, 1)
    const [x, y] = rows[0].relation === 'supersedes' ? [rows[0].source_id, rows[0].target_id] : []
    assert.equal(dest.store.get(x).title, 'Round alpha subject')
    assert.equal(dest.store.get(y).title, 'Round beta subject')
    assert.deepEqual([rows[0].status, rows[0].reason, rows[0].confidence, rows[0].marked_by], ['judged', 'newer', 0.9, 'agent'])
    // a round trip back into the source adds nothing
    const back = src.store.importExport(dest.store.exportData(), { project: dest.store.exportData().observations[0].project })
    assert.equal(back.relations, 0)
    assert.equal(rels(src.store).length, before)
  })
})

describe('import of relation confidence', () => {
  test('a confidence outside [0,1] or not a number is stored as null; a valid one is kept', () => {
    const src = fresh()
    const a = note(src.store, 'Conf alpha subject').id
    const b = note(src.store, 'Conf beta subject').id
    src.store.compare(a, b, 'related', { confidence: 0.5 })
    const data = src.store.exportData()
    const project = data.observations[0].project
    for (const [given, expected] of [[1.5, null], [-0.1, null], ['high', null], [0.4, 0.4]]) {
      const copy = JSON.parse(JSON.stringify(data))
      copy.relations[0].confidence = given
      const dest = fresh()
      assert.equal(dest.store.importExport(copy, { project }).relations, 1)
      assert.equal(rels(dest.store)[0].confidence, expected, String(given))
    }
  })
})

describe('CLI', () => {
  const save = (repo, title, extra = {}) => cli(repo, ['save'], JSON.stringify({ title, content: `body ${title}`, ...extra }))

  test('save prints candidates under its line; no candidates prints nothing extra', () => {
    const { repo } = fresh()
    assert.equal(save(repo, 'Cli unique first').stdout, 'saved #1 (inserted)\n')
    const r = save(repo, 'Cli unique second')
    assert.equal(r.status, 0)
    assert.match(r.stdout, /^saved #2 \(inserted\)\n  candidate #1 Cli unique first \(judge: construct-memory judge rel-[0-9a-f]{16} <relation>\)\n$/)
    assert.equal(r.stderr, '')
  })

  test('judge, judge-many, compare print one line; search and get show the marks', () => {
    const { repo } = fresh()
    save(repo, 'Cli unique first')
    const jid = save(repo, 'Cli unique second').stdout.match(/rel-[0-9a-f]{16}/)[0]
    assert.equal(cli(repo, ['judge', jid, 'conflicts_with', '--reason', 'differ', '--evidence', 'e', '--confidence', '0.9']).stdout, `judged ${jid} conflicts_with\n`)
    assert.match(cli(repo, ['search', 'unique']).stdout, /#2 .*conflicts with #1/)
    assert.match(cli(repo, ['get', '1']).stdout, /relations: conflicts with #2/)
    assert.equal(cli(repo, ['judge-many'], JSON.stringify([{ judgment_id: jid, relation: 'scoped' }])).stdout, 'judged 1 relations\n')
    assert.doesNotMatch(cli(repo, ['get', '1']).stdout, /relations:/)
    assert.equal(cli(repo, ['compare', '2', '1', 'supersedes', '--confidence', '0.8', '--reasoning', 'newer']).stdout, 'compared #2 #1 supersedes\n')
    assert.match(cli(repo, ['get', '1']).stdout, /relations: superseded by #2/)
    assert.match(cli(repo, ['get', '2']).stdout, /relations: supersedes #1/)
  })

  test('validation errors are one line on stderr with a non-zero exit', () => {
    const { repo } = fresh()
    save(repo, 'Cli unique first')
    const jid = save(repo, 'Cli unique second').stdout.match(/rel-[0-9a-f]{16}/)[0]
    for (const [args, input, pattern] of [
      [['judge', jid, 'friends'], undefined, /relation must be one of/],
      [['judge', jid, 'related', '--confidence', '3'], undefined, /confidence must be a number between 0 and 1/],
      [['judge', 'rel-nope', 'related'], undefined, /judgment rel-nope not found/],
      [['judge', jid], undefined, /judge needs/],
      [['judge-many'], 'nope', /invalid JSON on stdin/],
      [['judge-many'], '{}', /stdin must be a JSON array/],
      [['judge-many'], '[]', /1 to 32/],
      [['compare', '1', '2', 'related'], undefined, /compare needs --confidence/],
      [['compare', '1', '2'], undefined, /compare needs/],
      [['compare', '1', '9', 'related', '--confidence', '0.5'], undefined, /observation #9 not found/],
    ]) {
      const r = cli(repo, args, input)
      assert.equal(r.status, 1, args.join(' '))
      assert.equal(r.stdout, '')
      assert.match(r.stderr, new RegExp(`^construct-memory: .*${pattern.source}`))
      assert.equal(r.stderr.trim().split('\n').length, 1)
    }
  })

  test('doctor lists the orphaned relations check; help lists the new commands; save/search keep their lines', () => {
    const { repo } = fresh()
    assert.match(cli(repo, ['doctor']).stdout, /^ok orphaned relations$/m)
    const help = cli(repo, ['help']).stdout
    for (const w of ['judge <judgment-id>', 'judge-many', 'compare <id-a>']) assert.ok(help.includes(w), w)
    save(repo, 'Plain note one')
    assert.match(cli(repo, ['search', 'plain']).stdout, /^#1 \[manual\] Plain note one - body Plain note one\n$/)
  })
})

describe('pending relations (S8 of odd/tasks/memory-engram-parity.md)', () => {
  // seed: three notes sharing title terms; the 2nd save gets 1 candidate, the 3rd gets 2, all pending.
  const seed = (store) => [note(store, 'parser cache alpha'), note(store, 'parser cache beta'), note(store, 'parser cache gamma')]

  test('the store lists pending relations between live rows, newest first, with a limit', () => {
    const { store } = fresh()
    const [a, b, c] = seed(store)
    const list = store.pendingRelations()
    assert.deepEqual(list.map((r) => [r.judgment_id, r.source.id, r.target.id]), [...c.candidates.reverse(), ...b.candidates].map((x) => [x.judgment_id, x.judgment_id === b.candidates[0]?.judgment_id ? b.id : c.id, x.id]))
    assert.deepEqual(list[0].source, { id: c.id, type: 'manual', title: 'parser cache gamma' })
    assert.equal(store.pendingRelations({ limit: 1 }).length, 1)
    store.judge(b.candidates[0].judgment_id, 'compatible')
    assert.equal(store.pendingRelations().length, 2)
    store.remove(a.id)
    assert.deepEqual(store.pendingRelations().map((r) => r.target.id), [b.id])
    store.close()
  })

  test('the context ends with the pending count line only when some are pending', () => {
    const { store } = fresh()
    note(store, 'lonely note')
    assert.doesNotMatch(store.context(), /Relations:/)
    seed(store)
    assert.ok(store.context().endsWith('\nRelations: 3 pending judgment; list them with construct-memory relations pending.\n'))
    store.close()
  })

  test('relations pending prints one line per relation, --json the same rows, --limit caps them', () => {
    const { repo, store } = fresh()
    const [, b, c] = seed(store)
    store.close()
    const r = cli(repo, ['relations', 'pending'])
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.stderr, '')
    const lines = r.stdout.trim().split('\n')
    assert.equal(lines.length, 3)
    assert.equal(lines[2], `${b.candidates[0].judgment_id} #${b.id} [manual] parser cache beta <-> #${b.candidates[0].id} [manual] parser cache alpha`)
    const json = JSON.parse(cli(repo, ['relations', 'pending', '--json', '--limit', '2']).stdout)
    assert.equal(json.length, 2)
    assert.deepEqual(Object.keys(json[0]).sort(), ['created_at', 'judgment_id', 'source', 'target'])
    assert.equal(json[0].source.id, c.id)
    assert.equal(cli(repo, ['relations', 'pending', '--limit', '0']).stdout.trim().split('\n').length, 3, 'invalid limit falls back to the default')
  })

  test('relations pending with none says so; bad shapes fail with one line and exit 1', () => {
    const { repo, store } = fresh()
    store.close()
    const none = cli(repo, ['relations', 'pending'])
    assert.deepEqual([none.status, none.stdout, none.stderr], [0, 'no pending relations\n', ''])
    for (const [args, message] of [
      [['relations'], /relations needs pending/],
      [['relations', 'list'], /relations needs pending/],
      [['relations', 'pending', 'extra'], /relations pending takes only --limit and --json/],
      [['relations', 'pending', '--type', 'x'], /relations does not take --type/],
    ]) {
      const r = cli(repo, args)
      assert.equal(r.status, 1, args.join(' '))
      assert.equal(r.stdout, '')
      assert.match(r.stderr, message)
      assert.equal(r.stderr.trim().split('\n').length, 1)
    }
  })

  test('help names relations pending and its flags', () => {
    assert.match(cli(scratchDir('mem-help-'), ['help']).stdout, /relations pending \[--limit N\] \[--json\]/)
  })
})

describe('passive rows are not candidates (S1 of odd/tasks/memory-maintenance.md)', () => {
  test('a save matching only passive rows gets no candidates and no relation row; an agent row still matches', () => {
    const { store } = fresh()
    store.save({ title: 'Parser quirk in lexer', content: 'passive body one', type: 'passive' })
    store.save({ title: 'Parser quirk in tokenizer', content: 'passive body two', type: 'passive' })
    const none = note(store, 'Parser quirk summary')
    assert.deepEqual(none.candidates, [])
    assert.equal(rels(store).length, 0)
    const agent = note(store, 'Parser quirk decision', 'agent body', { type: 'decision' })
    assert.deepEqual(agent.candidates.map((c) => c.id), [none.id])
    assert.equal(rels(store).length, 1)
  })
})
