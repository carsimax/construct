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
      for (const word of ['save', 'search', 'get', 'context', 'update', 'delete', 'summary', 'review', 'import', 'prompts']) assert.match(out, new RegExp(word))
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

  test('delete hides the observation from get and search', () => {
    const repo = makeRepo()
    ok(saveJson(repo, { title: 'Gone soon', content: 'ephemeral', type: 'discovery' }))
    assert.match(ok(cli(repo, ['delete', '1'])), /deleted #1/)
    fails(cli(repo, ['get', '1']), /not found/)
    assert.match(ok(cli(repo, ['search', 'ephemeral'])), /no memories/i)
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
})
