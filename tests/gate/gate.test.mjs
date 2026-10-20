// The Stop review gate, driven as a real hook: node review-gate.mjs with the hook
// JSON on stdin and scratch CLAUDE_PLUGIN_DATA and XDG_CONFIG_HOME directories.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyFiles, captureAll, commitAll, git, highRepo, makeRepo, review, scratchDir, start } from '../review/helpers.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const GATE = join(PLUGIN, 'hooks/scripts/review-gate.mjs')

function env() {
  return { CLAUDE_PLUGIN_DATA: scratchDir('odd-gate-data-'), XDG_CONFIG_HOME: scratchDir('odd-gate-xdg-') }
}

function gate(cwd, e, { session = 's1', extra = {}, input } = {}) {
  const result = spawnSync('node', [GATE], {
    input: input ?? JSON.stringify({ session_id: session, cwd, hook_event_name: 'Stop', stop_hook_active: false, ...extra }),
    encoding: 'utf8',
    env: { ...process.env, ...e },
  })
  let json = null
  try {
    json = JSON.parse(result.stdout)
  } catch {
    // No output.
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json }
}

const silent = (r) => {
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
}
const head = (repo) => git(repo, 'rev-parse', 'HEAD').trim()
const reminderFile = (e, session = 's1') => join(e.CLAUDE_PLUGIN_DATA, 'review-gate', `${session}.json`)

describe('registration', () => {
  test('hooks.json registers the Stop gate in exec form and keeps the rest', () => {
    const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks/hooks.json'), 'utf8'))
    assert.deepEqual(hooks.modules, ['./register.js'])
    assert.ok(hooks.hooks.SessionStart && hooks.hooks.SubagentStart)
    const entry = hooks.hooks.Stop[0].hooks[0]
    assert.deepEqual(entry, {
      type: 'command',
      command: 'node',
      args: ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/review-gate.mjs'],
      timeout: 30,
    })
  })
})

describe('no-ops', () => {
  test('stop_hook_active', () => {
    silent(gate(highRepo(), env(), { extra: { stop_hook_active: true } }))
  })

  test('mode off', () => {
    const e = env()
    const repo = highRepo()
    review(repo, ['mode', 'disable'], { env: e })
    silent(gate(repo, e))
  })

  test('clone mode off wins over a global on', () => {
    const e = env()
    const repo = highRepo()
    review(repo, ['mode', 'disable', '--scope', 'clone'], { env: e })
    silent(gate(repo, e))
  })

  test('not a git repository', () => {
    silent(gate(scratchDir('odd-gate-norepo-'), env()))
  })

  test('a repository without commits', () => {
    const dir = scratchDir('odd-gate-empty-')
    git(dir, 'init', '-q', '-b', 'main')
    writeFileSync(join(dir, 'build.sh'), 'echo hi\n')
    silent(gate(dir, env()))
  })

  test('unreadable hook input fails open', () => {
    silent(gate(highRepo(), env(), { input: 'not json' }))
    silent(gate(highRepo(), env(), { input: '' }))
  })

  test('nothing to review: a clean repository, and a medium or passive change', () => {
    const e = env()
    silent(gate(makeRepo(), e))
    const repo = makeRepo()
    applyFiles(repo, { 'docs/guide.md': 'Guide\n' })
    silent(gate(repo, e))
    commitAll(repo, 'docs')
    silent(gate(repo, e))
  })
})

describe('blocking', () => {
  test('high uncommitted changes block once and name the reasons and the next step', () => {
    const e = env()
    const repo = highRepo()
    const r = gate(repo, e)
    assert.equal(r.status, 0)
    assert.equal(r.json.decision, 'block')
    assert.match(r.json.reason, /the uncommitted changes are high risk/)
    assert.match(r.json.reason, /shell_source \(scripts\/build\.sh\)/)
    assert.match(r.json.reason, /construct:rdd-review/)
    assert.match(r.json.reason, /consent/)
    assert.match(r.json.reason, /skip/)
    assert.ok(existsSync(reminderFile(e)))
    assert.equal(r.stdout.trim().split('\n').length, 1)
  })

  test('the reason lists at most three reason codes with their paths', () => {
    const repo = highRepo({
      'scripts/a.sh': { content: 'a\n', executable: true },
      'src/auth/login.go': 'package auth\n',
      'src/x.go': 'package x\nimport "os/exec"\nvar _ = exec.Command\n',
      '.github/workflows/ci.yml': 'on: push\n',
    })
    const reason = gate(repo, env()).json.reason
    const listed = ['executable_mode', 'hot_path', 'process_boundary', 'shell_source'].filter((code) => reason.includes(code))
    assert.equal(listed.length, 3, reason)
    assert.match(reason, /executable_mode \(scripts\/a\.sh\)/)
  })

  test('a high committed range on a feature branch blocks and names the range from the merge-base', () => {
    const e = env()
    const repo = highRepo()
    const root = head(repo)
    git(repo, 'checkout', '-q', '-b', 'feature')
    commitAll(repo, 'work')
    const r = gate(repo, e)
    assert.equal(r.json.decision, 'block')
    assert.ok(r.json.reason.includes(`${root.slice(0, 12)}..${head(repo).slice(0, 12)}`), r.json.reason)
    assert.doesNotMatch(r.json.reason, /uncommitted/)
    assert.match(r.json.reason, /the committed range \S+ is high risk/)
  })

  test('the second Stop in the same session does not block again for the same target', () => {
    const e = env()
    const repo = highRepo()
    assert.equal(gate(repo, e).json.decision, 'block')
    silent(gate(repo, e))
  })

  test('a new session reminds again', () => {
    const e = env()
    const repo = highRepo()
    gate(repo, e, { session: 'one' })
    silent(gate(repo, e, { session: 'one' }))
    assert.equal(gate(repo, e, { session: 'two' }).json.decision, 'block')
  })

  test('a changed target is reminded again in the same session', () => {
    const e = env()
    const repo = highRepo()
    gate(repo, e)
    applyFiles(repo, { 'scripts/more.sh': 'echo more\n' })
    assert.equal(gate(repo, e).json.decision, 'block')
  })

  test('the default branch without receipts never reviews its whole history, only uncommitted changes', () => {
    const e = env()
    const repo = highRepo()
    commitAll(repo, 'work')
    silent(gate(repo, e))
    applyFiles(repo, { 'scripts/next.sh': 'echo next\n' })
    assert.match(gate(repo, e).json.reason, /uncommitted changes/)
  })

  test('at most one block per Stop: committed first, then uncommitted on the next Stop', () => {
    const e = env()
    const repo = highRepo()
    git(repo, 'checkout', '-q', '-b', 'feature')
    commitAll(repo, 'work')
    applyFiles(repo, { 'scripts/next.sh': 'echo next\n' })
    const first = gate(repo, e)
    assert.doesNotMatch(first.json.reason, /uncommitted/)
    const second = gate(repo, e)
    assert.match(second.json.reason, /uncommitted changes/)
    silent(gate(repo, e))
  })

  test('a consumed target does not block (uncommitted)', () => {
    const e = env()
    const repo = highRepo()
    const txn = start(repo)
    captureAll(repo, txn)
    assert.equal(review(repo, ['acknowledge', '--lineage', txn.lineage]).status, 0)
    silent(gate(repo, e))
  })

  test('a consumed target does not block (committed range, boundary from the receipt)', () => {
    const e = env()
    const repo = highRepo()
    const base = head(repo)
    commitAll(repo, 'work')
    const txn = start(repo, { args: ['--base-ref', base, '--committed-only'] })
    captureAll(repo, txn)
    review(repo, ['acknowledge', '--lineage', txn.lineage])
    silent(gate(repo, e))
    applyFiles(repo, { 'scripts/next.sh': 'echo next\n' })
    commitAll(repo, 'next')
    const r = gate(repo, e)
    assert.equal(r.json.decision, 'block')
    assert.ok(r.json.reason.includes(`${head(repo).slice(0, 12)}`))
  })

  test('the reason agrees in number for uncommitted changes', () => {
    const e = env()
    const repo = highRepo()
    const r = gate(repo, e)
    assert.match(r.json.reason, /the uncommitted changes are high risk and have no review receipt/)
  })

  test('without CLAUDE_PLUGIN_DATA the reminders use a private per-user temp directory', () => {
    const tmp = scratchDir('odd-gate-tmp-')
    const e = { XDG_CONFIG_HOME: scratchDir('odd-gate-xdg-'), TMPDIR: tmp, CLAUDE_PLUGIN_DATA: '' }
    const repo = highRepo()
    assert.equal(gate(repo, e).json.decision, 'block')
    const dir = join(tmp, `construct-${process.getuid()}`)
    assert.ok(existsSync(join(dir, 'review-gate', 's1.json')))
    assert.equal(statSync(dir).mode & 0o077, 0, 'no group or other access')
    silent(gate(repo, e))
  })

  test('a fallback directory with group or other access is not trusted and the gate stays silent', () => {
    const tmp = scratchDir('odd-gate-tmp-')
    const dir = join(tmp, `construct-${process.getuid()}`)
    mkdirSync(dir, { mode: 0o777 })
    chmodSync(dir, 0o777)
    const e = { XDG_CONFIG_HOME: scratchDir('odd-gate-xdg-'), TMPDIR: tmp, CLAUDE_PLUGIN_DATA: '' }
    silent(gate(highRepo(), e))
    assert.equal(existsSync(join(dir, 'review-gate')), false)
  })

  test('a corrupt reminder file fails open and is left alone', () => {
    const e = env()
    const repo = highRepo()
    mkdirSync(join(e.CLAUDE_PLUGIN_DATA, 'review-gate'), { recursive: true })
    writeFileSync(reminderFile(e), '{broken')
    silent(gate(repo, e))
    assert.equal(readFileSync(reminderFile(e), 'utf8'), '{broken')
  })

  test('an unusable data directory fails open', () => {
    const blocker = join(scratchDir('odd-gate-blocker-'), 'file')
    writeFileSync(blocker, 'x')
    silent(gate(highRepo(), { ...env(), CLAUDE_PLUGIN_DATA: join(blocker, 'sub') }))
  })

  test('the gate never changes the repository or the review store', () => {
    const repo = highRepo()
    const before = git(repo, 'status', '--porcelain', '-uall') + head(repo)
    gate(repo, env())
    assert.equal(git(repo, 'status', '--porcelain', '-uall') + head(repo), before)
  })
})
