// Workflow admission (odd/tasks/workflow-admission.md S1-S2), driven as the real hook: PreToolUse(Workflow)
// denies a script that could launch a writing agent, because a workflow's agent() never reaches PreToolUse(Agent).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { makeRepo, scratchDir, write } from '../helpers/repo.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const SCRIPT = join(PLUGIN, 'hooks/scripts/delegation-admission.mjs')
const ALLOWED = 'construct:explorer, construct:judge-a, construct:judge-b, construct:review-readability, construct:review-reliability, construct:review-resilience, construct:review-risk, Explore, Plan'
const reason = (problem) =>
  `A workflow may launch only read-only agents (${ALLOWED}); ${problem}. Writes go through construct:worker with the Agent tool, where edit surfaces are admitted.`

const META = "export const meta = { name: 'probe', description: 'probe' }\n"

function workflow(tool_input, { cwd = makeRepo(), home = scratchDir('odd-wf-home-') } = {}) {
  const r = spawnSync('node', [SCRIPT], {
    input: JSON.stringify({ session_id: 's1', cwd, hook_event_name: 'PreToolUse', tool_name: 'Workflow', tool_input }),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, CLAUDE_PLUGIN_DATA: scratchDir('odd-wf-data-') },
  })
  let json = null
  try {
    json = JSON.parse(r.stdout)
  } catch {
    // no output
  }
  return { status: r.status, stdout: r.stdout, decision: json?.hookSpecificOutput?.permissionDecision, reason: json?.hookSpecificOutput?.permissionDecisionReason }
}

const allowed = (r) => {
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
}
const denied = (r, problem) => {
  assert.equal(r.status, 0)
  assert.equal(r.decision, 'deny')
  assert.equal(r.reason, reason(problem))
}

describe('workflow script', () => {
  test('read-only agent types pass, with or without the construct: prefix', () => {
    for (const type of ['construct:explorer', 'explorer', 'construct:review-risk', 'review-reliability', 'construct:judge-a', 'judge-b', 'Explore', 'Plan']) {
      allowed(workflow({ script: `${META}const r = await agent('map it', { label: 'x', agentType: '${type}' })\nreturn r` }))
    }
    allowed(workflow({ script: `${META}return await pipeline(args, (f) => agent(\`audit \${f}\`, { agentType: "construct:explorer", schema: { type: 'object' } }))` }))
    allowed(workflow({ script: `${META}log('no agents')` }))
  })

  test('an agent() call without a literal agentType is denied, numbered in source order', () => {
    denied(workflow({ script: `${META}await agent('a', { agentType: 'Explore' })\nawait agent('b')` }), 'agent() call 2 has no literal agentType')
    denied(workflow({ script: `${META}await agent('a', { label: 'x' })` }), 'agent() call 1 has no literal agentType')
    denied(workflow({ script: `${META}const t = 'Explore'\nawait agent('a', { agentType: t })` }), 'agent() call 1 has no literal agentType')
    denied(workflow({ script: `${META}await agent('a', { agentType: \`Ex\${'plore'}\` })` }), 'agent() call 1 has no literal agentType')
  })

  test('a writing or unknown agent type is denied by name', () => {
    denied(workflow({ script: `${META}await agent('fix', { agentType: 'construct:worker' })` }), 'agent() call 1 names agentType "construct:worker"')
    denied(workflow({ script: `${META}await agent('run', { agentType: 'general-purpose' })` }), 'agent() call 1 names agentType "general-purpose"')
    denied(workflow({ script: `${META}await agent('v', { agentType: 'construct:verifier' })` }), 'agent() call 1 names agentType "construct:verifier"')
  })

  test('agent used other than as a direct call is denied with its line', () => {
    denied(workflow({ script: `${META}return pipeline(args, agent)` }), 'agent is used other than as a direct call (line 2)')
    denied(workflow({ script: `${META}const a = agent\nawait a('x')` }), 'agent is used other than as a direct call (line 2)')
  })

  test('the global object, a computed agent key, and dynamic code are denied', () => {
    denied(workflow({ script: `${META}await globalThis.agent('x', { agentType: 'construct:worker' })` }), 'the global object cannot be referenced (line 2)')
    denied(workflow({ script: `${META}await this.agent('x')` }), 'the global object cannot be referenced (line 2)')
    denied(workflow({ script: `${META}await globalThis['agent']('x')` }), 'the global object cannot be referenced (line 2)')
    denied(workflow({ script: `${META}\nawait eval("agent('x')")` }), 'dynamic code (eval or Function) cannot be admitted (line 3)')
    denied(workflow({ script: `${META}await new Function('return agent')()('x')` }), 'dynamic code (eval or Function) cannot be admitted (line 2)')
  })

  // Bypasses found probing the first version: each one launched a writer past the check.
  test('every agentType key counts, a spread in the options or a destructured agent is denied', () => {
    denied(workflow({ script: `${META}await agent('x', { agentType: 'Explore', agentType: 'construct:worker' })` }), 'agent() call 1 names agentType "construct:worker"')
    denied(workflow({ script: `${META}await agent({ agentType: 'Explore' }, { agentType: 'construct:worker' })` }), 'agent() call 1 names agentType "construct:worker"')
    denied(workflow({ script: `${META}const o = {}\nawait agent('x', { agentType: 'Explore', ...o })` }), 'agent() call 1 has no literal agentType')
    denied(workflow({ script: `${META}const { agent: a } = x\nawait a('x')` }), 'agent is used other than as a direct call (line 2)')
    denied(workflow({ script: `${META}await agent('x', { agentType: 'Explore', ['agentType']: 'construct:worker' })` }), 'agent() call 1 has no literal agentType')
    denied(workflow({ script: `${META}const k = 'agentType'\nawait agent('x', { agentType: 'Explore', [k]: 'construct:worker' })` }), 'agent() call 1 has no literal agentType')
    denied(workflow({ script: `${META}await agent('x', { agentType: 'Explore', "agentType": 'construct:worker' })` }), 'agent() call 1 has no literal agentType')
    allowed(workflow({ script: `${META}await agent('x', { agentType: 'Explore', schema: { type: 'object', required: ['files'] } })` }))
  })

  test('an escaped identifier, a regex literal, and a global object reference cannot hide a call', () => {
    denied(workflow({ script: `${META}await \\u0061gent('x')` }), 'an escape outside a string cannot be admitted (line 2)')
    denied(workflow({ script: `${META}const r = /\`/\nawait agent('x')` }), 'agent() call 1 has no literal agentType')
    denied(workflow({ script: `${META}const r = /[/]\`/g\nawait agent('x')` }), 'agent() call 1 has no literal agentType')
    denied(workflow({ script: `${META}await globalThis['ag' + 'ent']('x')` }), 'the global object cannot be referenced (line 2)')
    denied(workflow({ script: `${META}const g = globalThis\nawait g.agent('x')` }), 'the global object cannot be referenced (line 2)')
    allowed(workflow({ script: `${META}const half = 4 / 2 / 1\nconst o = { agent: 1 }\nawait agent(\`x\${half / 2}\`, { agentType: 'Explore' })` }))
  })

  test('strings, template text, comments, and properties are not calls; code inside ${} is', () => {
    allowed(
      workflow({
        script: `${META}// agent('x') in a comment\n/* agent() */\nconst s = 'agent(' + "agent()"\nlog(\`then call agent() now\`)\nconst o = { agent: 1, agentType: 'worker' }\no.agent\nfoo.agent('x')`,
      }),
    )
    denied(workflow({ script: `${META}log(\`\${await agent('x')}\`)` }), 'agent() call 1 has no literal agentType')
  })
})

describe('script source', () => {
  test('scriptPath is read relative to the cwd; an unreadable one is denied', () => {
    const repo = makeRepo()
    write(repo, 'wf/ok.js', `${META}await agent('a', { agentType: 'Explore' })`)
    write(repo, 'wf/bad.js', `${META}await agent('a')`)
    allowed(workflow({ scriptPath: 'wf/ok.js' }, { cwd: repo }))
    denied(workflow({ scriptPath: join(repo, 'wf/bad.js') }, { cwd: repo }), 'agent() call 1 has no literal agentType')
    denied(workflow({ scriptPath: 'wf/missing.js' }, { cwd: repo }), 'scriptPath "wf/missing.js" cannot be read')
  })

  test('scriptPath wins over script and name', () => {
    const repo = makeRepo()
    write(repo, 'wf/bad.js', `${META}await agent('a')`)
    denied(workflow({ scriptPath: 'wf/bad.js', script: `${META}log('x')`, name: 'probe' }, { cwd: repo }), 'agent() call 1 has no literal agentType')
  })

  test('a saved workflow is found by meta.name in the project, then in the home directory', () => {
    const repo = makeRepo()
    const home = scratchDir('odd-wf-home-')
    write(repo, '.claude/workflows/sweep.js', "export const meta = { name: 'sweep', description: 'd' }\nawait agent('a')")
    mkdirSync(join(home, '.claude', 'workflows'), { recursive: true })
    writeFileSync(join(home, '.claude', 'workflows', 'other.js'), "export const meta = {\n  name: \"triage\",\n  description: 'd',\n}\nawait agent('a', { agentType: 'construct:worker' })")
    denied(workflow({ name: 'sweep' }, { cwd: repo, home }), 'agent() call 1 has no literal agentType')
    denied(workflow({ name: 'triage' }, { cwd: repo, home }), 'agent() call 1 names agentType "construct:worker"')
  })

  test('a bundled workflow name and a bare resume pass; the stored files are untouched', () => {
    const repo = makeRepo()
    write(repo, '.claude/workflows/sweep.js', "export const meta = { name: 'sweep', description: 'd' }\nawait agent('a')")
    const before = readFileSync(join(repo, '.claude/workflows/sweep.js'), 'utf8')
    allowed(workflow({ name: 'deep-research', args: 'q' }, { cwd: repo }))
    allowed(workflow({ resumeFromRunId: 'run-1' }, { cwd: repo }))
    assert.equal(readFileSync(join(repo, '.claude/workflows/sweep.js'), 'utf8'), before)
  })

  test('unreadable hook input and a non-object tool_input fail open', () => {
    allowed(workflow('nope'))
    allowed(workflow(null))
  })
})

describe('registration', () => {
  test('hooks.json runs delegation-admission on PreToolUse Workflow in exec form', () => {
    const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks/hooks.json'), 'utf8')).hooks.PreToolUse
    const groups = hooks.filter((g) => g.matcher === 'Workflow')
    assert.equal(groups.length, 1)
    assert.deepEqual(groups[0].hooks, [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/delegation-admission.mjs'], timeout: 10 }])
  })
})
