// S1 of .vault/tasks/oracle-limits.md: a code task with no deterministic test is exempted by the user. command-guard allows
// `construct-gate oracle exempt <feature-doc> <T#> -- <surface>...` once, as the whole command in the main thread, right after the
// user answered `Exempt` to an AskUserQuestion that quotes those exact arguments; the CLI then records an envelope with the default
// budget and no test command, which delegation-admission accepts for a worker on code.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, test } from 'node:test'
import { DEFAULTS } from '../../plugins/construct/hooks/scripts/envelope.mjs'
import { readEnvelope } from '../../plugins/construct/hooks/scripts/review-store.mjs'
import { makeRepo, scratchDir } from '../helpers/repo.mjs'

const SCRIPTS = new URL('../../plugins/construct/hooks/scripts/', import.meta.url).pathname
const GATE = new URL('../../plugins/construct/bin/construct-gate', import.meta.url).pathname
const env = { ...process.env, CLAUDE_PLUGIN_DATA: scratchDir('exempt-data-') }
const DOC = '.vault/tasks/f.md'
const TABLE = '# F\n\n## Tasks\n\n| ID | Specs | Task | Route | Risk | Status | Commit |\n|---|---|---|---|---|---|---|\n| T1 | S1 | Installer | worker | 5 | open | - |\n| T2 | S1 | Other | worker | 5 | open | - |\n\n## Log\n'
const fresh = () => makeRepo({ [DOC]: TABLE, 'install.sh': 'echo\n' })
const hook = (script, input) => spawnSync('node', [`${SCRIPTS}${script}`], { encoding: 'utf8', env, input: JSON.stringify(input) })
const tick = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5)

// The user's answer, recorded the way the real hooks do: PreToolUse (clean ask), then PostToolUse.
function answer(repo, q, label, id = 'toolu_1') {
  const base = { session_id: 's1', cwd: repo, tool_name: 'AskUserQuestion', tool_use_id: id }
  const questions = [{ question: q, header: 'Exempt', options: [{ label: 'Exempt', description: 'd' }, { label: 'Keep the oracle', description: 'd' }], multiSelect: false }]
  hook('unlock-approval.mjs', { ...base, hook_event_name: 'PreToolUse', tool_input: { questions } })
  tick()
  hook('unlock-approval.mjs', { ...base, hook_event_name: 'PostToolUse', tool_input: { questions, answers: { [q]: label } }, tool_response: { questions, answers: { [q]: label } } })
}
const ARGS = `${DOC} T1 -- install.sh`
const ask = (args = ARGS) => `\`install.sh\` has no deterministic test. Exempt \`${args}\`?`
const exempt = (args = ARGS) => `construct-gate oracle exempt ${args}`
const guard = (repo, command, extra = {}) => {
  const r = hook('command-guard.mjs', { session_id: 's1', cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, ...extra })
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null
}
const ask1 = (args) => `Exempt \`${args}\`?`
const allowed = (out) => assert.equal(out, null)
const denied = (out) => {
  assert.equal(out?.permissionDecision, 'deny')
  assert.match(out.permissionDecisionReason, /AskUserQuestion/)
  assert.match(out.permissionDecisionReason, /Keep the oracle/)
}

describe('command-guard: oracle exempt after a recorded Exempt answer', () => {
  test('denied without an answer', () => denied(guard(fresh(), exempt())))
  test('allowed as the whole command after the matching answer (plain, or run by node, label case-insensitive), once per answer', () => {
    for (const [command, label] of [[exempt(), 'Exempt'], [exempt(), ' EXEMPT '], [`node /x/bin/${exempt()}`, 'Exempt']]) {
      const repo = fresh()
      answer(repo, ask1(ARGS), label)
      allowed(guard(repo, command))
      denied(guard(repo, command)) // the answer was used
    }
  })
  test('denied for another task, other surfaces, an extra surface, the label Keep the oracle, or an Unlock answer', () => {
    const repo = fresh()
    for (const [q, label, command] of [
      [ask1(ARGS), 'Exempt', exempt(`${DOC} T2 -- install.sh`)],
      [ask1(ARGS), 'Exempt', exempt(`${DOC} T1 -- src/`)],
      [ask1(ARGS), 'Exempt', exempt(`${DOC} T1 -- install.sh src/`)],
      [ask1(ARGS), 'Keep the oracle', exempt()],
      [ask1(ARGS), 'Unlock', exempt()],
    ]) {
      answer(repo, q, label, `toolu_${label}`)
      denied(guard(repo, command))
    }
  })
  test('denied in a subagent, as part of a compound command, with a redirect or a glob surface, and for two exempts at once', () => {
    const repo = fresh()
    answer(repo, ask1(ARGS), 'Exempt')
    denied(guard(repo, exempt(), { agent_id: 'a1' }))
    for (const command of [`${exempt()} && echo x`, `${exempt()} > /dev/null`, `echo x; ${exempt()}`, `${exempt()} ${exempt()}`, exempt(`${DOC} T1 -- install.sh*`)]) denied(guard(repo, command))
    allowed(guard(repo, exempt())) // the answer survived every denial
  })
  test('an answer to a question naming no backticked arguments approves nothing', () => {
    const repo = fresh()
    answer(repo, 'Exempt T1?', 'Exempt')
    denied(guard(repo, exempt()))
  })
})

describe('construct-gate oracle exempt', () => {
  const cli = (repo, ...args) => spawnSync('node', [GATE, 'oracle', 'exempt', ...args], { cwd: repo, encoding: 'utf8', env })
  test('records an envelope with the default budget, no command, and the given surfaces', () => {
    const repo = fresh()
    const r = cli(repo, DOC, 'T1', '--', 'install.sh', 'scripts/')
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /exempted T1/)
    const e = readEnvelope(repo, DOC, 'T1')
    assert.deepEqual({ ...e, at: 0 }, { feature: DOC, task: 'T1', command: null, surfaces: ['install.sh', 'scripts/'], ...DEFAULTS, exempt: true, at: 0 })
    assert.equal(readEnvelope(repo, DOC, 'T2'), null)
  })
  test('refuses a task that already has an envelope, an unknown task or document, a glob or escaping surface, and missing arguments', () => {
    const repo = fresh()
    assert.equal(cli(repo, DOC, 'T1', '--', 'a.sh').status, 0)
    for (const args of [[DOC, 'T1', '--', 'b.sh'], [DOC, 'T9', '--', 'a.sh'], ['.vault/tasks/none.md', 'T2', '--', 'a.sh'], [DOC, 'T2', '--', 'src/*'], [DOC, 'T2', '--', '../x'], [DOC, 'T2', '--', '/etc'], [DOC, 'T2'], [DOC, 'T2', 'a.sh']]) {
      const r = cli(repo, ...args)
      assert.equal(r.status, 1, args.join(' '))
      assert.equal(r.stdout, '')
      assert.match(r.stderr, /^construct-gate: /)
    }
    assert.equal(readEnvelope(repo, DOC, 'T2'), null)
  })
  test('delegation-admission then admits a worker on code for the exempted task, inside the surfaces only', () => {
    const repo = fresh()
    cli(repo, DOC, 'T1', '--', 'install.sh')
    const launch = (path) => hook('delegation-admission.mjs', { session_id: 's1', cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'construct:worker', prompt: `Spec: ${DOC}, T1\n\n## Allowed edit surfaces\n${path}\n`, description: 'u' } }).stdout
    assert.equal(launch('install.sh'), '')
    assert.match(launch('lib/x.js'), /outside the oracle envelope/)
  })
})
