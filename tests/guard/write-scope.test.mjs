// Write scope (S3, S4), driven through the real secret-guard hook: the main thread
// does not write inside the repository (S4), and a writer subagent writes only inside
// the surfaces of its own prompt (S3).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { makeRepo, scratchDir } from '../assess/helpers.mjs'

const SCRIPT = new URL('../../plugins/construct/hooks/scripts/secret-guard.mjs', import.meta.url).pathname
const home = scratchDir('ws-home-')

function run(input) {
  const r = spawnSync('node', [SCRIPT], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, HOME: home } })
  let json = null
  try {
    json = JSON.parse(r.stdout)
  } catch {
    // allowed calls print nothing
  }
  return { status: r.status, stdout: r.stdout, json }
}
const denied = (r, ...needles) => {
  assert.equal(r.status, 0)
  assert.equal(r.json?.hookSpecificOutput?.permissionDecision, 'deny', r.stdout)
  assert.equal(r.json.hookSpecificOutput.hookEventName, 'PreToolUse')
  for (const n of needles) assert.match(r.json.hookSpecificOutput.permissionDecisionReason, n)
}
const allowed = (r) => {
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
}

const repo = realpathSync(makeRepo({ 'src/a.js': 'a\n' }))
mkdirSync(join(repo, 'src/deep'), { recursive: true })
const outside = realpathSync(scratchDir('ws-outside-'))

const main = (tool_name, tool_input, cwd = repo) => run({ session_id: 's', cwd, tool_name, tool_input })

describe('S4: main thread', () => {
  for (const tool of ['Edit', 'Write', 'MultiEdit']) {
    test(`${tool} inside the repository is denied naming construct:odd-worker`, () => {
      denied(main(tool, { file_path: join(repo, 'src/a.js') }), /construct:odd-worker/, /delegat/i)
    })
  }
  test('NotebookEdit uses notebook_path', () => {
    denied(main('NotebookEdit', { notebook_path: join(repo, 'n.ipynb') }), /construct:odd-worker/)
    allowed(main('NotebookEdit', { notebook_path: join(outside, 'n.ipynb') }))
  })
  test('a relative path resolves against cwd, also from a subdirectory', () => {
    denied(main('Edit', { file_path: 'src/a.js' }), /construct:odd-worker/)
    denied(main('Write', { file_path: '../a.js' }, join(repo, 'src/deep')), /construct:odd-worker/)
    allowed(main('Write', { file_path: '../../../x.js' }, join(repo, 'src/deep')))
  })
  test('a new file in a directory that does not exist yet is still inside the repository', () => {
    denied(main('Write', { file_path: join(repo, 'brand/new/dir/x.js') }), /construct:odd-worker/)
  })
  test('odd/tasks is allowed', () => {
    allowed(main('Write', { file_path: join(repo, 'odd/tasks/feat.md') }))
    allowed(main('Edit', { file_path: 'odd/tasks/sub/x.md' }))
  })
  test('odd/tasks lookalikes and traversal out of it are denied', () => {
    denied(main('Write', { file_path: join(repo, 'odd/tasks-x/a.md') }))
    denied(main('Write', { file_path: join(repo, 'odd/tasks/../../src/a.js') }))
    denied(main('Write', { file_path: join(repo, 'odd/other.md') }))
  })
  test('paths outside the repository are allowed', () => {
    allowed(main('Write', { file_path: join(outside, 'x.js') }))
    allowed(main('Edit', { file_path: join(home, '.config/x') }))
  })
  test('a working directory outside any repository is allowed', () => {
    allowed(main('Write', { file_path: join(outside, 'x.js') }, outside))
  })
  test('Read, Grep, Glob and Bash are not affected', () => {
    allowed(main('Read', { file_path: join(repo, 'src/a.js') }))
    allowed(main('Grep', { pattern: 'a', path: repo }))
    allowed(main('Bash', { command: 'ls' }))
  })
  test('the secret rule keeps its own reason and goes first', () => {
    denied(main('Write', { file_path: join(repo, '.env') }), /secret-guard blocked/, /\.env file/)
  })
  test('a payload without a usable path is allowed', () => {
    allowed(main('Write', {}))
  })
})

// A session transcript with one subagent transcript next to it.
function session(prompt, id = 'abc123') {
  const dir = scratchDir('ws-session-')
  const transcript = join(dir, 'sess.jsonl')
  writeFileSync(transcript, '')
  mkdirSync(join(dir, 'sess', 'subagents'), { recursive: true })
  const rows = [{ type: 'user', message: { role: 'user', content: prompt } }, { type: 'assistant', message: { content: [] } }]
  writeFileSync(join(dir, 'sess', 'subagents', `agent-${id}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n'))
  return { transcript, id }
}
const surfaces = (...p) => `Do the unit.\n\n## Allowed edit surfaces\n${p.join('\n')}\n\n## Verification\n- x\n`
const sub = (s, type, tool, input, extra = {}) =>
  run({ session_id: 'sess', cwd: repo, transcript_path: s.transcript, agent_id: s.id, agent_type: type, tool_name: tool, tool_input: input, ...extra })

describe('S3: writer subagent', () => {
  for (const type of ['construct:odd-worker', 'odd-worker', 'construct:jd-fix-agent']) {
    test(`${type}: inside the surfaces is allowed, outside is denied naming the surfaces`, () => {
      const s = session(surfaces('src/a.js', 'tests/**/*.mjs'))
      allowed(sub(s, type, 'Edit', { file_path: join(repo, 'src/a.js') }))
      allowed(sub(s, type, 'Write', { file_path: 'tests/x/y.mjs' }))
      denied(sub(s, type, 'Edit', { file_path: join(repo, 'src/b.js') }), /Allowed edit surfaces/, /src\/b\.js/, /src\/a\.js/)
      denied(sub(s, type, 'Write', { file_path: join(repo, 'tests/x/y.js') }))
    })
  }
  test('a directory entry covers what is under it; a lookalike is not covered', () => {
    const s = session(surfaces('src/deep'))
    allowed(sub(s, 'construct:odd-worker', 'Write', { file_path: join(repo, 'src/deep/n/x.js') }))
    denied(sub(s, 'construct:odd-worker', 'Write', { file_path: join(repo, 'src/deeper/x.js') }))
  })
  test('glob entries: * stays in a segment, ** crosses, braces and ? work', () => {
    const s = session(surfaces('src/*.js', 'lib/**/*.ts', 'docs/{a,b}.md', 'top/x?.txt'))
    const w = (p) => sub(s, 'construct:odd-worker', 'Write', { file_path: join(repo, p) })
    allowed(w('src/q.js'))
    denied(w('src/n/q.js'))
    allowed(w('lib/a/b/c.ts'))
    allowed(w('docs/b.md'))
    denied(w('docs/c.md'))
    allowed(w('top/x1.txt'))
    denied(w('top/x12.txt'))
  })
  test('MultiEdit and NotebookEdit are checked too', () => {
    const s = session(surfaces('src/a.js'))
    denied(sub(s, 'construct:odd-worker', 'MultiEdit', { file_path: join(repo, 'src/z.js') }))
    denied(sub(s, 'construct:odd-worker', 'NotebookEdit', { notebook_path: join(repo, 'n.ipynb') }))
  })
  test('a path outside the repository is outside every surface and denied', () => {
    const s = session(surfaces('src/a.js'))
    denied(sub(s, 'construct:odd-worker', 'Write', { file_path: join(outside, 'x.js') }))
  })
  test('a path escaping a surface with .. is denied', () => {
    const s = session(surfaces('src/a.js'))
    denied(sub(s, 'construct:odd-worker', 'Write', { file_path: join(repo, 'src/../etc/x.js') }))
  })
  test('a missing transcript, no agent_id file, or no section allows (fail open)', () => {
    const s = session(surfaces('src/a.js'))
    const edit = { file_path: join(repo, 'src/b.js') }
    allowed(sub(s, 'construct:odd-worker', 'Edit', edit, { agent_id: 'nofile' }))
    allowed(sub(s, 'construct:odd-worker', 'Edit', edit, { transcript_path: join(outside, 'none.jsonl') }))
    allowed(sub(s, 'construct:odd-worker', 'Edit', edit, { transcript_path: undefined }))
    allowed(sub(session('Do the thing, no section'), 'construct:odd-worker', 'Edit', edit))
  })
  test('a prompt given as text blocks is read', () => {
    const dir = scratchDir('ws-session-')
    mkdirSync(join(dir, 'sess', 'subagents'), { recursive: true })
    writeFileSync(join(dir, 'sess.jsonl'), '')
    const row = { type: 'user', message: { content: [{ type: 'text', text: surfaces('src/a.js') }] } }
    writeFileSync(join(dir, 'sess', 'subagents', 'agent-t1.jsonl'), `${JSON.stringify(row)}\n`)
    const s = { transcript: join(dir, 'sess.jsonl'), id: 't1' }
    denied(sub(s, 'construct:odd-worker', 'Edit', { file_path: join(repo, 'src/b.js') }))
    allowed(sub(s, 'construct:odd-worker', 'Edit', { file_path: join(repo, 'src/a.js') }))
  })
  test('an agent_id that is not a plain id never leaves the subagents directory', () => {
    const s = session(surfaces('src/a.js'))
    allowed(sub(s, 'construct:odd-worker', 'Edit', { file_path: join(repo, 'src/b.js') }, { agent_id: '../../x' }))
  })
  test('other subagent types are unaffected by S3 and S4', () => {
    const s = session(surfaces('src/a.js'))
    for (const type of ['construct:odd-explorer', 'construct:odd-verify', 'general-purpose']) {
      allowed(sub(s, type, 'Edit', { file_path: join(repo, 'src/b.js') }))
    }
  })
  test('the secret rule still wins for a writer', () => {
    const s = session(surfaces('.env'))
    denied(sub(s, 'construct:odd-worker', 'Write', { file_path: join(repo, '.env') }), /secret-guard blocked/)
  })
})
