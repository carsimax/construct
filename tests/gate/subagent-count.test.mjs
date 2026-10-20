// Stop gates wait for running subagents (S3): subagent-count.mjs start|stop keeps a
// per-session record of open agents; review-gate.mjs and risk-line.mjs check stay
// silent while one is open and run as today afterwards.
import { after, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, readdirSync, readFileSync, rmSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { applyFiles, highRepo, makeRepo, scratchDir } from '../review/helpers.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const COUNT = join(PLUGIN, 'hooks/scripts/subagent-count.mjs')
const GATE = join(PLUGIN, 'hooks/scripts/review-gate.mjs')
const RISK = join(PLUGIN, 'hooks/scripts/risk-line.mjs')

const scratch = []
const envOf = () => {
  const e = { CLAUDE_PLUGIN_DATA: scratchDir('odd-count-data-'), XDG_CONFIG_HOME: scratchDir('odd-count-xdg-') }
  scratch.push(e.CLAUDE_PLUGIN_DATA, e.XDG_CONFIG_HOME)
  return e
}
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})
const hookEnv = (e) => ({ ...process.env, ...e })

function count(mode, e, input) {
  return spawnSync('node', [COUNT, mode], { input: JSON.stringify(input), encoding: 'utf8', env: hookEnv(e) })
}
const startAgent = (e, id, session = 's1') => count('start', e, { session_id: session, hook_event_name: 'SubagentStart', agent_id: id, agent_type: 'construct:odd-worker' })
const stopAgent = (e, id, session = 's1') => count('stop', e, { session_id: session, hook_event_name: 'SubagentStop', agent_id: id, agent_type: 'construct:odd-worker' })
const agentDir = (e, session = 's1') => join(e.CLAUDE_PLUGIN_DATA, 'subagent-count', session)
const openIds = (e, session = 's1') => (existsSync(agentDir(e, session)) ? readdirSync(agentDir(e, session)).filter((n) => !n.startsWith('.')) : [])

function gate(cwd, e, session = 's1') {
  const r = spawnSync('node', [GATE], { input: JSON.stringify({ session_id: session, cwd, stop_hook_active: false }), encoding: 'utf8', env: hookEnv(e) })
  return { status: r.status, stdout: r.stdout, json: r.stdout ? JSON.parse(r.stdout) : null }
}
const risk = (mode, cwd, e, session = 's1', message = 'Done.') => {
  const r = spawnSync('node', [RISK, mode], { input: JSON.stringify({ session_id: session, cwd, stop_hook_active: false, last_assistant_message: message }), encoding: 'utf8', env: hookEnv(e) })
  return { status: r.status, stdout: r.stdout, json: r.stdout ? JSON.parse(r.stdout) : null }
}
const silent = (r) => {
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
}

describe('subagent-count hook', () => {
  test('start records the agent id, stop removes it, both print nothing and exit 0', () => {
    const e = envOf()
    silent(startAgent(e, 'a1'))
    assert.deepEqual(openIds(e), ['a1'])
    silent(stopAgent(e, 'a1'))
    assert.deepEqual(openIds(e), [])
  })

  test('garbage input, unknown mode, and a stop without a start fail open', () => {
    const e = envOf()
    silent(spawnSync('node', [COUNT, 'start'], { input: 'not json', encoding: 'utf8', env: hookEnv(e) }))
    silent(spawnSync('node', [COUNT, 'bogus'], { input: '{}', encoding: 'utf8', env: hookEnv(e) }))
    silent(stopAgent(e, 'never-started'))
  })

  test('without an agent id, a start is closed by a later stop', () => {
    const e = envOf()
    silent(count('start', e, { session_id: 's1' }))
    assert.equal(openIds(e).length, 1)
    silent(count('stop', e, { session_id: 's1' }))
    assert.equal(openIds(e).length, 0)
  })

  test('a start without an agent id is closed by a stop that carries one', () => {
    const e = envOf()
    silent(count('start', e, { session_id: 's1' }))
    assert.equal(openIds(e).length, 1)
    silent(stopAgent(e, 'a1'))
    assert.equal(openIds(e).length, 0)
  })

  test('a stop for an id with a file removes only that file', () => {
    const e = envOf()
    count('start', e, { session_id: 's1' })
    startAgent(e, 'a1')
    stopAgent(e, 'a1')
    assert.equal(openIds(e).length, 1, 'the anonymous entry stays')
  })

  test('many concurrent starts and stops leave a consistent record', async () => {
    const e = envOf()
    const run = (mode, id) =>
      new Promise((resolve) => {
        const child = spawn('node', [COUNT, mode], { env: hookEnv(e), stdio: ['pipe', 'ignore', 'ignore'] })
        child.on('close', resolve)
        child.stdin.end(JSON.stringify({ session_id: 's1', agent_id: id }))
      })
    const ids = Array.from({ length: 24 }, (_, i) => `agent${i}`)
    await Promise.all(ids.map((id) => run('start', id)))
    assert.deepEqual(openIds(e).sort(), [...ids].sort())
    await Promise.all(ids.map((id, i) => (i % 2 === 0 ? run('stop', id) : null)))
    assert.deepEqual(openIds(e).sort(), ids.filter((_, i) => i % 2 === 1).sort())
    await Promise.all(ids.map((id, i) => (i % 2 === 1 ? run('stop', id) : null)))
    assert.deepEqual(openIds(e), [])
  })
})

describe('review gate waits for subagents', () => {
  test('silent while an agent is open, blocks after the matching stop', () => {
    const e = envOf()
    const repo = highRepo()
    startAgent(e, 'a1')
    silent(gate(repo, e))
    applyFiles(repo, { 'scripts/more.sh': 'echo more\n' })
    silent(gate(repo, e))
    assert.equal(existsSync(join(e.CLAUDE_PLUGIN_DATA, 'review-gate')), false, 'no reminder recorded while waiting')
    stopAgent(e, 'a1')
    assert.equal(gate(repo, e).json.decision, 'block')
  })

  test('an entry older than the idle bound is ignored', () => {
    const e = envOf()
    const repo = highRepo()
    startAgent(e, 'a1')
    const old = new Date(Date.now() - 2 * 3600 * 1000)
    utimesSync(join(agentDir(e), 'a1'), old, old)
    assert.equal(gate(repo, e).json.decision, 'block')
  })

  test('another session open agent does not silence this session', () => {
    const e = envOf()
    const repo = highRepo()
    startAgent(e, 'a1', 'other')
    assert.equal(gate(repo, e).json.decision, 'block')
  })

  test('an entry aged 59 minutes still silences the gate, one aged 61 minutes does not', () => {
    const e = envOf()
    const repo = highRepo()
    startAgent(e, 'a1')
    const age = (minutes) => {
      const at = new Date(Date.now() - minutes * 60 * 1000)
      utimesSync(join(agentDir(e), 'a1'), at, at)
    }
    age(59)
    silent(gate(repo, e))
    age(61)
    assert.equal(gate(repo, e).json.decision, 'block')
  })

  test('an unreadable state directory fails open to the gate running as today', (t) => {
    if (process.getuid?.() === 0) return t.skip('root ignores directory permissions')
    const e = envOf()
    const repo = highRepo()
    startAgent(e, 'a1')
    chmodSync(agentDir(e), 0o000)
    try {
      assert.equal(gate(repo, e).json.decision, 'block')
    } finally {
      chmodSync(agentDir(e), 0o755)
    }
  })
})

describe('risk line check waits for subagents', () => {
  const changed = () => {
    const repo = makeRepo({ 'src/a.js': 'export const a = 1\n' })
    const e = envOf()
    silent(risk('mark', repo, e))
    applyFiles(repo, { 'src/a.js': 'export const a = 2\n' })
    return { repo, e }
  }

  test('silent while an agent is open, blocks after the matching stop', () => {
    const { repo, e } = changed()
    startAgent(e, 'a1')
    silent(risk('check', repo, e))
    silent(risk('check', repo, e))
    stopAgent(e, 'a1')
    assert.equal(risk('check', repo, e).json.decision, 'block')
  })

  test('an entry older than the idle bound is ignored', () => {
    const { repo, e } = changed()
    startAgent(e, 'a1')
    const old = new Date(Date.now() - 2 * 3600 * 1000)
    utimesSync(join(agentDir(e), 'a1'), old, old)
    assert.equal(risk('check', repo, e).json.decision, 'block')
  })

  test('another session open agent does not silence this session', () => {
    const { repo, e } = changed()
    startAgent(e, 'a1', 'other')
    assert.equal(risk('check', repo, e).json.decision, 'block')
  })
})

describe('registration', () => {
  test('the contract hook stays the first SubagentStart hook, ahead of the counter', () => {
    const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks/hooks.json'), 'utf8')).hooks
    const first = hooks.SubagentStart[0].hooks[0]
    assert.equal(first.command, 'node')
    assert.deepEqual(first.args, ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/contract.mjs', 'subagent'])
  })

  test('hooks.json registers start and stop in exec form for all agents', () => {
    const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks/hooks.json'), 'utf8')).hooks
    const script = '${CLAUDE_PLUGIN_ROOT}/hooks/scripts/subagent-count.mjs'
    for (const [event, mode] of [['SubagentStart', 'start'], ['SubagentStop', 'stop']]) {
      const group = hooks[event].find((g) => g.hooks.some((h) => h.args?.[0] === script))
      assert.ok(group, event)
      assert.equal(group.matcher, undefined, 'all agents')
      assert.deepEqual(group.hooks.find((h) => h.args?.[0] === script), { type: 'command', command: 'node', args: [script, mode], timeout: 10 })
    }
  })
})
