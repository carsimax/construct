// odd-verify A3, A4 (S1): wrapper grammars, continuation lines, and npm flags with values,
// driven through the real secret-guard hook entry.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { scratchDir } from '../assess/helpers.mjs'
import { headIndex } from '../../plugins/construct/hooks/scripts/command-guard.mjs'
import { splitCommands } from '../../plugins/construct/hooks/scripts/shell-words.mjs'

const SCRIPT = new URL('../../plugins/construct/hooks/scripts/secret-guard.mjs', import.meta.url).pathname
const home = scratchDir('wrapgap-home-')
const cwd = join(scratchDir('wrapgap-work-'), 'proj')
mkdirSync(cwd, { recursive: true })

function verdict(command) {
  const r = spawnSync('node', [SCRIPT], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }), encoding: 'utf8', env: { ...process.env, HOME: home } })
  assert.equal(r.status, 0)
  if (!r.stdout) return 'allow'
  return JSON.parse(r.stdout).hookSpecificOutput.permissionDecision
}

describe('A3: wrappers hide nothing', () => {
  for (const c of [
    'timeout -k 2 5 git reset --hard',
    'timeout --foreground 5 git reset --hard',
    'timeout -s KILL 5 git reset --hard',
    'timeout --kill-after=2 --signal=KILL 5 git reset --hard',
    'timeout 5 git reset --hard',
    'nice -n 5 git reset --hard',
    'nice -5 git reset --hard',
    'sudo -u root git reset --hard',
    'sudo --user root git reset --hard',
    'env -u HOME git reset --hard',
    'env -i FOO=1 git reset --hard',
    'env -S "git reset --hard"',
    "env -S'git reset --hard'",
    'env --split-string="git reset --hard"',
    'env -u X -S "git reset --hard"',
    'env -S "FOO=1 git reset --hard" extra',
    "bash -c -- 'git reset --hard'",
    "sh -ec -- 'git reset --hard'",
    'bash --norc -c "git reset --hard"',
    'git reset \\\n--hard',
    'git push \\\n  --force',
    'git \\\nreset --hard',
    'timeout -k 2 5 nice -n 3 env -u A sudo -u b git reset --hard',
  ]) {
    test(c, () => assert.equal(verdict(c), 'deny'))
  }
  test('wrapped ask-tier command still asks', () => {
    assert.equal(verdict('timeout -k 2 5 git rebase main'), 'ask')
    assert.equal(verdict('env -S "git push origin main"'), 'ask')
  })
  for (const c of ['timeout -k 2 5 git status', 'env -S "git status"', "bash -c -- 'git status'", 'nice -n 5 ls', 'git status \\\n-s', 'env -u A ls']) {
    test(`stays allowed: ${c}`, () => assert.equal(verdict(c), 'allow'))
  }
  test('env -S with a non-command payload stays allowed (data, not a command)', () => {
    assert.equal(verdict('env -S "echo git reset --hard"'), 'allow')
  })
  test('headIndex skips wrapper flags, their values, and the timeout duration', () => {
    assert.equal(headIndex(['timeout', '-k', '2', '--foreground', '5', 'git']), 5)
    assert.equal(headIndex(['nice', '-n', '5', 'git']), 3)
    assert.equal(headIndex(['sudo', '-u', 'me', 'git']), 3)
    assert.equal(headIndex(['env', '-u', 'A', 'B=1', 'git']), 4)
  })
  test('a backslash-newline joins before tokenizing, and stays inside a word when the word continues', () => {
    assert.deepEqual(splitCommands('git \\\nreset --hard').map((w) => w.map((x) => x.t)), [['git', 'reset', '--hard']])
    assert.deepEqual(splitCommands('gi\\\nt status').map((w) => w.map((x) => x.t)), [['git', 'status']])
    assert.deepEqual(splitCommands('echo "a\\\nb"').map((w) => w.map((x) => x.t)), [['echo', 'ab']])
    assert.deepEqual(splitCommands("echo 'a\\\nb'").map((w) => w.map((x) => x.t)), [['echo', 'a\\\nb']])
  })
})

describe('A4: npm publish after flags with values', () => {
  for (const c of [
    'npm --access public publish',
    'npm --registry https://r.example publish',
    'npm --registry=https://r.example publish',
    'npm --otp 123456 --tag next publish',
    'npm -w pkg publish',
    'npm --workspace pkg publish',
    'npm --prefix dir publish',
    'sudo npm --access public publish',
    'timeout 60 npm --access public publish',
  ]) {
    test(c, () => assert.equal(verdict(c), 'deny'))
  }
  for (const c of ['npm run publish-docs', 'npm run publish', 'npm --prefix dir install', 'npm --registry x view pkg', 'npm pack']) {
    test(`stays allowed: ${c}`, () => assert.equal(verdict(c), 'allow'))
  }
  test('git checkout ., git switch -f stay as before (upstream does not treat them as data loss)', () => {
    assert.equal(verdict('git checkout .'), 'allow')
    assert.equal(verdict('git switch -f main'), 'allow')
    assert.equal(verdict('git checkout -- .'), 'ask')
    assert.equal(verdict('git restore .'), 'ask')
  })
})
