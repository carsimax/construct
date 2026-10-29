// S2 and S3 of .vault/tasks/guarantees.md: a worker is confined from the moment it starts, and state the hooks cannot read denies.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { applyFiles, commitAll, git, makeRepo, scratchDir } from '../helpers/repo.mjs'
import { readTaskState, writeEnvelope, writeTaskState } from '../../plugins/construct/hooks/scripts/review-store.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const script = (name) => join(PLUGIN, 'hooks/scripts', name)
const ADMISSION = script('delegation-admission.mjs')
const STOP = script('oracle-stop.mjs')
const GUARD = script('surface-guard.mjs')
const GATE = script('publication-gate.mjs')
const FEATURE = '.vault/tasks/f.md'
const WORKER = 'construct:worker'
const prompt = (...paths) => `Spec: ${FEATURE}, T1\nDo it\n\n## Allowed edit surfaces\n${paths.join('\n')}\n`
const escape = (text) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

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
const launch = (repo, env) => run(ADMISSION, [], { session_id: 's1', cwd: repo, tool_name: 'Agent', tool_input: { subagent_type: WORKER, prompt: prompt('src/a.js'), description: 'u' } }, env)
const begin = (repo, env, extra = {}) => run(ADMISSION, ['start'], { session_id: 's1', agent_id: 'a1', agent_type: WORKER, cwd: repo }, { ...env, ...extra })

// A repository whose task T1 has an envelope; the worker is launched and started unless `go` is false.
function setup({ go = true } = {}) {
  const repo = makeRepo({ '.vault/tasks/f.md': '# f\n', 'src/a.js': 'a\n' })
  const env = { CLAUDE_PLUGIN_DATA: scratchDir('odd-guar-data-') }
  writeEnvelope(repo, { feature: FEATURE, task: 'T1', command: 'true', surfaces: ['src/**'], attempts: 3, minutes: 30, lines: 400, at: 1 })
  if (go) {
    launch(repo, env)
    begin(repo, env)
  }
  return { repo, env }
}
const storeFile = (repo, area, pick) => {
  const dir = join(repo, '.git/construct-review', area)
  return join(dir, readdirSync(dir).find(pick))
}
const envelopeFile = (repo) => storeFile(repo, 'envelopes', (n) => !n.endsWith('.state.json'))
const stateFile = (repo) => storeFile(repo, 'envelopes', (n) => n.endsWith('.state.json'))
const recordDir = (env) => join(env.CLAUDE_PLUGIN_DATA, 'delegation-admission', 's1')
const transcript = () => {
  const file = join(scratchDir('odd-guar-t-'), 't.jsonl')
  writeFileSync(file, `${JSON.stringify({ type: 'user', message: { role: 'user', content: prompt('src/a.js') } })}\n`)
  return file
}
const stop = ({ repo, env }) => run(STOP, ['stop'], { session_id: 's1', agent_id: 'a1', agent_type: WORKER, cwd: repo, agent_transcript_path: transcript() }, env)
const write = ({ repo, env }, path = 'src/a.js', extra = { agent_id: 'a1' }) => run(GUARD, [], { session_id: 's1', cwd: repo, tool_name: 'Write', tool_input: { file_path: path, content: 'x\n' }, ...extra }, env)
const denied = (r, ...needles) => {
  assert.equal(r.status, 0)
  assert.equal(r.json?.hookSpecificOutput?.permissionDecision, 'deny', r.stdout)
  for (const n of needles) assert.match(r.json.hookSpecificOutput.permissionDecisionReason, n)
}
const blocked = (r, ...needles) => {
  assert.equal(r.status, 0)
  assert.equal(r.json?.decision, 'block', r.stdout)
  for (const n of needles) assert.match(r.json.reason, n)
}
const withoutBaseline = (repo, extra = {}) => {
  const { baseTree, workers, ...rest } = readTaskState(repo, FEATURE, 'T1')
  writeTaskState(repo, FEATURE, 'T1', { ...rest, ...extra })
}

describe('S2: started first, then the snapshot', () => {
  test('the record is started with the agent_id even when the snapshot fails', () => {
    const w = setup({ go: false })
    launch(w.repo, w.env)
    writeFileSync(join(w.repo, 'src/new.js'), 'new object\n')
    const objects = join(w.repo, '.git/objects')
    chmodSync(objects, 0o555) // the snapshot cannot write its objects
    try {
      begin(w.repo, w.env)
    } finally {
      chmodSync(objects, 0o755)
    }
    const [name] = readdirSync(recordDir(w.env))
    const entry = JSON.parse(readFileSync(join(recordDir(w.env), name), 'utf8'))
    assert.equal(entry.started, true)
    assert.equal(entry.agent_id, 'a1')
  })
  test('the SubagentStart entry of delegation-admission start has a 30 s timeout', () => {
    const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks/hooks.json'), 'utf8')).hooks.SubagentStart
    const entry = hooks.flatMap((h) => h.hooks).find((h) => h.args?.some((a) => a.endsWith('delegation-admission.mjs')) && h.args.includes('start'))
    assert.equal(entry.timeout, 30)
  })
  test('a stop with an envelope and no baseline is blocked naming the start snapshot, and spends an attempt', () => {
    const w = setup()
    withoutBaseline(w.repo)
    blocked(stop(w), /start snapshot/)
    assert.equal(readTaskState(w.repo, FEATURE, 'T1').attempts, 1)
  })
  test('with one attempt left the same stop is allowed', () => {
    const w = setup()
    withoutBaseline(w.repo, { attempts: 2 })
    const r = stop(w)
    assert.notEqual(r.json?.decision, 'block', r.stdout)
    assert.match(r.json.systemMessage, /start snapshot/)
  })
})

describe('S3: unreadable envelope or task state', () => {
  const corrupt = {
    'an envelope that is not JSON': [envelopeFile, '{not json'],
    'an envelope of the wrong shape': [envelopeFile, '{"surfaces":"x"}\n'],
    'a task state that is not JSON': [stateFile, '{not json'],
    'a task state of the wrong shape': [stateFile, '{"attempts":"one"}\n'],
  }
  for (const [name, [pick, content]] of Object.entries(corrupt)) {
    test(`${name}: the worker launch is denied naming the file`, () => {
      const w = setup()
      const file = pick(w.repo)
      writeFileSync(file, content)
      denied(launch(w.repo, w.env), escape(file))
    })
    test(`${name}: the worker's write is denied naming the file`, () => {
      const w = setup()
      const file = pick(w.repo)
      writeFileSync(file, content)
      denied(write(w), escape(file))
    })
    test(`${name}: the stop is blocked naming the file`, () => {
      const w = setup()
      const file = pick(w.repo)
      writeFileSync(file, content)
      blocked(stop(w), escape(file))
    })
  }
  test("a missing envelope and state keep today's meaning: the stop is not checked", () => {
    const repo = makeRepo({ '.vault/tasks/f.md': '# f\n', 'src/a.js': 'a\n' })
    assert.equal(stop({ repo, env: { CLAUDE_PLUGIN_DATA: scratchDir('odd-guar-data-') } }).stdout, '')
  })
  test('the bash mode prints nothing for an unreadable state', () => {
    const w = setup()
    writeFileSync(stateFile(w.repo), '{not json')
    const r = run(STOP, ['bash'], { session_id: 's1', agent_id: 'a1', cwd: w.repo, tool_input: { command: 'true' }, error: 'x' }, w.env)
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '')
  })
})

describe('S3: unreadable oracle lock record', () => {
  const lockFile = (repo) => {
    const dir = join(repo, '.git/construct-review/oracles')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'broken.json'), '{not json')
  }
  test('surface-guard denies every subagent write naming the file', () => {
    const w = setup()
    lockFile(w.repo)
    denied(write(w), /broken\.json/)
    denied(write(w, 'src/other.js'), /broken\.json/)
  })
  test('the publication gate denies publishing naming the file', () => {
    const repo = makeRepo({ 'src/app.js': 'export const a = 1\n' })
    git(repo, 'checkout', '-q', '-b', 'feat')
    applyFiles(repo, { 'src/app.js': 'export const a = 2\n' })
    commitAll(repo, 'unit')
    lockFile(repo)
    const env = { CLAUDE_PLUGIN_DATA: scratchDir('odd-guar-data-'), XDG_CONFIG_HOME: scratchDir('odd-guar-xdg-') }
    denied(run(GATE, [], { session_id: 's1', cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push' } }, env), /publication-gate/, /broken\.json/)
  })
})

describe('S3: unreadable writer record', () => {
  test('surface-guard denies a subagent with no readable record, naming the file', () => {
    const w = setup()
    const file = join(recordDir(w.env), 'garbage')
    writeFileSync(file, '{not json')
    denied(write(w, 'src/a.js', { agent_id: 'other' }), escape(file))
  })
  test('a subagent with a readable record stays confined as before', () => {
    const w = setup()
    writeFileSync(join(recordDir(w.env), 'garbage'), '{not json')
    assert.equal(write(w).stdout, '')
    denied(write(w, 'src/b.js'), /outside your allowed edit surfaces/)
  })
})
