import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const pluginRoot = new URL('../plugins/odd-skills/', import.meta.url).pathname
const script = join(pluginRoot, 'hooks/scripts/contract.mjs')

function run(kind, input) {
  const res = spawnSync('node', [script, kind], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
  })
  return { code: res.status, stdout: res.stdout, stderr: res.stderr }
}

function context(kind, input) {
  const { code, stdout } = run(kind, input)
  assert.equal(code, 0)
  const out = JSON.parse(stdout)
  return out.hookSpecificOutput
}

const SESSION = { hook_event_name: 'SessionStart', source: 'startup' }

test('SessionStart emits the session contract as additionalContext within 8000 characters', () => {
  const out = context('session', SESSION)
  assert.equal(out.hookEventName, 'SessionStart')
  assert.ok(out.additionalContext.length > 2000)
  assert.ok(out.additionalContext.length <= 8000, `length ${out.additionalContext.length}`)
})

test('the session contract emits the same text after compaction and on malformed input', () => {
  const startup = context('session', SESSION).additionalContext
  assert.equal(context('session', { ...SESSION, source: 'compact' }).additionalContext, startup)
  assert.equal(context('session', 'not json').additionalContext, startup)
  assert.equal(context('session', '').additionalContext, startup)
})

test('the session contract carries the ODD protocol, task size, risk line, and delegation anchors', () => {
  const text = context('session', SESSION).additionalContext
  for (const anchor of [
    'Organic Driven Development',
    'odd/tasks/<feature>.md',
    'Risk: item',
    'Risk: none',
    'migrations',
    'auth',
    'public API',
    'concurrency',
    'installers',
    'no test would catch',
    'odd-skills:odd-explorer',
    'odd-skills:odd-worker',
    'odd-skills:odd-verify',
    'odd-skills:odd-general',
    'odd-skills:odd-workflow',
    'odd-skills:odd-delegation',
    'odd-skills:task-size-risk',
    'odd-skills:lossless-prompts',
    'odd-skills:rdd-review',
    'odd-review mode',
  ]) {
    assert.ok(text.toLowerCase().includes(anchor.toLowerCase()), `missing ${anchor}`)
  }
})

test('SubagentStart gives worker agents the subagent contract', () => {
  for (const agent of ['odd-skills:odd-worker', 'odd-skills:odd-explorer', 'general-purpose']) {
    const out = context('subagent', { hook_event_name: 'SubagentStart', agent_type: agent })
    assert.equal(out.hookEventName, 'SubagentStart')
    assert.ok(out.additionalContext.includes('## Key Learnings'), agent)
    assert.ok(out.additionalContext.includes('English'), agent)
    assert.ok(out.additionalContext.length <= 3000)
  }
})

test('SubagentStart injects nothing into agents that must return a single JSON object', () => {
  for (const agent of ['odd-skills:review-risk', 'odd-skills:review-refuter', 'odd-skills:review-validator', 'odd-skills:jd-judge-a', 'odd-skills:jd-judge-b', 'review-risk', 'jd-judge-b']) {
    const { code, stdout } = run('subagent', { hook_event_name: 'SubagentStart', agent_type: agent })
    assert.equal(code, 0, agent)
    assert.equal(stdout, '', agent)
  }
})

test('an unknown contract kind exits 0 without output', () => {
  const { code, stdout } = run('bogus', SESSION)
  assert.equal(code, 0)
  assert.equal(stdout, '')
})

test('hooks.json registers both contracts in exec form and keeps the mod module', () => {
  const hooks = JSON.parse(readFileSync(join(pluginRoot, 'hooks/hooks.json'), 'utf8'))
  assert.deepEqual(hooks.modules, ['./register.js'])
  const session = hooks.hooks.SessionStart
  assert.equal(session.length, 1)
  assert.equal(session[0].matcher, 'startup|resume|clear|compact')
  assert.equal(session[0].hooks[0].command, 'node')
  assert.deepEqual(session[0].hooks[0].args, ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/contract.mjs', 'session'])
  const sub = hooks.hooks.SubagentStart
  assert.deepEqual(sub[0].hooks[0].args, ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/contract.mjs', 'subagent'])
})

test('every odd-skills component a contract names exists in the plugin', () => {
  const agents = new Set(readdirSync(join(pluginRoot, 'agents')).map((f) => f.replace(/\.md$/, '')))
  for (const kind of ['session', 'subagent']) {
    const text = readFileSync(join(pluginRoot, `hooks/contract/${kind}.md`), 'utf8')
    for (const [, name] of text.matchAll(/odd-skills:([a-z0-9-]+)/g)) {
      const exists = agents.has(name) || existsSync(join(pluginRoot, 'skills', name, 'SKILL.md'))
      assert.ok(exists, `${kind} contract names missing odd-skills:${name}`)
    }
    assert.doesNotMatch(text, /gentle[-_ ]?ai/i)
  }
})
