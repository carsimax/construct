// S6: the publication gate hook, driven as a real PreToolUse hook on Bash.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyFiles, captureAll, commitAll, git, highRepo, makeRepo, review, scratchDir, start } from '../review/helpers.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const HOOK = join(PLUGIN, 'hooks/scripts/publication-gate.mjs')

const env = () => ({ CLAUDE_PLUGIN_DATA: scratchDir('odd-pub-data-'), XDG_CONFIG_HOME: scratchDir('odd-pub-xdg-') })

function hook(command, cwd, e = env(), { input, tool_name = 'Bash' } = {}) {
  const result = spawnSync('node', [HOOK], {
    input: input ?? JSON.stringify({ session_id: 's1', cwd, hook_event_name: 'PreToolUse', tool_name, tool_input: { command } }),
    encoding: 'utf8',
    env: { ...process.env, ...e },
  })
  let json = null
  try {
    json = JSON.parse(result.stdout)
  } catch {
    // No output.
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json, decision: json?.hookSpecificOutput?.permissionDecision, reason: json?.hookSpecificOutput?.permissionDecisionReason }
}

// featureRepo: main holds the base commit; feat adds one committed high-risk unit.
function featureRepo() {
  const repo = highRepo()
  git(repo, 'checkout', '-q', '-b', 'feat')
  commitAll(repo, 'high-risk unit')
  return repo
}

const denied = (r) => {
  assert.equal(r.status, 0)
  assert.equal(r.decision, 'deny', r.stdout)
  assert.match(r.reason, /publication-gate/)
  assert.match(r.reason, /odd-review start/)
}
const silent = (r) => {
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
}

describe('registration', () => {
  test('hooks.json registers a Bash PreToolUse entry in exec form', () => {
    const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks/hooks.json'), 'utf8'))
    const entry = hooks.hooks.PreToolUse.find((e) => e.hooks.some((h) => h.args?.[0]?.endsWith('publication-gate.mjs')))
    assert.ok(entry)
    assert.equal(entry.matcher, 'Bash')
    assert.deepEqual(entry.hooks[0], { type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/publication-gate.mjs'], timeout: 30 })
  })
})

describe('publication commands are gated', () => {
  const repo = featureRepo()
  const cases = [
    'git push',
    'git push origin feat',
    'git push -u origin feat',
    'git push origin HEAD',
    'git push origin feat:feat',
    'git push origin +feat',
    'git push --force-with-lease origin feat',
    'git -c push.default=current push',
    'gh pr create --title t --body b',
    'gh pr create --base main --fill',
    'gh pr create -B main -t t',
    'gh -R owner/repo pr create',
    'gh release create v1.0.0 --notes hi',
    'gh release create v1.0.0 -t "Release one" -n notes dist.zip',
    'echo done && git push',
    'git status; git push origin feat',
    'sh -c "git push origin feat"',
    "bash -c 'git add -A && git push'",
    'sudo git push',
    'env GIT_SSH_COMMAND=ssh git push',
    'timeout 30 git push',
    'timeout --foreground 60 git push origin feat',
    'eval "git push"',
    'echo $(git push)',
    'FOO=1 git push',
  ]
  for (const command of cases) test(`denies: ${command}`, () => denied(hook(command, repo)))

  test('git -C names the repository, whatever the hook cwd is', () => {
    denied(hook(`git -C ${repo} push`, scratchDir('odd-pub-elsewhere-')))
    denied(hook(`git -C "${repo}" push origin feat`, scratchDir('odd-pub-elsewhere-')))
  })

  test('a cd before the command names the repository', () => {
    denied(hook(`cd ${repo} && git push`, scratchDir('odd-pub-elsewhere-')))
  })

  test('the reason names the gate', () => {
    assert.match(hook('git push', repo).reason, /pre-push/)
    assert.match(hook('gh pr create', repo).reason, /pre-pr/)
    assert.match(hook('gh release create v1', repo).reason, /release/)
  })
})

describe('other commands are untouched', () => {
  const repo = featureRepo()
  const cases = [
    'git status',
    'git pull',
    'git commit -m "git push later"',
    'git log --oneline',
    'git pushd',
    'echo git push',
    'grep "git push" README.md',
    "printf 'gh pr create'",
    'gh pr view 3',
    'gh pr list',
    'gh release list',
    'gh release view v1',
    'gh issue create',
    'git push --dry-run',
    'git push -n origin feat',
    'git push --delete origin old',
    'git push origin :old',
    'ls',
    '',
  ]
  for (const command of cases) test(`silent: ${JSON.stringify(command)}`, () => silent(hook(command, repo)))

  test('a heredoc body is data', () => {
    silent(hook("cat <<'EOF'\ngit push\ngh pr create\nEOF", repo))
  })

  test('other tools', () => {
    silent(hook('git push', repo, env(), { tool_name: 'Read' }))
  })
})

describe('allows when nothing is due, RDD is off, or a receipt covers the range', () => {
  test('RDD off', () => {
    const e = env()
    const repo = featureRepo()
    review(repo, ['mode', 'disable'], { env: e })
    silent(hook('git push', repo, e))
  })

  test('a passive change', () => {
    const repo = makeRepo({ 'src/app.js': 'export const a = 1\n' })
    git(repo, 'checkout', '-q', '-b', 'feat')
    applyFiles(repo, { 'docs/note.md': 'a note\n' })
    commitAll(repo, 'docs')
    silent(hook('git push', repo))
    silent(hook('gh pr create', repo))
  })

  test('an approved receipt for the published tree', () => {
    const e = env()
    const repo = featureRepo()
    const txn = start(repo, { args: ['--base-ref', 'main', '--committed-only'] })
    captureAll(repo, txn)
    assert.equal(review(repo, ['acknowledge', '--lineage', txn.lineage], { env: e }).status, 0)
    silent(hook('git push', repo, e))
    silent(hook('gh pr create', repo, e))
    silent(hook('gh release create v1', repo, e))
  })

  test('a push of a branch that is not the checked-out one is judged by its own range', () => {
    const repo = makeRepo({ 'src/app.js': 'export const a = 1\n' })
    git(repo, 'checkout', '-q', '-b', 'quiet')
    git(repo, 'checkout', '-q', '-b', 'feat')
    applyFiles(repo, { 'scripts/build.sh': 'echo hi\n' })
    commitAll(repo, 'high')
    silent(hook('git push origin quiet', repo))
    denied(hook('git push origin feat', repo))
  })
})

// B1: a source ref the hook cannot read is judged as HEAD, never passed through to fail with bad_ref.
describe('an unreadable push source is judged as HEAD', () => {
  const repo = featureRepo()
  const cases = [
    'git push -u origin "$(git branch --show-current)"',
    'git push origin "$BRANCH"',
    'git push origin `git branch --show-current`',
    'git push origin "$(git branch --show-current):feat"',
    'git push origin no-such-branch',
    'git push origin no-such-branch:feat',
  ]
  for (const command of cases) test(`denies: ${command}`, () => denied(hook(command, repo)))

  test('the same refs allow when HEAD is not due', () => {
    const quiet = makeRepo({ 'src/app.js': 'export const a = 1\n' })
    git(quiet, 'checkout', '-q', '-b', 'feat')
    applyFiles(quiet, { 'docs/note.md': 'a note\n' })
    commitAll(quiet, 'docs')
    silent(hook('git push -u origin "$(git branch --show-current)"', quiet))
    silent(hook('git push origin no-such-branch', quiet))
  })

  test('a bad_ref from the CLI is retried against HEAD, so it cannot allow what HEAD would deny', () => {
    // A tag named like a branch does not resolve as a commit-less ref; the source below is a
    // blob ref, which `rev-parse ^{commit}` rejects, so only the HEAD retry can decide.
    const blob = git(repo, 'rev-parse', 'HEAD:src/app.js').trim()
    denied(hook(`git push origin ${blob}`, repo))
  })
})

describe('the hook fails open', () => {
  test('not a repository', () => silent(hook('git push', scratchDir('odd-pub-norepo-'))))
  test('unreadable input', () => {
    silent(hook('', '', env(), { input: 'not json' }))
    silent(hook('', '', env(), { input: '' }))
  })
  test('a missing destination repository is not a denial when nothing is due', () => silent(hook('git push origin quiet', makeRepo({ 'src/app.js': 'export const a = 1\n' }))))
  test('a missing cwd', () => silent(hook('git push', undefined, env(), { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push' } }) })))
})

// T13 (F1, F2): the same unwrapping as command-guard, and unresolvable target directories.
describe('shell wrappers are unwrapped like command-guard', () => {
  const repo = featureRepo()
  const cases = [
    "bash -c -- 'git push origin feat'",
    'sh -c -- "git push origin feat"',
    'env -S "git push origin feat"',
    'env --split-string="git push origin feat"',
    'env -S"git push origin feat"',
    'echo `git push origin feat`',
  ]
  for (const command of cases) test(`denies: ${command}`, () => denied(hook(command, repo)))
})

describe('target directories', () => {
  const repo = featureRepo()
  const home = scratchDir('odd-pub-home-')
  const homed = join(home, 'work')
  spawnSync('cp', ['-R', repo, homed])
  const hh = () => ({ ...env(), HOME: home })
  const elsewhere = () => scratchDir('odd-pub-elsewhere-')

  test('~, $HOME, and ${HOME} expand from HOME', () => {
    denied(hook('cd ~/work && git push', elsewhere(), hh()))
    denied(hook('git -C ~/work push', elsewhere(), hh()))
    denied(hook('git -C "$HOME/work" push', elsewhere(), hh()))
    denied(hook('git -C "${HOME}/work" push', elsewhere(), hh()))
  })

  test('another variable or substitution is denied with a literal-path reason', () => {
    for (const command of ['git -C "$REPO" push', 'git -C "$(pwd)" push', 'git -C `pwd` push', 'git -C $(pwd) push', 'cd `pwd` && git push', 'cd "$REPO" && git push', 'cd "$(pwd)"; git push origin feat']) {
      const r = hook(command, repo)
      assert.equal(r.status, 0)
      assert.equal(r.decision, 'deny', command)
      assert.match(r.reason, /publication-gate/)
      assert.match(r.reason, /literal/)
    }
  })

  test('an unresolvable directory does not deny a command that publishes nothing', () => {
    silent(hook('git -C "$REPO" status', repo))
    silent(hook('git -C "$REPO" push --dry-run', repo))
    silent(hook('cd "$REPO" && git log', repo))
  })

  test('a literal directory that does not exist keeps the allow', () => {
    silent(hook('git -C /nonexistent/odd-pub-dir push', repo))
    silent(hook('cd /nonexistent/odd-pub-dir && git push', repo))
  })

  test('nothing due still allows a home-relative directory', () => {
    const clean = makeRepo()
    const cleanHome = scratchDir('odd-pub-home-')
    spawnSync('cp', ['-R', clean, join(cleanHome, 'work')])
    silent(hook('git -C ~/work push', elsewhere(), { ...env(), HOME: cleanHome }))
  })
})

// T14: substitution spans are scanned with quote state, so a quoted `)` or backtick does not end one early.
describe('quoted delimiters inside substitutions do not hide a later push', () => {
  const repo = featureRepo()
  const cases = [
    "echo $(echo ')'); git push origin feat",
    'echo $(echo "a)b"); git push origin feat',
    "echo `echo ')'`; git push origin feat",
    "echo $(echo $(echo ')')); git push origin feat",
    "echo $(echo \\)); git push origin feat",
    'echo $(echo foo; git push origin feat',
    "echo $(echo ')'; git push origin feat",
  ]
  for (const command of cases) test(`denies: ${command}`, () => denied(hook(command, repo)))

  test('a substitution directory with a quoted paren is still unresolvable', () => {
    const r = hook("git -C $(echo ')') push origin feat", repo)
    assert.equal(r.decision, 'deny')
    assert.match(r.reason, /literal/)
  })
})
