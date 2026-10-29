// S4, S5, S6 of .vault/tasks/oracle-limits.md: oracle-stop runs the envelope command when a worker stops, counts attempts
// by progress, checks the diff against the envelope, and surface-guard hard-stops a worker whose budget is spent.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { makeRepo, scratchDir, write } from '../helpers/repo.mjs'
import { readEnvelope, readTaskState, writeEnvelope, writeTaskState } from '../../plugins/construct/hooks/scripts/review-store.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const script = (name) => join(PLUGIN, 'hooks/scripts', name)
const ADMISSION = script('delegation-admission.mjs')
const STOP = script('oracle-stop.mjs')
const GUARD = script('surface-guard.mjs')
const FEATURE = '.vault/tasks/f.md'
const WORKER = 'construct:worker'
const prompt = (...paths) => `Spec: ${FEATURE}, T1\nDo it\n\n## Allowed edit surfaces\n${paths.join('\n')}\n`

const run = (file, args, input, env) => {
  const r = spawnSync('node', [file, ...args], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ...env } })
  let json = null
  try {
    json = JSON.parse(r.stdout)
  } catch {
    // no JSON output
  }
  return { status: r.status, stdout: r.stdout, json }
}

// A repository with a started worker (agent a1) of task T1 whose envelope is `envelope`.
function started(envelope = {}, { surfaces = ['src/**'], base = { 'src/a.js': 'a\n' } } = {}) {
  const repo = makeRepo({ '.vault/tasks/f.md': '# f\n', ...base })
  const env = { CLAUDE_PLUGIN_DATA: scratchDir('odd-stop-data-') }
  writeEnvelope(repo, { feature: FEATURE, task: 'T1', command: 'true', surfaces, attempts: 3, minutes: 30, lines: 400, at: 1, ...envelope })
  run(ADMISSION, [], { session_id: 's1', cwd: repo, tool_name: 'Agent', tool_input: { subagent_type: WORKER, prompt: prompt('src/a.js'), description: 'u' } }, env)
  run(ADMISSION, ['start'], { session_id: 's1', agent_id: 'a1', agent_type: WORKER, cwd: repo }, env)
  return { repo, env }
}
const transcript = () => {
  const file = join(scratchDir('odd-stop-t-'), 't.jsonl')
  writeFileSync(file, `${JSON.stringify({ type: 'user', message: { role: 'user', content: prompt('src/a.js') } })}\n`)
  return file
}
const stop = ({ repo, env }, extra = {}) =>
  run(STOP, ['stop'], { session_id: 's1', agent_id: 'a1', agent_type: WORKER, cwd: repo, hook_event_name: 'SubagentStop', agent_transcript_path: transcript(), ...extra }, env)
const state = (repo) => readTaskState(repo, FEATURE, 'T1')
const isBlocked = (r, ...needles) => {
  assert.equal(r.status, 0)
  assert.equal(r.json?.decision, 'block', r.stdout)
  for (const n of needles) assert.match(r.json.reason, n)
}
const isAllowed = (r) => {
  assert.equal(r.status, 0)
  assert.notEqual(r.json?.decision, 'block', r.stdout)
}

describe('task start', () => {
  test('the worker start records startedAt and a base tree once per task', () => {
    const w = started()
    const first = state(w.repo)
    assert.equal(typeof first.startedAt, 'number')
    assert.match(first.baseTree, /^[0-9a-f]{40}/)
    assert.equal(first.attempts, 0)
    assert.equal(first.bestPass, null)
    writeTaskState(w.repo, FEATURE, 'T1', { ...first, startedAt: 5 })
    run(ADMISSION, [], { session_id: 's1', cwd: w.repo, tool_name: 'Agent', tool_input: { subagent_type: WORKER, prompt: prompt('src/a.js'), description: 'u' } }, w.env)
    assert.equal(state(w.repo).startedAt, 5)
  })
  test('a worker without an envelope gets no task state', () => {
    const repo = makeRepo({ '.vault/tasks/f.md': '# f\n' })
    const env = { CLAUDE_PLUGIN_DATA: scratchDir('odd-stop-data-') }
    const docs = `Spec: ${FEATURE}, T1\n\n## Allowed edit surfaces\nREADME.md\n`
    run(ADMISSION, [], { session_id: 's1', cwd: repo, tool_name: 'Agent', tool_input: { subagent_type: WORKER, prompt: docs, description: 'u' } }, env)
    run(ADMISSION, ['start'], { session_id: 's1', agent_id: 'a1', agent_type: WORKER, cwd: repo }, env)
    assert.equal(state(repo), null)
  })
})

describe('oracle-stop at SubagentStop', () => {
  test('a green command allows the stop', () => {
    const w = started({ command: 'true' })
    write(w.repo, 'src/a.js', 'b\n')
    isAllowed(stop(w))
  })
  test('a red command blocks with the output tail, spends an attempt and names what remains', () => {
    const w = started({ command: 'echo boom-line; exit 1', attempts: 3 })
    isBlocked(stop(w), /boom-line/, /2 attempts and \d+ minutes left/)
    assert.equal(state(w.repo).attempts, 1)
  })
  test('a run whose passing count rose does not spend an attempt and records the best', () => {
    const w = started({ command: 'echo "ℹ pass 2"; echo "ℹ fail 1"; exit 1', attempts: 3 })
    isBlocked(stop(w))
    assert.equal(state(w.repo).attempts, 0)
    assert.equal(state(w.repo).bestPass, 2)
    isBlocked(stop(w)) // same count: no progress, one attempt
    assert.equal(state(w.repo).attempts, 1)
  })
  test('the run that spends the last attempt allows the stop and names the spent budget', () => {
    const w = started({ command: 'exit 1', attempts: 1 })
    const r = stop(w)
    isAllowed(r)
    assert.match(r.json?.systemMessage ?? '', /attempts/)
    assert.equal(state(w.repo).attempts, 1)
  })
  test('a spent budget allows the stop without running the command', () => {
    const w = started({ command: 'echo ran > ran.txt; exit 1', attempts: 2 })
    writeTaskState(w.repo, FEATURE, 'T1', { ...state(w.repo), attempts: 2 })
    isAllowed(stop(w))
    assert.equal(spawnSync('test', ['-e', join(w.repo, 'ran.txt')]).status, 1)
  })
  test('minutes exceeded allows the stop', () => {
    const w = started({ command: 'exit 1', minutes: 1 })
    writeTaskState(w.repo, FEATURE, 'T1', { ...state(w.repo), startedAt: Date.now() - 5 * 60_000 })
    const r = stop(w)
    isAllowed(r)
    assert.match(r.json?.systemMessage ?? '', /minutes/)
  })
  test('a command that times out counts as a failed run', () => {
    const w = started({ command: 'sleep 30', minutes: 1, attempts: 3 })
    writeTaskState(w.repo, FEATURE, 'T1', { ...state(w.repo), startedAt: Date.now() - 59_000 })
    const r = stop(w) // killed at the remaining second: a failed run that also spends the minutes
    isAllowed(r)
    assert.match(r.json?.systemMessage ?? '', /minutes/)
    assert.equal(state(w.repo).attempts, 1)
  })
  test('an exempt envelope (no command) is still diff-checked', () => {
    const w = started({ command: null, exempt: true })
    write(w.repo, 'src/a.js', 'b\n')
    isAllowed(stop(w))
    write(w.repo, 'lib/other.js', 'x\n')
    isBlocked(stop(w), /lib\/other\.js/)
  })
  test('a path outside the surfaces written by a plain shell redirect blocks and spends an attempt', () => {
    const w = started({ command: 'true' })
    spawnSync('sh', ['-c', 'echo x > lib.js'], { cwd: w.repo })
    isBlocked(stop(w), /lib\.js/, /outside/)
    assert.equal(state(w.repo).attempts, 1)
  })
  test('docs and .vault changes are not counted against the surfaces', () => {
    const w = started({ command: 'true' })
    write(w.repo, '.vault/tasks/f.md', '# f\nlog\n')
    write(w.repo, 'NOTES.md', 'n\n')
    isAllowed(stop(w))
  })
  test('more changed lines than the envelope allows blocks naming the counts', () => {
    const w = started({ command: 'true', lines: 5 })
    write(w.repo, 'src/a.js', 'x\n'.repeat(20))
    isBlocked(stop(w), /src\/a\.js|lines/, /\b2\d\b|\b20\b/, /5/)
    assert.equal(state(w.repo).attempts, 1)
  })
  test('changes made before the worker started are not counted', () => {
    const repo = makeRepo({ '.vault/tasks/f.md': '# f\n', 'src/a.js': 'a\n' })
    write(repo, 'lib/old.js', 'x\n'.repeat(50)) // dirty before the start
    const env = { CLAUDE_PLUGIN_DATA: scratchDir('odd-stop-data-') }
    writeEnvelope(repo, { feature: FEATURE, task: 'T1', command: 'true', surfaces: ['src/**'], attempts: 3, minutes: 30, lines: 400, at: 1 })
    run(ADMISSION, [], { session_id: 's1', cwd: repo, tool_name: 'Agent', tool_input: { subagent_type: WORKER, prompt: prompt('src/a.js'), description: 'u' } }, env)
    run(ADMISSION, ['start'], { session_id: 's1', agent_id: 'a1', agent_type: WORKER, cwd: repo }, env)
    isAllowed(stop({ repo, env }))
  })
  test('a path inside another open writer\'s surfaces is not this worker\'s doing and spends nothing', () => {
    const w = started({ command: 'true' })
    writeEnvelope(w.repo, { feature: FEATURE, task: 'T2', command: 'true', surfaces: ['lib/**'], attempts: 3, minutes: 30, lines: 400, at: 1 })
    run(ADMISSION, [], { session_id: 's1', cwd: w.repo, tool_name: 'Agent', tool_input: { subagent_type: WORKER, prompt: prompt('lib/**').replace('T1', 'T2'), description: 'u' } }, w.env)
    run(ADMISSION, ['start'], { session_id: 's1', agent_id: 'a2', agent_type: WORKER, cwd: w.repo }, w.env)
    write(w.repo, 'lib/b.js', 'x\n'.repeat(900)) // a2's file, over a1's line budget
    isAllowed(stop(w))
    assert.equal(state(w.repo).attempts, 0)
    write(w.repo, 'other/c.js', 'x\n') // nobody's surface
    isBlocked(stop(w), /other\/c\.js/)
  })
  test('lines written before this worker started do not count, though the task started earlier', () => {
    const w = started({ command: 'true', lines: 5 })
    write(w.repo, 'src/a.js', 'x\n'.repeat(20)) // the first worker's lines
    run(ADMISSION, [], { session_id: 's1', cwd: w.repo, tool_name: 'Agent', tool_input: { subagent_type: WORKER, prompt: prompt('src/c.js'), description: 'u' } }, w.env)
    run(ADMISSION, ['start'], { session_id: 's1', agent_id: 'a3', agent_type: WORKER, cwd: w.repo }, w.env)
    isAllowed(stop(w, { agent_id: 'a3' }))
  })
  describe('parallel workers of two tasks', () => {
    const transcriptOf = (text) => {
      const file = join(scratchDir('odd-stop-t-'), 't.jsonl')
      writeFileSync(file, `${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`)
      return file
    }
    const bPrompt = prompt('lib/**').replace('T1', 'T2')
    // A (a1, T1, src/**) is started; B (a2, T2, lib/**) starts after it.
    const withB = () => {
      const w = started({ command: 'true' })
      writeEnvelope(w.repo, { feature: FEATURE, task: 'T2', command: 'true', surfaces: ['lib/**'], attempts: 3, minutes: 30, lines: 5, at: 1 })
      run(ADMISSION, [], { session_id: 's1', cwd: w.repo, tool_name: 'Agent', tool_input: { subagent_type: WORKER, prompt: bPrompt, description: 'u' } }, w.env)
      run(ADMISSION, ['start'], { session_id: 's1', agent_id: 'a2', agent_type: WORKER, cwd: w.repo }, w.env)
      return w
    }
    const stopB = (w) => run(STOP, ['stop'], { session_id: 's1', agent_id: 'a2', agent_type: WORKER, cwd: w.repo, agent_transcript_path: transcriptOf(bPrompt) }, w.env)
    const stateB = (w) => readTaskState(w.repo, FEATURE, 'T2')
    test('a sibling that wrote and stopped before this worker stops is still not this worker\'s doing', () => {
      const w = withB()
      write(w.repo, 'src/a.js', 'x\n'.repeat(50))
      const input = { session_id: 's1', agent_id: 'a1', agent_type: WORKER, cwd: w.repo, agent_transcript_path: transcript() }
      isAllowed(run(STOP, ['stop'], input, w.env))
      run(ADMISSION, ['stop'], input, w.env)
      isAllowed(stopB(w))
      assert.equal(stateB(w).attempts, 0)
    })
    test('the baseline survives the removal of the admission record', () => {
      const w = started({ command: 'true', lines: 5 })
      write(w.repo, 'src/a.js', 'x\n'.repeat(20)) // the first worker's lines
      run(ADMISSION, [], { session_id: 's1', cwd: w.repo, tool_name: 'Agent', tool_input: { subagent_type: WORKER, prompt: prompt('src/c.js'), description: 'u' } }, w.env)
      run(ADMISSION, ['start'], { session_id: 's1', agent_id: 'a3', agent_type: WORKER, cwd: w.repo }, w.env)
      const t = transcriptOf(prompt('src/c.js'))
      const dir = join(w.env.CLAUDE_PLUGIN_DATA, 'delegation-admission', 's1')
      for (const name of readdirSync(dir)) rmSync(join(dir, name)) // admission's stop ran first
      isAllowed(stop(w, { agent_id: 'a3', agent_transcript_path: t }))
      assert.equal(state(w.repo).attempts, 0)
    })
    test('a path outside every writer\'s surfaces since the start still blocks', () => {
      const w = withB()
      write(w.repo, 'src/a.js', 'x\n')
      run(ADMISSION, ['stop'], { session_id: 's1', agent_id: 'a1', agent_type: WORKER, cwd: w.repo, agent_transcript_path: transcript() }, w.env)
      write(w.repo, 'other/c.js', 'x\n')
      isBlocked(stopB(w), /other\/c\.js/)
      assert.equal(stateB(w).attempts, 1)
    })
  })
  test('a worker with no envelope, and other agent types, are untouched', () => {
    const w = started({ command: 'exit 1' })
    isAllowed(stop(w, { agent_type: 'construct:explorer' }))
    const repo = makeRepo({ '.vault/tasks/f.md': '# f\n' })
    const r = run(STOP, ['stop'], { session_id: 's1', agent_id: 'a1', agent_type: WORKER, cwd: repo, agent_transcript_path: transcript() }, w.env)
    assert.deepEqual({ status: r.status, stdout: r.stdout }, { status: 0, stdout: '' })
  })
  test('unreadable input fails open', () => {
    const r = spawnSync('node', [STOP, 'stop'], { input: 'not json', encoding: 'utf8' })
    assert.deepEqual({ status: r.status, stdout: r.stdout }, { status: 0, stdout: '' })
  })
})

describe('failed envelope command during work', () => {
  const failure = (w, command, extra = {}) =>
    run(STOP, ['bash'], { session_id: 's1', agent_id: 'a1', cwd: w.repo, hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command }, error: 'Exit code 1', ...extra }, w.env)
  test('a failed run of the envelope command spends an attempt', () => {
    const w = started({ command: 'node --test tests/a.test.mjs' })
    failure(w, '  node --test tests/a.test.mjs ')
    assert.equal(state(w.repo).attempts, 1)
  })
  test('a rising passing count does not spend', () => {
    const w = started({ command: 'node --test tests/a.test.mjs' })
    failure(w, 'node --test tests/a.test.mjs', { error: 'Exit code 1\nℹ pass 4\nℹ fail 1' })
    assert.equal(state(w.repo).attempts, 0)
    assert.equal(state(w.repo).bestPass, 4)
  })
  test('another command, the main thread, or a worker without an envelope spend nothing', () => {
    const w = started({ command: 'node --test tests/a.test.mjs' })
    failure(w, 'ls')
    failure(w, 'node --test tests/a.test.mjs', { agent_id: undefined })
    assert.equal(state(w.repo).attempts, 0)
  })
})

describe('surface-guard hard stop', () => {
  const write = (w, path) => run(GUARD, [], { session_id: 's1', agent_id: 'a1', cwd: w.repo, tool_name: 'Write', tool_input: { file_path: join(w.repo, path), content: 'x\n' } }, w.env)
  test('a worker whose attempts are spent is denied every write', () => {
    const w = started({ attempts: 2 })
    assert.equal(write(w, 'src/a.js').stdout, '')
    writeTaskState(w.repo, FEATURE, 'T1', { ...state(w.repo), attempts: 2 })
    const r = write(w, 'src/a.js')
    assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny')
    assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /attempts/)
    assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /stop and report/i)
  })
  test('spent minutes deny too', () => {
    const w = started({ minutes: 1 })
    writeTaskState(w.repo, FEATURE, 'T1', { ...state(w.repo), startedAt: Date.now() - 5 * 60_000 })
    assert.match(write(w, 'src/a.js').json.hookSpecificOutput.permissionDecisionReason, /minutes/)
  })
  test('the envelope itself is unchanged by the state', () => {
    const w = started({ attempts: 2 })
    writeTaskState(w.repo, FEATURE, 'T1', { ...state(w.repo), attempts: 2 })
    assert.equal(readEnvelope(w.repo, FEATURE, 'T1').attempts, 2)
  })
})

describe('registration', () => {
  const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks/hooks.json'), 'utf8')).hooks
  const find = (event, mode) => hooks[event].flatMap((g) => g.hooks).find((h) => h.args?.[0] === '${CLAUDE_PLUGIN_ROOT}/hooks/scripts/oracle-stop.mjs' && h.args[1] === mode)
  test('SubagentStop runs the stop mode with a timeout covering the oracle run', () => {
    const entry = hooks.SubagentStop.find((g) => g.hooks.some((h) => h.args?.[1] === 'stop' && h.args[0].endsWith('oracle-stop.mjs')))
    assert.equal(entry.matcher, '^construct:worker$')
    assert.deepEqual(find('SubagentStop', 'stop'), { type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/oracle-stop.mjs', 'stop'], timeout: 330 })
  })
  test('PostToolUseFailure on Bash runs the bash mode in exec form', () => {
    const entry = hooks.PostToolUseFailure.find((g) => g.hooks.some((h) => h.args?.[0].endsWith('oracle-stop.mjs')))
    assert.equal(entry.matcher, 'Bash')
    assert.deepEqual(find('PostToolUseFailure', 'bash'), { type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/oracle-stop.mjs', 'bash'], timeout: 10 })
  })
})
