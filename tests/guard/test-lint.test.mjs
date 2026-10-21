// S7(c): delivered-test lint, driven through the real secret-guard hook.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { scratchDir } from '../assess/helpers.mjs'

const SCRIPT = new URL('../../plugins/construct/hooks/scripts/secret-guard.mjs', import.meta.url).pathname
const home = scratchDir('lint-home-')
// Not a git repository, so write-scope has no repository to enforce and the lint is what is under test.
const cwd = scratchDir('lint-cwd-')

function run(tool_name, tool_input, extra = {}) {
  const r = spawnSync('node', [SCRIPT], { input: JSON.stringify({ session_id: 's', cwd, tool_name, tool_input, ...extra }), encoding: 'utf8', env: { ...process.env, HOME: home } })
  let json = null
  try {
    json = JSON.parse(r.stdout)
  } catch {
    // allowed
  }
  return { status: r.status, stdout: r.stdout, json }
}
const denied = (r, ...needles) => {
  assert.equal(r.status, 0)
  assert.equal(r.json?.hookSpecificOutput?.permissionDecision, 'deny', r.stdout)
  for (const n of needles) assert.match(r.json.hookSpecificOutput.permissionDecisionReason, n)
}
const allowed = (r) => {
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
}
const write = (file_path, content) => run('Write', { file_path, content })

describe('git history at a literal commit', () => {
  for (const command of ['git show abc1234:src/a.js', 'git checkout 3f2a9c1d4e5b', 'git diff 0123456789abcdef0123456789abcdef01234567 HEAD', 'git cat-file -p deadbeef1', 'git archive a1b2c3d4 | tar x']) {
    test(`denies ${command}`, () => {
      denied(write('tests/a.test.mjs', `execSync('${command}')\n`), /reads git history at a fixed commit/, /any clone/)
    })
  }
  test('the reason names the path and the command', () => {
    denied(write('tests/a.test.mjs', 'git show abc1234'), /tests\/a\.test\.mjs/, /git show abc1234/)
  })
  test('refs, HEAD, and words that are not commit ids are allowed', () => {
    allowed(write('tests/a.test.mjs', 'git show HEAD:a\ngit checkout main\ngit diff HEAD~1\ngit show deadbeef\ngit show 1234567\ngit show feat/branch'))
  })
})

describe('TMPDIR inside the repository', () => {
  for (const line of ['TMPDIR=.tmp npm test', "process.env.TMPDIR = './scratch'", "env: { TMPDIR: 'tmp/x' }", 'TMPDIR="$PWD/tmp"', 'TMPDIR=${PWD}/t', 'TMPDIR=$(pwd)/t', 'TMPDIR: process.cwd() + "/t"', "TMPDIR: join(__dirname, 'x')", "os.environ['TMPDIR'] = os.getcwd()", 'TMPDIR=../x']) {
    test(`denies ${line}`, () => {
      denied(write('tests/b.test.mjs', line), /points TMPDIR inside the working directory/, /mktemp/)
    })
  }
  test('absolute, home, variable, bare word, comparison are allowed', () => {
    allowed(write('tests/b.test.mjs', ['TMPDIR=/var/tmp/x', 'TMPDIR=~/t', 'TMPDIR=$HOME/t', 'TMPDIR="$(mktemp -d)"', 'TMPDIR: os.tmpdir()', 'TMPDIR: scratch', 'if (TMPDIR == ".tmp") {}'].join('\n')))
  })
})

describe('what is judged', () => {
  const bad = 'git show abc1234'
  test('test paths by directory, suffix, Go and Python conventions', () => {
    for (const path of ['test/x.js', 'tests/x.js', '__tests__/x.js', 'spec/x.rb', 'src/a.test.ts', 'src/a.spec.jsx', 'a_test.go', 'pkg/test_a.py', 'src/tests/deep/x.txt']) denied(write(path, bad), /fixed commit/)
  })
  test('non-test paths are untouched', () => {
    for (const path of ['src/a.js', 'docs/git.md', 'src/contest/x.js', 'latest.js', 'src/test_helper_notes/x.js', 'a_test.go.txt']) allowed(write(path, bad))
  })
  test('an absolute path inside the cwd is judged by its relative part', () => {
    denied(write(join(cwd, 'tests/a.js'), bad), /fixed commit/)
    allowed(write(join(cwd, 'src/a.js'), bad))
  })
  test('Edit judges new_string, MultiEdit every new_string; old_string is ignored', () => {
    denied(run('Edit', { file_path: 'tests/a.js', old_string: 'x', new_string: bad }), /fixed commit/)
    allowed(run('Edit', { file_path: 'tests/a.js', old_string: bad, new_string: 'x' }))
    denied(run('MultiEdit', { file_path: 'tests/a.js', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: bad }] }), /fixed commit/)
    allowed(run('MultiEdit', { file_path: 'tests/a.js', edits: [{ old_string: bad, new_string: 'b' }] }))
  })
  test('other tools and missing content are untouched', () => {
    allowed(run('Read', { file_path: 'tests/a.js' }))
    allowed(run('NotebookEdit', { notebook_path: 'tests/a.ipynb', new_source: bad }))
    allowed(run('Write', { file_path: 'tests/a.js' }))
    allowed(write('tests/a.js', 'plain content'))
  })
  test('a subagent write is linted too', () => {
    denied(run('Write', { file_path: 'tests/a.js', content: bad }, { agent_id: 'a1', agent_type: 'general-purpose' }), /fixed commit/)
  })
})
