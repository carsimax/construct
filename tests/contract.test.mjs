import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const pluginRoot = new URL('../plugins/construct/', import.meta.url).pathname
const script = join(pluginRoot, 'hooks/scripts/contract.mjs')

function run(kind, input, extraEnv = {}) {
  const base = { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot }
  const res = spawnSync(process.execPath, [script, kind], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: { ...base, ...extraEnv },
  })
  return { code: res.status, stdout: res.stdout, stderr: res.stderr }
}

function context(kind, input, extraEnv) {
  const { code, stdout } = run(kind, input, extraEnv)
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
    'construct:explorer',
    'construct:worker',
    'construct:verifier',
    'construct:general',
    'construct:workflow',
    'construct:delegation',
    'construct:memory',
    'construct-memory',
    'construct:review',
    'Review subject:',
    'review is mandatory',
  ]) {
    assert.ok(text.toLowerCase().includes(anchor.toLowerCase()), `missing ${anchor}`)
  }
})

test('the session contract scales autonomy to the verifier and closes with checks and the Risk line', () => {
  const text = context('session', SESSION).additionalContext
  const flat = text.replace(/\s+/g, ' ')
  assert.match(flat, /autonomy matches the (strength of the )?verifier, not confidence/i)
  assert.match(flat, /strong verifier[^.]*loop until it passes/i)
  assert.match(flat, /weak verifier[^.]*one small step[^.]*stop/i)
  assert.match(flat, /docs-only[^.]*reviewed diff is the verifier/i)
  const close = text.match(/^8\. Close\..*$/m)?.[0]
  assert.ok(close, 'step 8 Close line not found')
  assert.match(close, /skipped|unverified/i)
  assert.match(close, /Risk line/)
  assert.ok(text.includes('Risk: item N (reason)') && text.includes('Risk: none'))
})

test('small work is inline up to inline_edit_max_lines and bigger edits go to the worker (S5)', () => {
  const text = context('session', SESSION).additionalContext
  assert.ok(text.includes('Small work is done inline: each edit call changes up to `inline_edit_max_lines` (20) lines'))
  assert.ok(text.includes('Large work writes through `construct:worker`'))
  assert.ok(!text.includes('routing defect'))
  const delegation = readFileSync(join(pluginRoot, 'skills/delegation/SKILL.md'), 'utf8')
  assert.ok(delegation.includes('Small work is done inline'))
  assert.ok(!delegation.includes('Every write to repository code, tests, or docs goes to `construct:worker`'))
  const sizing = readFileSync(join(pluginRoot, 'skills/workflow/SKILL.md'), 'utf8')
  assert.match(sizing, /- Small: done inline \(edit calls up to `inline_edit_max_lines` lines/)
  const grader = readFileSync(join(pluginRoot, 'evals/small-inline/graders/no-delegation.md'), 'utf8')
  assert.match(grader, /tool: Agent\nmax: 0/)
  assert.doesNotMatch(grader, /arm: both/)
  const option = JSON.parse(readFileSync(join(pluginRoot, '.claude-plugin/plugin.json'), 'utf8')).userConfig.inline_edit_max_lines
  assert.equal(option.type, 'number')
  assert.equal(option.default, 20)
})

test('SubagentStart gives worker agents the subagent contract', () => {
  for (const agent of ['construct:worker', 'construct:explorer', 'general-purpose']) {
    const out = context('subagent', { hook_event_name: 'SubagentStart', agent_type: agent })
    assert.equal(out.hookEventName, 'SubagentStart')
    assert.ok(out.additionalContext.includes('## Key Learnings'), agent)
    assert.ok(out.additionalContext.includes('English'), agent)
    assert.ok(out.additionalContext.length <= 3000)
  }
})

test('SubagentStart carries the S2 engineering rules for writers', () => {
  const text = context('subagent', { hook_event_name: 'SubagentStart', agent_type: 'construct:worker' }).additionalContext
  assert.match(text, /never weaken a verifier/i)
  assert.match(text, /Silencing an error, widening a type, skipping a test, or dropping an assertion/)
  assert.match(text, /root cause/i)
  assert.match(text, /reproduce a bug before/i)
  assert.match(text, /skip it.*reuse what the codebase has.*standard library or platform.*installed dependency.*minimal new code/s)
  assert.match(text, /never add a dependency for a few lines/i)
  assert.match(text, /match the code around you/i)
  assert.ok(text.includes('`shortcut: <the limit>, <when to upgrade>`'))
  assert.match(text, /review your own diff as if someone else wrote it/i)
  assert.match(text, /missing test is a finding/i)
  assert.match(text, /finish every caller, test, and fixture/i)
  assert.match(text, /brevity means easy to read/i)
  assert.match(text, /two options are the same size.*handling edge cases correctly/i)
  assert.match(text, /never ship code .*explain.*line by line/i)
  assert.ok(text.length <= 3000, `length ${text.length}`)
})

test('SubagentStart injects nothing into agents that must return a single JSON object', () => {
  for (const agent of ['construct:review-risk', 'construct:judge-a', 'construct:judge-b', 'review-risk', 'judge-b']) {
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
  const contract = session.find((e) => e.hooks[0].args?.[0]?.endsWith('contract.mjs'))
  assert.equal(contract.matcher, 'startup|resume|clear|compact')
  assert.equal(contract.hooks[0].command, 'node')
  assert.deepEqual(contract.hooks[0].args, ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/contract.mjs', 'session'])
  const sub = hooks.hooks.SubagentStart
  assert.deepEqual(sub[0].hooks[0].args, ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/contract.mjs', 'subagent'])
})

test('every construct component a contract names exists in the plugin', () => {
  const agents = new Set(readdirSync(join(pluginRoot, 'agents')).map((f) => f.replace(/\.md$/, '')))
  for (const kind of ['session', 'subagent']) {
    const text = readFileSync(join(pluginRoot, `hooks/contract/${kind}.md`), 'utf8')
    for (const [, name] of text.matchAll(/construct:([a-z0-9-]+)/g)) {
      const exists = agents.has(name) || existsSync(join(pluginRoot, 'skills', name, 'SKILL.md'))
      assert.ok(exists, `${kind} contract names missing construct:${name}`)
    }
    assert.doesNotMatch(text, /gentle[-_ ]?ai/i)
  }
})

test('stdin that parses to a non-object (null, array, number, string) is treated as {}', () => {
  for (const kind of ['session', 'subagent']) {
    const expected = context(kind, {}).additionalContext
    for (const raw of ['null', '[]', '[1]', '42', '"x"', 'true']) {
      const res = run(kind, raw)
      assert.equal(res.code, 0, `${kind} ${raw}: ${res.stderr}`)
      assert.equal(JSON.parse(res.stdout).hookSpecificOutput.additionalContext.startsWith(expected.slice(0, 200)), true)
      if (kind === 'subagent') assert.equal(JSON.parse(res.stdout).hookSpecificOutput.additionalContext, expected)
    }
  }
})

test('the contracts never mention codegraph and the subagent contract names LSP', () => {
  const session = context('session', SESSION).additionalContext
  const subagent = context('subagent', { hook_event_name: 'SubagentStart', agent_type: 'construct:worker' }).additionalContext
  assert.doesNotMatch(session, /codegraph/i)
  assert.doesNotMatch(subagent, /codegraph/i)
  assert.match(subagent, /\bLSP\b/)
})

test('S4: the subagent contract finishes the asked work, adds nothing unasked, and rejects a syntax-only check', () => {
  const text = context('subagent', { hook_event_name: 'SubagentStart', agent_type: 'construct:worker' }).additionalContext
  assert.match(text, /a syntax-only check is not enough/)
  assert.match(text, /runnable, buildable, or type-checkable/)
  assert.match(text, /If no check can run, state which and why/)
  assert.match(text, /until the prompt's whole request is done/i)
  assert.match(text, /nothing the prompt did not request: no features, tests, files, docs, or refactors/i)
  assert.match(text, /name (it|such work) in your report instead of doing it/i)
})

test('S5: the session contract names the text-only progress report as an early stop', () => {
  const flat = context('session', SESSION).additionalContext.replace(/\s+/g, ' ')
  assert.match(flat, /text-only progress report[^.]*"Next, I'll[^.]*"Shall I apply this\?"[^.]*not a stop/i)
  assert.match(flat, /completion notifications/i)
})

test('the subagent contract keeps HOME, TMPDIR, and tool caches outside the worktree', () => {
  const text = context('subagent', { hook_event_name: 'SubagentStart' }).additionalContext
  assert.match(text, /`HOME`, `TMPDIR`, and tool caches, lives in a `mktemp -d` directory outside the worktree/i)
})
