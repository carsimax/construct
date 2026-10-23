// S1: the command guard hook, driven as a real PreToolUse hook on Bash: deny for verifier bypasses,
// ask for destructive commands, silence for everything else.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const HOOK = join(new URL('../../plugins/construct/', import.meta.url).pathname, 'hooks/scripts/command-guard.mjs')

function run(command, { input, tool_name = 'Bash' } = {}) {
  const result = spawnSync('node', [HOOK], {
    input: input ?? JSON.stringify({ session_id: 's1', cwd: process.cwd(), hook_event_name: 'PreToolUse', tool_name, tool_input: { command } }),
    encoding: 'utf8',
  })
  let json = null
  try {
    json = JSON.parse(result.stdout)
  } catch {
    // No output.
  }
  return { status: result.status, stdout: result.stdout, decision: json?.hookSpecificOutput?.permissionDecision, reason: json?.hookSpecificOutput?.permissionDecisionReason, event: json?.hookSpecificOutput?.hookEventName }
}

const expect = (decision, commands) => {
  for (const command of commands) {
    test(`${decision}: ${command}`, () => {
      const r = run(command)
      assert.equal(r.status, 0)
      assert.equal(r.decision, decision, r.stdout)
      assert.equal(r.event, 'PreToolUse')
      assert.match(r.reason, /^command-guard: .+\./)
      assert.equal(r.stdout.trim().split('\n').length, 1)
    })
  }
}
const silent = (commands) => {
  for (const command of commands) {
    test(`allow: ${command}`, () => {
      const r = run(command)
      assert.equal(r.status, 0)
      assert.equal(r.stdout, '')
    })
  }
}

describe('deny: verifier bypasses', () => {
  expect('deny', [
    'git commit --no-verify -m x',
    'git commit -n -m x',
    'git commit -anm x',
    'git push --no-verify',
    'git commit --no-gpg-sign -m x',
    'git -c core.hooksPath=/dev/null commit -m x',
    'git -c core.hookspath=. status',
    'git --config-env=core.hooksPath=X status',
    'git add . && git commit -n -m x',
    "bash -c 'git commit --no-verify'",
    'echo $(git commit -n -m x)',
    'git -C some/dir commit --no-verify',
    'FOO=1 sudo git commit -n',
    'eval "git commit -n"',
    'git commit -n -m x # hi',
  ])
  test('deny wins over ask in one command', () => {
    const r = run('rm -rf build && git commit --no-verify -m x')
    assert.equal(r.decision, 'deny')
    assert.match(r.reason, /no-verify/)
  })
})

describe('T6 corrections: deny', () => {
  expect('deny', [
    'git commit --no-verif -m x',
    'git commit --no-ver -m x',
    'git push --no-ve',
    'git commit --no-gpg -m x',
    'GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m x',
    'GIT_CONFIG_KEY_3=CORE.HOOKSPATH git status',
    "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\" git commit -m x",
  ])
})

describe('T6 corrections: ask', () => {
  expect('ask', [
    'git reset --har HEAD~1',
    'git push --forc',
    'git push --force --force-with-lease --no-force-with-lease',
    'git push -f --force-with-lease --no-force-with-lease origin main',
    'git push origin +main --force-with-lease --no-force-with-lease',
    'git clean --forc',
    'git checkout ./',
    'git checkout :/',
    'git checkout -- ./',
    'git checkout -- :/',
    'git restore -SW .',
    'git restore --staged --worktree .',
  ])
})

describe('T6 corrections: allowed', () => {
  silent([
    'git push --force-w',
    'git push --force-with-lea origin main',
    'git push --no-force-with-lease --force-with-lease -f',
    'git restore -S .',
    'git restore --staged .',
    'git commit --no-edit -m x',
    'git commit --no-v',
    'git checkout -- ./file',
    'GIT_CONFIG_KEY_0=user.name git status',
  ])
})

describe('ask: destructive commands', () => {
  expect('ask', [
    'rm -rf build',
    'rm -fr build',
    'rm -r -f build',
    'rm --recursive --force build',
    'sudo rm -Rf /tmp/x',
    'git push --force',
    'git push -f origin main',
    'git push origin +main',
    'git push -uf origin main',
    'git reset --hard HEAD~1',
    'git clean -fd',
    'git clean --force',
    'git checkout -- .',
    'git restore .',
    'git restore --worktree .',
    "sh -c 'rm -rf x'",
    'git -C d reset --hard',
  ])
})

describe('debt-round S3: find and xargs deletes', () => {
  expect('ask', [
    'find . -name x -exec rm -rf {} \\;',
    'find . -exec rm -rf {} +',
    'find /tmp/x -execdir rm -fr {} \\;',
    'find . -type f -delete',
    'ls | xargs rm -rf',
    'xargs -0 rm -rf < list',
    'bash -c "find . -delete"',
    'ls | xargs -i rm -rf {}',
    'ls | xargs -J % rm -rf %',
    'ls | xargs -n 1 rm -rf',
    'find . -exec sudo rm -rf {} \\;',
    'find . -exec /bin/rm -rf {} +',
    'find . -exec env rm -rf {} \\;',
    `find . -exec sh -c 'rm -rf "$1"' _ {} \\;`,
    'xargs --replace rm -rf {}',
    'xargs -R 2 -I {} rm -rf {}',
    'find . -exec rm -rf {} \\; -o -exec rm -rf {} +',
  ])
  silent(['find . -name -delete', 'find . -exec rm -f {} \\;', 'find . -exec echo rm -rf {} \\;', 'xargs --max-chars 100 echo', 'ls | xargs -I {} echo {}', "find . -name '*.js'",'find . -exec grep x {} \\;', 'xargs rm a.txt', 'ls | xargs echo'])
})

describe('pending-round S1: git restore at the root', () => {
  expect('ask', ['git restore ./', 'git restore :/', 'git restore -- ./', 'git restore -- :/', 'git restore --worktree :/', 'git restore -s HEAD :/'])
  silent(['git restore --staged ./', 'git restore -S :/', 'git restore --staged :/', 'git restore --staged -- ./ :/'])
})

describe('pending-round S2: exported hooks-path config', () => {
  expect('deny', [
    "export GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\"; git commit -m x",
    'export GIT_CONFIG_KEY_0=core.hooksPath',
    'declare -x GIT_CONFIG_KEY_1=core.hooksPath',
    'typeset -x GIT_CONFIG_KEY_2=core.hooksPath',
    "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=x'\"; git push",
    'readonly GIT_CONFIG_KEY_0=core.hooksPath; export GIT_CONFIG_KEY_0 GIT_CONFIG_COUNT=1 GIT_CONFIG_VALUE_0=/dev/null; git commit -m x',
    'local -x GIT_CONFIG_KEY_0=core.hooksPath',
    "sh -c 'declare -x GIT_CONFIG_KEY_0=core.hooksPath && git commit'",
  ])
  silent(["export GIT_CONFIG_PARAMETERS=\"'user.name=x'\"", 'export FOO=core.hooksPath', 'echo GIT_CONFIG_KEY_0=core.hooksPath', 'readonly PATH'])
})

describe('allowed', () => {
  silent([
    'git push --force-with-lease',
    'git push --force-with-lease=main origin main',
    'git commit -m "--no-verify"',
    "git commit -m 'fix -n handling'",
    'git commit -mn',
    'git push -n',
    'git push origin main',
    'git reset --soft HEAD~1',
    'git clean -n',
    'git restore --staged .',
    'git restore file.txt',
    'git checkout -- file.txt',
    'git status',
    'git -c user.name=x commit -m y',
    'rm -r build',
    'rm -f file',
    'rm file',
    'echo "rm -rf x"',
    "echo 'git commit --no-verify'",
    'ls',
  ])
  test('non-Bash tool produces no output', () => {
    const r = run('git commit -n', { tool_name: 'Write' })
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '')
  })
  test('bad JSON produces no output', () => {
    const r = run('', { input: '{nope' })
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '')
  })
  test('missing command produces no output', () => {
    const r = run('', { input: JSON.stringify({ tool_name: 'Bash', tool_input: {} }) })
    assert.equal(r.stdout, '')
  })
})

describe('registration (S5)', () => {
  test('hooks.json registers command-guard on Bash in exec form, failing open', async () => {
    const { readFileSync } = await import('node:fs')
    const hooks = JSON.parse(readFileSync(join(HOOK, '../../hooks.json'), 'utf8')).hooks
    const group = hooks.PreToolUse.find((g) => g.hooks.some((h) => h.args?.[0].endsWith('command-guard.mjs')))
    assert.ok(group)
    assert.equal(group.matcher, 'Bash')
    const entry = group.hooks.find((h) => h.args?.[0].endsWith('command-guard.mjs'))
    assert.deepEqual(entry, { type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/command-guard.mjs'], timeout: 10 })
    assert.equal(entry.onFailure, undefined)
  })
})
