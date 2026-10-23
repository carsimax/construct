// The construct-memory CLI (S5 of odd/tasks/construct-memory.md), run as a child process
// on throwaway git repositories.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { makeRepo, scratchDir } from '../helpers/repo.mjs'

const BIN = new URL('../../plugins/construct/bin/construct-memory', import.meta.url).pathname
const { openMemory } = await import(new URL('../../plugins/construct/hooks/scripts/memory-store.mjs', import.meta.url))

// cli runs the executable itself (shebang) and returns { status, stdout, stderr }.
function cli(cwd, args, input = '') {
  return spawnSync(BIN, args, { cwd, input, encoding: 'utf8' })
}
const saveJson = (repo, obj) => cli(repo, ['save'], JSON.stringify(obj))
const ok = (r) => {
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stderr, '')
  return r.stdout
}
const fails = (r, pattern) => {
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, pattern)
  assert.equal(r.stderr.trim().split('\n').length, 1, 'one line on stderr')
}
// age makes every observation due for review (the CLI uses the real clock).
function age(repo) {
  const store = openMemory(repo)
  const db = new DatabaseSync(store.path)
  db.prepare("UPDATE observations SET review_after = '2000-01-01T00:00:00.000Z'").run()
  db.close()
  store.close()
}

describe('construct-memory', () => {
  test('is executable with a node shebang', () => {
    assert.ok(statSync(BIN).mode & 0o100)
    assert.match(spawnSync('head', ['-1', BIN], { encoding: 'utf8' }).stdout, /^#!\/usr\/bin\/env node/)
  })

  test('help and no arguments print the usage', () => {
    const repo = makeRepo()
    for (const args of [[], ['help']]) {
      const out = ok(cli(repo, args))
      for (const word of ['save', 'search', 'get', 'context', 'update', 'delete', 'summary', 'review', 'import', 'prompts', 'suggest-topic-key', 'timeline', 'pin', 'unpin', 'stats', 'doctor', 'consolidate', '--confirm', '--search']) assert.match(out, new RegExp(word))
    }
  })

  test('help works outside a repository', () => {
    assert.match(ok(cli(scratchDir('cli-nogit-'), ['help'])), /usage/i)
  })

  test('save stores an observation and reports id and action', () => {
    const repo = makeRepo()
    const out = ok(saveJson(repo, { title: 'Chose SQLite', content: 'One db per repo', type: 'decision', topic_key: 'arch/db', session_id: 's1' }))
    assert.match(out, /saved #1 \(inserted\)/)
    assert.match(ok(saveJson(repo, { title: 'Chose SQLite v2', content: 'Still one db', type: 'decision', topic_key: 'arch/db' })), /saved #1 \(upserted\)/)
    const store = openMemory(repo)
    const row = store.get(1)
    assert.equal(row.title, 'Chose SQLite v2')
    assert.equal(row.session_id, 's1')
    store.close()
  })

  test('save reports a duplicate', () => {
    const repo = makeRepo()
    const body = { title: 'Same', content: 'same body', type: 'discovery' }
    ok(saveJson(repo, body))
    assert.match(ok(saveJson(repo, body)), /saved #1 \(deduplicated\)/)
  })

  test('save rejects invalid JSON, a missing title, and non-object JSON', () => {
    const repo = makeRepo()
    fails(cli(repo, ['save'], '{nope'), /invalid json/i)
    fails(cli(repo, ['save'], JSON.stringify({ content: 'x' })), /title is required/)
    fails(cli(repo, ['save'], '[1]'), /json object/i)
    fails(cli(repo, ['save'], ''), /invalid json|json object/i)
  })

  test('search prints one line per hit with id, type, title, topic_key, and preview', () => {
    const repo = makeRepo()
    ok(saveJson(repo, { title: 'Webhook retries', content: 'Retries use exponential backoff', type: 'decision', topic_key: 'infra/webhooks' }))
    ok(saveJson(repo, { title: 'Other thing', content: 'Unrelated text', type: 'discovery' }))
    const out = ok(cli(repo, ['search', 'backoff']))
    const lines = out.trim().split('\n')
    assert.equal(lines.length, 1)
    assert.match(lines[0], /#1/)
    assert.match(lines[0], /decision/)
    assert.match(lines[0], /Webhook retries/)
    assert.match(lines[0], /infra\/webhooks/)
    assert.match(lines[0], /exponential backoff/)
    assert.doesNotMatch(lines[0], /needs_review/)
  })

  test('search honors --type, --limit, and --any, and reports no hits', () => {
    const repo = makeRepo()
    ok(saveJson(repo, { title: 'alpha note', content: 'shared words here', type: 'decision' }))
    ok(saveJson(repo, { title: 'beta note', content: 'shared words there', type: 'discovery' }))
    assert.equal(ok(cli(repo, ['search', 'shared', '--type', 'discovery'])).trim().split('\n').length, 1)
    assert.match(ok(cli(repo, ['search', 'shared', '--type', 'discovery'])), /beta note/)
    assert.equal(ok(cli(repo, ['search', 'shared', '--limit', '1'])).trim().split('\n').length, 1)
    assert.match(ok(cli(repo, ['search', 'alpha zzzzzz'])), /no memories/i)
    assert.match(ok(cli(repo, ['search', 'alpha zzzzzz', '--any'])), /alpha note/)
  })

  test('search without a query fails', () => {
    fails(cli(makeRepo(), ['search']), /query/i)
  })

  test('search marks observations that need review', () => {
    const repo = makeRepo()
    ok(saveJson(repo, { title: 'Old preference', content: 'tabs not spaces', type: 'preference' }))
    age(repo)
    assert.match(ok(cli(repo, ['search', 'tabs'])), /needs_review/)
  })

  test('get prints the full observation and --history its versions', () => {
    const repo = makeRepo()
    const long = 'word '.repeat(200).trim()
    ok(saveJson(repo, { title: 'Long one', content: long, type: 'pattern', topic_key: 'a/b' }))
    const out = ok(cli(repo, ['get', '1']))
    assert.match(out, /Long one/)
    assert.match(out, /pattern/)
    assert.match(out, /a\/b/)
    assert.ok(out.includes(long))
    assert.doesNotMatch(out, /history|version/i)
    ok(saveJson(repo, { title: 'Long two', content: 'new body', type: 'pattern', topic_key: 'a/b' }))
    const hist = ok(cli(repo, ['get', '1', '--history']))
    assert.match(hist, /new body/)
    assert.match(hist, /history/i)
    assert.ok(hist.includes(long))
  })

  test('get, update, delete, and review done fail on an unknown or malformed id', () => {
    const repo = makeRepo()
    fails(cli(repo, ['get', '99']), /not found/)
    fails(cli(repo, ['update', '99'], JSON.stringify({ title: 'x' })), /not found/)
    fails(cli(repo, ['delete', '99']), /not found/)
    fails(cli(repo, ['review', 'done', '99']), /not found/)
    fails(cli(repo, ['get', 'abc']), /id/i)
    fails(cli(repo, ['get']), /id/i)
  })

  test('context prints exactly the store context', () => {
    const repo = makeRepo()
    assert.equal(ok(cli(repo, ['context'])), '')
    ok(saveJson(repo, { title: 'Remember me', content: 'body', type: 'decision' }))
    ok(cli(repo, ['summary', '--session', 's1'], '## Goal\nShip it'))
    const out = ok(cli(repo, ['context']))
    const store = openMemory(repo)
    assert.equal(out, store.context())
    store.close()
    assert.match(out, /Remember me/)
    assert.match(out, /Ship it/)
  })

  test('update patches fields and supports find/replace', () => {
    const repo = makeRepo()
    ok(saveJson(repo, { title: 'T', content: 'hello world', type: 'discovery' }))
    assert.match(ok(cli(repo, ['update', '1'], JSON.stringify({ title: 'T2', type: 'bugfix', topic_key: 'x/y' }))), /updated #1/)
    assert.match(ok(cli(repo, ['update', '1'], JSON.stringify({ find: 'world', replace: 'there' }))), /updated #1/)
    assert.match(ok(cli(repo, ['update', '1'], JSON.stringify({ content: 'brand new' }))), /updated #1/)
    assert.match(ok(cli(repo, ['update', '1'], JSON.stringify({ content: 'brand new' }))), /unchanged #1/)
    const out = ok(cli(repo, ['get', '1']))
    assert.match(out, /T2/)
    assert.match(out, /bugfix/)
    assert.match(out, /x\/y/)
    assert.match(out, /brand new/)
  })

  test('update rejects bad stdin and conflicting fields', () => {
    const repo = makeRepo()
    ok(saveJson(repo, { title: 'T', content: 'c' }))
    fails(cli(repo, ['update', '1'], 'nope'), /invalid json/i)
    fails(cli(repo, ['update', '1'], JSON.stringify({ content: 'a', find: 'b', replace: 'c' })), /not both/)
  })

  test('help documents delete --hard', () => {
    assert.match(cli(makeRepo(), ['help']).stdout, /delete <id> \[--hard\]/)
  })

  test('delete hides the observation from get and search', () => {
    const repo = makeRepo()
    ok(saveJson(repo, { title: 'Gone soon', content: 'ephemeral', type: 'discovery' }))
    assert.match(ok(cli(repo, ['delete', '1'])), /deleted #1/)
    fails(cli(repo, ['get', '1']), /not found/)
    assert.match(ok(cli(repo, ['search', 'ephemeral'])), /no memories/i)
  })

  test('delete --hard erases the observation and its history; plain delete is unchanged', () => {
    const repo = makeRepo()
    ok(saveJson(repo, { title: 'Leaky', content: 'the key is quokka42', type: 'discovery' }))
    ok(cli(repo, ['update', '1'], JSON.stringify({ content: 'rotated now' })))
    assert.equal(ok(cli(repo, ['delete', '1', '--hard'])), 'erased #1\n')
    fails(cli(repo, ['get', '1', '--history']), /not found/)
    assert.match(ok(cli(repo, ['search', 'quokka42'])), /no memories/i)
    fails(cli(repo, ['delete', '1', '--hard']), /observation #1 not found/)
    fails(cli(repo, ['delete', 'abc', '--hard']), /id/i)
    ok(saveJson(repo, { title: 'Soft', content: 'plain removal', type: 'discovery' }))
    assert.equal(ok(cli(repo, ['delete', '2'])), 'deleted #2\n')
    assert.equal(ok(cli(repo, ['delete', '2', '--hard'])), 'erased #2\n')
  })

  test('summary stores the summary and ends the session', () => {
    const repo = makeRepo()
    assert.match(ok(cli(repo, ['summary', '--session', 's9'], '## Goal\nDone')), /summary saved.*s9/i)
    const store = openMemory(repo)
    const row = new DatabaseSync(store.path).prepare('SELECT * FROM sessions WHERE id = ?').get('s9')
    store.close()
    assert.equal(row.summary, '## Goal\nDone')
    assert.ok(row.ended_at)
    fails(cli(repo, ['summary'], 'x'), /--session/)
    fails(cli(repo, ['summary', '--session', 's9'], '  \n'), /content/i)
  })

  test('summary redacts <private> text before storing it', () => {
    const repo = makeRepo()
    ok(cli(repo, ['summary', '--session', 's10'], 'Goal <private>secret</private> done'))
    const store = openMemory(repo)
    const row = new DatabaseSync(store.path).prepare('SELECT summary FROM sessions WHERE id = ?').get('s10')
    store.close()
    assert.equal(row.summary, 'Goal [REDACTED] done')
  })

  test('review list shows due observations and review done clears them', () => {
    const repo = makeRepo()
    ok(saveJson(repo, { title: 'Stale pref', content: 'old', type: 'preference' }))
    assert.match(ok(cli(repo, ['review', 'list'])), /nothing to review/i)
    age(repo)
    const list = ok(cli(repo, ['review', 'list']))
    assert.match(list, /#1/)
    assert.match(list, /Stale pref/)
    assert.match(ok(cli(repo, ['review', 'done', '1'])), /reviewed #1/)
    assert.match(ok(cli(repo, ['review', 'list'])), /nothing to review/i)
    fails(cli(repo, ['review']), /list|done/)
    fails(cli(repo, ['review', 'done']), /id/i)
  })

  test('an unknown command fails with one line', () => {
    fails(cli(makeRepo(), ['frobnicate']), /unknown command.*frobnicate/i)
  })

  test('an unknown option fails with one line', () => {
    fails(cli(makeRepo(), ['search', 'x', '--bogus']), /bogus/)
  })

  test('outside a git repository every store command says memory is off', () => {
    const dir = scratchDir('cli-nogit-')
    for (const [args, input] of [[['context'], ''], [['search', 'x'], ''], [['get', '1'], ''], [['save'], '{"title":"a","content":"b"}'], [['review', 'list'], '']]) {
      fails(cli(dir, args, input), /memory is off/i)
    }
  })

  test('prompts lists newest first, one line each, and prompts delete removes one', () => {
    const repo = makeRepo()
    assert.equal(ok(cli(repo, ['prompts'])), 'no prompts stored\n')
    const store = openMemory(repo)
    store.addPrompt('s1', 'first prompt')
    store.addPrompt('s1', `line one\n\n  line two ${'x'.repeat(200)}`)
    store.addPrompt('s1', `${'😀'.repeat(130)}`)
    store.close()
    const lines = ok(cli(repo, ['prompts'])).trimEnd().split('\n')
    assert.equal(lines.length, 3)
    assert.match(lines[0], /^#3 \d{4}-\d\d-\d\dT\S+ 😀+$/u)
    assert.equal([...lines[0].split(' ')[2]].length, 120)
    assert.match(lines[1], /^#2 \S+ line one line two x+$/)
    assert.equal([...lines[1].split(' ').slice(2).join(' ')].length, 120)
    assert.match(lines[2], /^#1 \S+ first prompt$/)
    assert.equal(ok(cli(repo, ['prompts', '--limit', '1'])).trimEnd().split('\n').length, 1)
    assert.equal(ok(cli(repo, ['prompts', 'delete', '2'])), 'deleted prompt #2\n')
    assert.deepEqual(ok(cli(repo, ['prompts'])).trimEnd().split('\n').map((l) => l.split(' ')[0]), ['#3', '#1'])
    fails(cli(repo, ['prompts', 'delete', '2']), /prompt #2 not found/)
    fails(cli(repo, ['prompts', 'delete', 'abc']), /a prompt id \(a number\) is required/)
    fails(cli(repo, ['prompts', 'delete']), /a prompt id \(a number\) is required/)
    fails(cli(repo, ['prompts', 'frob']), /prompts needs/)
  })

  test('without node:sqlite a store command fails with one line and help still works', () => {
    const dir = scratchDir('cli-nosqlite-')
    const hooks = join(dir, 'hooks.mjs')
    const preload = join(dir, 'preload.mjs')
    writeFileSync(hooks, "export async function resolve(s, c, next) { if (s === 'node:sqlite') throw new Error('no sqlite'); return next(s, c) }\n")
    writeFileSync(preload, `import { register } from 'node:module'\nregister(${JSON.stringify(`file://${hooks}`)})\n`)
    const run = (args) => spawnSync('node', ['--no-deprecation', '--import', preload, BIN, ...args], { cwd: makeRepo(), encoding: 'utf8' })
    const r = run(['context'])
    assert.equal(r.status, 1)
    assert.equal(r.stdout, '')
    assert.equal(r.stderr, 'construct-memory: memory needs node:sqlite with FTS5 (Node.js 22.16 or later; Node 23 is not supported)\n')
    const help = run(['help'])
    assert.equal(help.status, 0, help.stderr)
    assert.match(help.stdout, /usage: construct-memory/)
    fails(run(['frobnicate']), /unknown command/)
  })

  // S21 d: install.sh pre-approves `construct-memory <command> *` prefixes, so no trailing words or options may turn
  // an approved command into a destructive one. The installer test checks the rules; this checks what they can reach.
  test('a pre-approved prefix plus a destructive suffix is refused and changes nothing', () => {
    const repo = makeRepo()
    saveJson(repo, { title: 'One', content: 'first memory' })
    saveJson(repo, { title: 'Two', content: 'second memory' })
    const store = openMemory(repo)
    store.addPrompt('s1', 'first prompt')
    store.addPrompt('s1', 'second prompt')
    store.close()
    age(repo)
    const counts = () => {
      const s = JSON.parse(ok(cli(repo, ['stats', '--json'])))
      return { observations: s.observations, deleted: s.deleted, prompts: s.prompts, needing_review: s.needing_review, pinned: s.pinned }
    }
    const before = counts()
    const refused = [
      // a destructive positional behind an option that a prefix allows
      ['prompts', '--search', 'x', 'delete', '1'],
      ['prompts', '--limit', '5', 'delete', '1'],
      ['prompts', '--search', 'prompt', '--', 'delete', '1'],
      ['prompts', 'delete', '1', '--search', 'x'],
      ['prompts', 'delete', '1', '--limit', '5'],
      ['prompts', 'delete', '1', '2'],
      ['prompts', '--search', 'x', 'extra'],
      ['prompts', '--limit', '5', 'extra'],
      // delete only in its exact shape
      ['delete', '1', '--limit', '5'],
      ['delete', '1', '--search', 'x'],
      ['delete', '1', '--hard', '--json'],
      ['delete', '1', '2'],
      ['delete', '1', '2', '--hard'],
      // review: list takes nothing, done takes one id and nothing else
      ['review', 'list', 'done', '1'],
      ['review', 'list', '--limit', '5'],
      ['review', 'list', '--hard'],
      ['review', 'done', '1', '--hard'],
      ['review', 'done', '1', '2'],
      // --hard and other options that parseArgs accepts everywhere, on commands that never use them
      ['get', '1', '--hard'],
      ['get', '1', '--limit', '3'],
      ['pin', '1', '--hard'],
      ['unpin', '1', '--hard'],
      ['timeline', '1', '--hard'],
      ['context', '--hard'],
      ['doctor', '--hard'],
      ['stats', '--hard'],
      ['search', 'x', '--hard'],
      ['update', '1', '--hard'],
      ['save', '--hard'],
      ['summary', '--session', 's', '--hard'],
      ['suggest-topic-key', '--hard'],
      ['judge', 'j', 'related', '--hard'],
      ['judge-many', '--hard'],
      ['compare', '1', '2', 'related', '--confidence', '1', '--hard'],
      // the other destructive commands, reached through options of a pre-approved one
      ['get', '1', '--confirm', 'x'],
      ['stats', '--confirm', 'x'],
      ['search', 'x', '--confirm', 'x'],
      ['import', 'f.json', '--hard'],
      ['export', 'f.json', '--hard'],
      ['consolidate', '1', '2', '--title', 'T', '--hard'],
    ]
    for (const args of refused) {
      const r = cli(repo, args, '{}')
      assert.equal(r.status, 1, `${args.join(' ')}: ${r.stdout}`)
      assert.equal(r.stdout, '', args.join(' '))
      assert.equal(r.stderr.trim().split('\n').length, 1, `${args.join(' ')}: one line on stderr`)
      assert.deepEqual(counts(), before, args.join(' '))
    }
    // free text after a search is a query, not a command
    assert.match(ok(cli(repo, ['search', 'delete', '1'])), /no memories found|#/)
    assert.deepEqual(counts(), before)
    // the exact shapes still work
    assert.equal(ok(cli(repo, ['prompts', '--limit', '1'])).trimEnd().split('\n').length, 1)
    assert.match(ok(cli(repo, ['prompts', '--search', 'first'])), /first prompt/)
    assert.equal(ok(cli(repo, ['prompts', 'delete', '1'])), 'deleted prompt #1\n')
    assert.equal(ok(cli(repo, ['delete', '1', '--hard'])), 'erased #1\n')
    assert.equal(ok(cli(repo, ['review', 'done', '2'])), 'reviewed #2\n')
  })
})

describe('access counter and passive review (S3, S4 of odd/tasks/memory-maintenance.md)', () => {
  const setCreated = (repo, id, daysAgo) => {
    const store = openMemory(repo)
    const db = new DatabaseSync(store.path)
    db.prepare('UPDATE observations SET created_at = ? WHERE id = ?').run(new Date(Date.now() - daysAgo * 86400000 - 60000).toISOString(), id)
    db.close()
    store.close()
  }
  const passiveRow = (repo, title) => {
    const store = openMemory(repo)
    const { id } = store.save({ title, content: `${title} body`, type: 'passive' })
    store.close()
    return id
  }

  test('get prints an accessed line that counts each read', () => {
    const repo = makeRepo()
    saveJson(repo, { title: 'One', content: 'first memory' })
    assert.match(ok(cli(repo, ['get', '1'])), /\naccessed: 1\n/)
    assert.match(ok(cli(repo, ['get', '1'])), /\naccessed: 2\n/)
    assert.match(ok(cli(repo, ['get', '1', '--history'])), /\naccessed: 3\n/)
    fails(cli(repo, ['get', '9']), /observation #9 not found/)
  })

  test('review passive lists unread passive rows at least N days old, oldest first, as hit lines', () => {
    const repo = makeRepo()
    const young = passiveRow(repo, 'young learning')
    const exact = passiveRow(repo, 'exact learning')
    const oldest = passiveRow(repo, 'oldest learning')
    const read = passiveRow(repo, 'read learning')
    const gone = passiveRow(repo, 'gone learning')
    saveJson(repo, { title: 'agent decision', content: 'x', type: 'decision' })
    setCreated(repo, young, 5)
    setCreated(repo, exact, 30)
    setCreated(repo, oldest, 60)
    setCreated(repo, read, 90)
    setCreated(repo, gone, 90)
    setCreated(repo, 6, 90)
    ok(cli(repo, ['get', String(read)]))
    ok(cli(repo, ['delete', String(gone)]))
    const out = ok(cli(repo, ['review', 'passive']))
    assert.deepEqual(out.trim().split('\n'), [`#${oldest} [passive] oldest learning - oldest learning body`, `#${exact} [passive] exact learning - exact learning body`])
    assert.deepEqual(ok(cli(repo, ['review', 'passive', '--days', '5'])).trim().split('\n').map((l) => l.split(' ')[0]), [`#${oldest}`, `#${exact}`, `#${young}`])
    assert.deepEqual(JSON.parse(ok(cli(repo, ['review', 'passive', '--days', '50', '--json']))).map((r) => r.id), [oldest])
    assert.equal(ok(cli(repo, ['review', 'passive', '--days', '100'])), 'no passive rows to review\n')
  })

  test('review passive --days rejects anything but a positive whole number and changes nothing', () => {
    const repo = makeRepo()
    passiveRow(repo, 'some learning')
    const dump = () => JSON.stringify(JSON.parse(ok(cli(repo, ['export']))).observations)
    const before = dump()
    for (const days of ['0', '=-1', '1.5', 'abc']) fails(cli(repo, days.startsWith('=') ? ['review', 'passive', `--days${days}`] : ['review', 'passive', '--days', days]), /^construct-memory: review passive --days needs a positive whole number$/m)
    assert.equal(cli(repo, ['review', 'passive', '--days', '-1']).status, 1)
    fails(cli(repo, ['review', 'passive', 'extra']), /review passive takes only --days and --json/)
    fails(cli(repo, ['review', 'stale', '--days', '3']), /review stale does not take --days/)
    fails(cli(repo, ['review', 'list', '--days', '3']), /review list does not take --days/)
    fails(cli(repo, ['search', 'x', '--days', '3']), /search does not take --days/)
    assert.equal(dump(), before)
    assert.match(cli(repo, ['help']).stdout, /review passive \[--days N\] \[--json\]/)
  })
})
