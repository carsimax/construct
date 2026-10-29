// S6: the review store write guard, driven as a real PreToolUse hook.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeRepo, scratchDir } from '../helpers/repo.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const HOOK = join(PLUGIN, 'hooks/scripts/review-store-guard.mjs')

function hook(tool_name, tool_input, cwd, input) {
  const result = spawnSync('node', [HOOK], { input: input ?? JSON.stringify({ cwd, hook_event_name: 'PreToolUse', tool_name, tool_input }), encoding: 'utf8' })
  let json = null
  try {
    json = JSON.parse(result.stdout)
  } catch {
    // No output.
  }
  return { status: result.status, stdout: result.stdout, decision: json?.hookSpecificOutput?.permissionDecision, reason: json?.hookSpecificOutput?.permissionDecisionReason }
}

const repo = makeRepo({ 'a.txt': 'a\n' })
const store = join(repo, '.git', 'construct-review')
const denied = (r) => {
  assert.equal(r.status, 0)
  assert.equal(r.decision, 'deny', r.stdout)
  assert.match(r.reason, /written only by the review hooks/)
}
const silent = (r) => {
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
}

describe('review-store-guard', () => {
  test('hooks.json registers it in exec form for the file tools (Bash runs it inside bash-guard)', () => {
    const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks/hooks.json'), 'utf8')).hooks
    const entry = hooks.PreToolUse.find((g) => g.hooks.some((h) => h.args?.[0].endsWith('review-store-guard.mjs')))
    assert.equal(entry.matcher, 'Write|Edit|MultiEdit|NotebookEdit')
    assert.deepEqual(entry.hooks[0], { type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/review-store-guard.mjs'], timeout: 10 })
  })

  test('a file tool inside the store is denied, even before the store exists', () => {
    for (const tool of ['Write', 'Edit', 'MultiEdit']) denied(hook(tool, { file_path: join(store, 'verdicts', 's', 'review-risk.json') }, repo))
    denied(hook('NotebookEdit', { notebook_path: join(store, 'n.ipynb') }, repo))
    denied(hook('Write', { file_path: '.git/construct-review/verdicts/x.json' }, repo))
    denied(hook('Write', { file_path: join(store, '..', 'construct-review', 'x') }, repo))
  })

  test('a file tool outside the store is allowed', () => {
    silent(hook('Write', { file_path: join(repo, 'a.txt') }, repo))
    silent(hook('Edit', { file_path: join(repo, '.git', 'construct-review-notes') }, repo))
    silent(hook('Write', { file_path: join(store, '..', 'config') }, repo))
  })

  test('a Bash command naming the store is denied, others pass', () => {
    denied(hook('Bash', { command: `echo '{}' > ${store}/verdicts/x.json` }, repo))
    denied(hook('Bash', { command: 'cat .git/construct-review/pending/x' }, repo))
    silent(hook('Bash', { command: 'git status' }, repo))
  })

  test('review-capture and review-context named in a Bash command are denied (F2)', () => {
    denied(hook('Bash', { command: 'echo \'{}\' | node "$CLAUDE_PLUGIN_ROOT/hooks/scripts/review-capture.mjs"' }, repo))
    denied(hook('Bash', { command: 'node plugins/construct/hooks/scripts/review-context.mjs < in.json' }, repo))
    denied(hook('Bash', { command: 'NODE review-CAPTURE.mjs' }, repo))
  })

  test('commands that only name the hook files as data are allowed (B1)', () => {
    for (const command of [
      'grep -rn review-context plugins',
      'git diff d09ceba -- plugins/construct/hooks/scripts/review-capture.mjs',
      "git commit -m 'fix(review-capture): x'",
      'git add src/review-context.tsx',
      'cat plugins/construct/hooks/scripts/review-context.mjs | wc -l',
      'node --test tests/review-hooks/review-capture.test.mjs',
      "sed -n 1,5p plugins/construct/hooks/scripts/review-capture.mjs",
    ]) {
      silent(hook('Bash', { command }, repo))
      silent(hook('Bash', { command }, scratchDir('odd-guard-norepo-')))
    }
  })

  test('running a review hook through an interpreter is denied in any directory (B1)', () => {
    for (const command of [
      'node plugins/construct/hooks/scripts/review-capture.mjs',
      'echo {} | node /p/hooks/scripts/review-capture.mjs',
      'bash -c "node /p/hooks/scripts/review-context.mjs"',
      '/p/hooks/scripts/review-capture.mjs',
      'env FOO=1 bun /p/hooks/scripts/review-context.mjs',
      'cd x && deno run review-capture.mjs',
    ]) {
      denied(hook('Bash', { command }, repo))
      denied(hook('Bash', { command }, scratchDir('odd-guard-norepo-')))
    }
  })

  test('quotes, backslashes, and brackets do not hide the names (F3)', () => {
    for (const command of ['cat .git/construct"-"review/x', 'cat .git/construct-revie[w]/x', 'cat .git/construct\\-review/x', "node review'-'capture.mjs", 'node review-conte[x]t.mjs']) {
      denied(hook('Bash', { command }, repo))
    }
  })

  test('the store is found whatever the case of its path', () => {
    denied(hook('Write', { file_path: join(repo, '.git', 'CONSTRUCT-REVIEW', 'verdicts', 'x.json') }, repo))
    denied(hook('Write', { file_path: '.git/Construct-Review/x' }, repo))
    denied(hook('Bash', { command: 'cat .git/CONSTRUCT-REVIEW/pending/x' }, repo))
  })

  test('it fails open outside a git repository, on unreadable input, and for other tools', () => {
    silent(hook('Write', { file_path: '/x/.git/construct-review/a' }, scratchDir('odd-guard-norepo-')))
    silent(hook('Write', {}, repo, 'not json'))
    silent(hook('Write', {}, repo))
    silent(hook('Read', { file_path: join(store, 'x') }, repo))
  })
})

describe('harness-audit S3: nesting past the depth cap', () => {
  const shellQuote = (t) => `'${t.replace(/'/g, `'\\''`)}'`
  const nest = (command, layers) => Array.from({ length: layers }).reduce((c) => `sh -c ${shellQuote(c)}`, command)
  test('a review hook run nested six layers deep is denied', () => {
    const r = hook('Bash', { command: nest('node review-capture.mjs', 6) }, repo)
    assert.equal(r.decision, 'deny', r.stdout)
    assert.match(r.reason, /nest more than 4 levels/)
  })
  test('three layers of a harmless command pass', () => silent(hook('Bash', { command: nest('ls', 3) }, repo)))
})
