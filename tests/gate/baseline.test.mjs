// S6: the session baseline. `review-gate.mjs baseline` at SessionStart records the
// review-due candidates that already exist; the Stop gate stays silent for them.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyFiles, commitAll, highRepo, review, scratchDir } from '../review/helpers.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const GATE = join(PLUGIN, 'hooks/scripts/review-gate.mjs')

const env = () => ({ CLAUDE_PLUGIN_DATA: scratchDir('odd-base-data-'), XDG_CONFIG_HOME: scratchDir('odd-base-xdg-') })

function run(mode, cwd, e, { session = 's1', event, input } = {}) {
  const result = spawnSync('node', [GATE, ...(mode ? [mode] : [])], {
    input: input ?? JSON.stringify({ session_id: session, cwd, hook_event_name: event ?? (mode ? 'SessionStart' : 'Stop'), stop_hook_active: false }),
    encoding: 'utf8',
    env: { ...process.env, ...e },
  })
  return { status: result.status, stdout: result.stdout, json: result.stdout ? JSON.parse(result.stdout) : null }
}

const file = (e, session = 's1') => join(e.CLAUDE_PLUGIN_DATA, 'review-gate', `${session}.json`)

describe('registration', () => {
  test('SessionStart runs the baseline in exec form, not on compact', () => {
    const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks/hooks.json'), 'utf8'))
    const entry = hooks.hooks.SessionStart.find((e) => e.hooks.some((h) => h.args.includes('baseline') || h.args.at(-1) === 'baseline'))
    assert.ok(entry, 'a SessionStart entry runs review-gate.mjs baseline')
    assert.deepEqual(entry.hooks[0], {
      type: 'command',
      command: 'node',
      args: ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/review-gate.mjs', 'baseline'],
      timeout: 30,
    })
    assert.ok(!entry.matcher.includes('compact'))
  })
})

describe('baseline', () => {
  test('records the due candidate silently; the Stop gate stays silent for it', () => {
    const e = env()
    const repo = highRepo()
    const start = run('baseline', repo, e)
    assert.equal(start.status, 0)
    assert.equal(start.stdout, '')
    assert.equal(JSON.parse(readFileSync(file(e), 'utf8')).baseline.length, 1)
    const stop = run(null, repo, e)
    assert.equal(stop.status, 0)
    assert.equal(stop.stdout, '', 'the candidate predates the session')
  })

  test('a candidate that is not the baseline still blocks', () => {
    const e = env()
    const repo = highRepo()
    run('baseline', repo, e)
    applyFiles(repo, { 'scripts/deploy.sh': 'echo deploy\n' })
    const stop = run(null, repo, e)
    assert.equal(stop.json.decision, 'block')
    assert.match(stop.json.reason, /Review due/)
    // The reminder is recorded without losing the baseline.
    const record = JSON.parse(readFileSync(file(e), 'utf8'))
    assert.equal(record.baseline.length, 1)
    assert.equal(record.targets.length, 1)
  })

  test('without a baseline the gate blocks as before', () => {
    const e = env()
    assert.equal(run(null, highRepo(), e).json.decision, 'block')
  })

  test('baselines are per session', () => {
    const e = env()
    const repo = highRepo()
    run('baseline', repo, e, { session: 'other' })
    assert.equal(run(null, repo, e, { session: 's1' }).json.decision, 'block')
  })

  test('a second baseline replaces the first and keeps the reminded targets', () => {
    const e = env()
    const repo = highRepo()
    run('baseline', repo, e)
    applyFiles(repo, { 'scripts/deploy.sh': 'echo deploy\n' })
    run(null, repo, e)
    const before = JSON.parse(readFileSync(file(e), 'utf8'))
    run('baseline', repo, e)
    const after = JSON.parse(readFileSync(file(e), 'utf8'))
    assert.deepEqual(after.targets, before.targets)
    assert.equal(after.baseline.length, 1)
    assert.notDeepEqual(after.baseline, before.baseline)
  })

  test('mode off, no repository, no commits, bad input: nothing recorded, no output', () => {
    const e = env()
    const repo = highRepo()
    review(repo, ['mode', 'disable'], { env: e })
    assert.equal(run('baseline', repo, e).stdout, '')
    assert.ok(!existsSync(file(e)))
    for (const cwd of [scratchDir('odd-base-norepo-')]) {
      const r = run('baseline', cwd, e)
      assert.deepEqual([r.status, r.stdout], [0, ''])
    }
    assert.deepEqual([run('baseline', repo, e, { input: 'not json' }).status, run('baseline', repo, e, { input: '' }).stdout], [0, ''])
  })

  test('a corrupt record fails open', () => {
    const e = env()
    const repo = highRepo()
    run('baseline', repo, e)
    writeFileSync(file(e), 'garbage')
    const r = run('baseline', repo, e)
    assert.deepEqual([r.status, r.stdout], [0, ''])
  })

  test('a repository with nothing due records an empty baseline', () => {
    const e = env()
    const repo = highRepo()
    commitAll(repo, 'commit it')
    run('baseline', repo, e)
    assert.deepEqual(JSON.parse(readFileSync(file(e), 'utf8')).baseline, [])
  })
})

describe('state pruning', () => {
  const DAY = 86400
  const age = (path, days) => {
    const t = Date.now() / 1000 - days * DAY
    utimesSync(path, t, t)
  }
  const seed = (e, rel, days) => {
    const path = join(e.CLAUDE_PLUGIN_DATA, rel)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, 'x')
    age(path, days)
    age(join(e.CLAUDE_PLUGIN_DATA, rel.split('/').slice(0, 2).join('/')), days) // the session directory itself
    return path
  }

  test('baseline removes this plugin\'s per-session state older than 7 days and nothing else', () => {
    const e = env()
    const repo = highRepo()
    const old = ['review-gate/old.json', 'risk-line/old.json', 'review-hooks/oldsess/construct_review-risk.review-0123456789abcdef.json', 'subagent-count/oldsess/a1', 'delegation-admission/oldsess/rec', 'delivery-signals/old.backstop', 'mirror-drift/old.json'].map((rel) => seed(e, rel, 8))
    const fresh = ['review-gate/fresh.json', 'risk-line/fresh.json', 'review-hooks/fresh/a.json'].map((rel) => seed(e, rel, 1))
    const foreign = [seed(e, 'other-plugin/old.json', 30), seed(e, 'root-old.txt', 30)]
    assert.equal(run('baseline', repo, e).status, 0)
    for (const path of [old[0], old[1], ...old.slice(4)]) assert.equal(existsSync(path), false, path)
    assert.equal(existsSync(join(e.CLAUDE_PLUGIN_DATA, 'review-hooks/oldsess')), false)
    assert.equal(existsSync(join(e.CLAUDE_PLUGIN_DATA, 'subagent-count/oldsess')), false)
    assert.equal(existsSync(join(e.CLAUDE_PLUGIN_DATA, 'delegation-admission/oldsess')), false)
    for (const path of [...fresh, ...foreign]) assert.equal(existsSync(path), true, path)
  })
})

describe('unreadable reminder file', () => {
  test('is treated as empty, so the gate still blocks', () => {
    const e = env()
    const repo = highRepo()
    mkdirSync(join(file(e), '..'), { recursive: true })
    writeFileSync(file(e), '{}')
    chmodSync(file(e), 0) // readFileSync throws EACCES
    assert.equal(run(null, repo, e).json?.decision, 'block')
  })
})
