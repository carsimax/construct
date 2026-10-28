// S2, S6: the publication gate hook, driven as a real PreToolUse hook on Bash: it decides from the
// Risk column of the feature documents the branch changed and the verdicts in the review store.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyFiles, commitAll, git, makeRepo, scratchDir } from '../helpers/repo.mjs'
import { readVerdicts, subjectHash, writeVerdict } from '../../plugins/construct/hooks/scripts/review-store.mjs'

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

const TABLE = (risk) => `# Feature\n\n## Tasks\n\n| ID | Specs | Task | Route | Risk | Status | Commit |\n|---|---|---|---|---|---|---|\n| T1 | S1 | work | worker | ${risk} | done | \`abc\` |\n\n## Log\n\n- 1 | none | x\n`

// featureRepo: main holds the base commit; feat adds one committed unit whose feature document has the given Risk cell.
function featureRepo(risk = '2') {
  const repo = makeRepo({ 'src/app.js': 'export const a = 1\n' })
  git(repo, 'checkout', '-q', '-b', 'feat')
  applyFiles(repo, { 'odd/tasks/f.md': TABLE(risk), 'src/app.js': 'export const a = 2\n' })
  commitAll(repo, 'unit')
  return repo
}

// withRemote gives the repository an origin (a bare clone) and fetches it, so origin/main exists.
function withRemote(repo) {
  const bare = join(scratchDir('odd-pub-remote-'), 'origin.git')
  git(repo, 'clone', '-q', '--bare', repo, bare)
  git(repo, 'remote', 'add', 'origin', bare)
  git(repo, 'fetch', '-q', 'origin')
  git(repo, 'remote', 'set-head', 'origin', 'main')
  return repo
}

// subjectOf is the review subject of the checked-out branch against main.
const subjectOf = (repo) => subjectHash(git(repo, 'rev-parse', 'main^{tree}').trim(), git(repo, 'rev-parse', 'HEAD^{tree}').trim())
const approve = (repo, lens, subject = subjectOf(repo), approved = true) => writeVerdict(repo, { lens, subject_hash: subject, approved, at: Date.now(), result: {} })

const denied = (r) => {
  assert.equal(r.status, 0)
  assert.equal(r.decision, 'deny', r.stdout)
  assert.match(r.reason, /publication-gate/)
  assert.match(r.reason, /review-risk/)
  assert.match(r.reason, /construct:review/)
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
    assert.deepEqual(entry.hooks[0], { type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/publication-gate.mjs'], timeout: 30, onFailure: 'block' })
  })

  test('hooks.json registers no secret-guard hook', () => {
    const text = readFileSync(join(PLUGIN, 'hooks/hooks.json'), 'utf8')
    assert.ok(!text.includes('secret-guard.mjs'))
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
    'gh release create v1.0.0 --notes hi --target HEAD',
    'gh release create v1.0.0 -t "Release one" -n notes dist.zip --target HEAD',
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

  test('the reason names the gate, the subject line, and the skill', () => {
    assert.match(hook('git push', repo).reason, /pre-push/)
    assert.match(hook('gh pr create', repo).reason, /pre-pr/)
    assert.match(hook('gh release create v1 --target HEAD', repo).reason, /release/)
    const mergeBase = git(repo, 'merge-base', 'main', 'HEAD').trim()
    assert.match(hook('git push', repo).reason, new RegExp(`Review subject: ${mergeBase}`))
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
    "printf '%s' 'a `git push origin vX` b'",
    `printf '%s' '{"content":"see \`git push origin vX.Y.Z\`"}' | construct-memory save`,
    "echo '$(git push origin vX)'",
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

describe('the decision follows the Risk items and the verdicts', () => {
  test('only none risks allow', () => {
    const repo = featureRepo('none')
    silent(hook('git push', repo))
    silent(hook('gh pr create', repo))
  })

  test('a branch without a feature document allows', () => {
    const repo = makeRepo({ 'src/app.js': 'export const a = 1\n' })
    git(repo, 'checkout', '-q', '-b', 'feat')
    applyFiles(repo, { 'src/app.js': 'export const a = 2\n' })
    commitAll(repo, 'code')
    silent(hook('git push', repo))
  })

  test('Risk 2 without a verdict is denied, naming review-risk', () => {
    const r = hook('git push', featureRepo('2'))
    denied(r)
    assert.match(r.reason, /no verdict from review-risk/)
    assert.doesNotMatch(r.reason, /review-reliability/)
  })

  test('cells read an integer or a comma list at the start: "3 (text)" and "1, 3"', () => {
    assert.match(hook('git push', featureRepo('3 (contract text)')).reason, /review-reliability/)
    const r = hook('git push', featureRepo('1, 3'))
    assert.match(r.reason, /review-reliability, review-resilience, review-risk/)
  })

  test('an approved verdict for the exact subject allows, every required lens needed', () => {
    const repo = featureRepo('1')
    approve(repo, 'review-risk')
    const partial = hook('git push', repo)
    assert.equal(partial.decision, 'deny')
    assert.match(partial.reason, /no verdict from review-resilience/)
    approve(repo, 'review-resilience')
    silent(hook('git push', repo))
    silent(hook('gh pr create', repo))
    silent(hook('gh release create v1 --target HEAD', repo))
  })

  test('a verdict for an older subject is not enough after a new commit', () => {
    const repo = featureRepo('2')
    approve(repo, 'review-risk')
    silent(hook('git push', repo))
    applyFiles(repo, { 'src/app.js': 'export const a = 3\n' })
    commitAll(repo, 'later')
    denied(hook('git push', repo))
  })

  test('an unapproved verdict is denied and named as rejected', () => {
    const repo = featureRepo('2')
    approve(repo, 'review-risk', subjectOf(repo), false)
    const r = hook('git push', repo)
    denied(r)
    assert.match(r.reason, /not approved by review-risk/)
  })

  test('the seeded verdict is the one the gate reads', () => {
    const repo = featureRepo('2')
    approve(repo, 'review-risk')
    assert.equal(readVerdicts(repo, subjectOf(repo))['review-risk'].approved, true)
  })

  test('a deleted feature document adds no risk, a merged-in default branch adds none', () => {
    const repo = featureRepo('none')
    git(repo, 'rm', '-q', 'odd/tasks/f.md')
    commitAll(repo, 'drop')
    silent(hook('git push', repo))
  })

  test('no resolvable default branch is denied with the reason', () => {
    const repo = featureRepo('none')
    git(repo, 'branch', '-m', 'main', 'trunk')
    const r = hook('git push', repo)
    assert.equal(r.decision, 'deny')
    assert.match(r.reason, /default branch cannot be resolved/)
  })

  test('a gh pr create --base branch is the default branch to compare with', () => {
    const repo = featureRepo('2')
    git(repo, 'branch', '-m', 'main', 'trunk')
    denied(hook('gh pr create --base trunk', repo))
    git(repo, 'checkout', '-q', 'trunk')
    assert.match(hook('gh pr create --base trunk', repo).reason, /default branch and no remote-tracking/)
  })

  test('an unreadable document or git failure denies with a reason', () => {
    const repo = featureRepo('2')
    git(repo, 'checkout', '-q', '--orphan', 'orphan')
    commitAll(repo, 'unrelated')
    const r = hook('git push', repo)
    assert.equal(r.decision, 'deny')
    assert.match(r.reason, /could not be checked/)
  })
})

// A published ref that does not resolve to a commit cannot be judged, so it is denied (it was judged as HEAD).
describe('an unresolvable push source is denied', () => {
  const repo = featureRepo()
  const cases = [
    'git push -u origin "$(git branch --show-current)"',
    'git push origin "$BRANCH"',
    'git push origin `git branch --show-current`',
    'git push origin "$(git branch --show-current):feat"',
    'git push origin no-such-branch',
    'git push origin no-such-branch:feat',
  ]
  for (const command of cases) {
    test(`denies: ${command}`, () => {
      const r = hook(command, repo)
      assert.equal(r.decision, 'deny')
      // The unquoted view of a backtick span leaves a plain `git push origin`, judged as HEAD.
      assert.match(r.reason, /does not resolve|review-risk/)
    })
  }

  test('a not-due branch still denies an unresolvable ref', () => {
    assert.match(hook('git push origin no-such-branch', featureRepo('none')).reason, /does not resolve/)
  })

  test('a pushed blob ref is not a commit', () => {
    const blob = git(repo, 'rev-parse', 'HEAD:src/app.js').trim()
    assert.match(hook(`git push origin ${blob}`, repo).reason, /does not resolve/)
  })
})

describe('the hook passes what it cannot judge', () => {
  test('not a repository', () => silent(hook('git push', scratchDir('odd-pub-norepo-'))))
  test('unreadable input', () => {
    silent(hook('', '', env(), { input: 'not json' }))
    silent(hook('', '', env(), { input: '' }))
  })
  test('a missing destination repository is not a denial when nothing is due', () => silent(hook('git push nowhere', featureRepo('none'))))
  test('a missing cwd', () => silent(hook('git push', undefined, env(), { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push' } }) })))
})

// T13 (F1, F2): the shell-words unwrapping, and unresolvable target directories.
describe('shell wrappers are unwrapped by shell-words', () => {
  const repo = featureRepo()
  const cases = [
    "bash -c -- 'git push origin feat'",
    'sh -c -- "git push origin feat"',
    'env -S "git push origin feat"',
    'env --split-string="git push origin feat"',
    'env -S"git push origin feat"',
    'echo `git push origin feat`',
    'echo "`git push origin feat`"',
    'echo $(git push origin feat)',
    'echo "$(git push origin feat)"',
    "eval 'git push origin feat'",
    "bash -c 'git push origin feat'",
    // security-review S1: a bare `(` or a case pattern `)` inside $(...) does not end the body.
    'echo "$( (true); git push origin feat )"',
    'echo $( (true) && git push origin feat )',
    'echo $(case x in x) git push origin feat;; esac)',
    'echo $(case x in (x) true;; esac; git push origin feat)',
    'echo "$( ( (true) ); git push origin feat )"',
    // review-risk lens: a substitution that cannot be delimited must not hide the commands after it.
    `echo "$(echo \${x/(/} 'a"b')"; git push origin feat`,
    // pre-existing: a `)` inside \${...} and a backslash-quoted here-doc delimiter.
    'echo "$(echo ${x/)/}; git push origin feat)"',
    'echo "$(true #)\ngit push origin feat)"',
    'echo "$(true # a ) b\ngit push origin feat)"',
    'cat <( (true); git push origin feat )',
  ]
  for (const command of cases) test(`denies: ${command}`, () => denied(hook(command, repo)))
  // review-risk lens: a `case` inside a quoted $(...) cannot be delimited without a full parser, so the
  // gate fails closed (the generic denial) instead of re-reading the body and losing what follows it.
  const undelimited = [
      'echo "$(case x in x) git push origin feat;; esac)"',
      'echo "$(case x in x) true;; esac; git push origin feat)"',
      'echo "$(case x in x) echo esac) git push origin feat;; esac)"',
      'echo "$(case x in x) echo esac ;; y) git push origin feat;; esac)"',
      'echo "$(case x in esac) git push origin feat;; esac)"',
      'echo "$(echo case) $(git push origin feat)"',
      `echo "$(echo case 'a"b')"; git push origin feat`,
      `echo "$(grep -i case 'it"s' f)" && git push origin feat`,
      `git commit -m "$(echo use case 'it"s')" ; git push origin feat`,
      'echo "$(cat <<\\EOF\n)\nEOF\ngit push origin feat)"',
      'echo "$(cat <<EOF\n)\nEOF\ngit push origin feat)"',
  ]
  for (const command of undelimited) {
    test(`denies, fail closed: ${command}`, () => {
      const r = hook(command, repo)
      assert.equal(r.decision, 'deny', r.stdout)
      assert.match(r.reason, /could not be checked \(a command substitution could not be delimited\)/)
    })
  }
  test('denies: printf x | xargs -i git push', () => denied(hook('printf x | xargs -i git push', repo)))
  test('silent: printf x | xargs -i echo git push', () => silent(hook('printf x | xargs -i echo git push', repo)))
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
    git(clean, 'checkout', '-q', '-b', 'feat')
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

// T15: detection runs on the original and the rewritten command text, so a scanner mistake in one view cannot hide a push.
describe('both command views are analyzed', () => {
  test('a quote inside a comment inside a substitution does not hide a push', () => {
    const r = hook("echo $(echo a #'\n); git push origin feat; echo ')'", featureRepo())
    denied(r)
    assert.equal(r.stdout.trim().split('\n').length, 1)
  })

  test('a non-publishing command with odd quoting stays silent', () => {
    const repo = featureRepo()
    silent(hook("echo $(echo a #'\n); echo ')'", repo))
    silent(hook("echo $(echo ')'; echo \"git push\"", repo))
  })

  test('a push with nothing due allows once, without output', () => {
    silent(hook('git push origin main; echo $(echo ok)', withRemote(makeRepo())))
  })

  test('the same push seen in both views is denied once', () => {
    const r = hook('git push origin feat', featureRepo())
    denied(r)
    assert.equal(r.stdout.trim().split('\n').length, 1)
  })
})

describe('audit-findings T1', () => {
  const repo = featureRepo()
  test('bare cd, cd -, and pushd leave an unknown directory, so a push is denied', () => {
    for (const c of ['cd && git push', 'cd - && git push', 'pushd && git push', 'popd && git push', 'cd -P && git push']) {
      const r = hook(c, repo)
      assert.equal(r.decision, 'deny', c)
      assert.match(r.reason, /directory the gate cannot resolve/, c)
    }
  })
  test('cd to a literal directory and pushd to one still resolve', () => {
    for (const c of [`cd ${repo} && git push`, `pushd ${repo} && git push`, `cd -P ${repo} && git push`]) denied(hook(c, '/'))
  })
  test('--super-prefix and --config-env values are skipped before push', () => {
    denied(hook('git --super-prefix x push origin feat', repo))
    denied(hook('git --config-env a=B push origin feat', repo))
  })
})

// T8 (L15): the gate judges what is published, reads every Risk number, accepts chains of approved
// subjects, keeps rejections, denies on errors, and sees the aliases and shell heredocs.
describe('the published refs are judged, not HEAD', () => {
  // fromMain: feat is unreviewed with Risk 2 while main is checked out.
  const fromMain = () => {
    const repo = withRemote(featureRepo('2'))
    git(repo, 'checkout', '-q', 'main')
    return repo
  }
  const featSubject = (repo) => subjectHash(git(repo, 'rev-parse', 'main^{tree}').trim(), git(repo, 'rev-parse', 'feat^{tree}').trim())
  const cases = [
    'git push origin feat',
    'git push origin feat:main',
    'git push origin +feat:other',
    'git push origin main feat',
    'gh release create v1 --target feat',
    'gh release create v1 --target=feat',
    'gh pr create --head feat',
    'gh pr create --head=feat',
    'gh pr create -H someone:feat',
    'git push --all origin',
    'git push --mirror origin',
    'git push --tags origin',
    'git push --branches origin',
    'git push origin :',
    'git push origin +:',
  ]
  for (const command of cases) test(`denies from main: ${command}`, () => denied(hook(command, fromMain())))

  test('what is not published is not judged', () => {
    const repo = fromMain()
    silent(hook('git push origin main', repo))
    silent(hook('git push', repo))
    silent(hook('gh pr create', repo))
    silent(hook('gh release create v1', repo))
    silent(hook('git push origin HEAD:other', repo))
  })

  test('the pushed branch decides: approved allows, a HEAD that is due does not matter', () => {
    const repo = fromMain()
    approve(repo, 'review-risk', featSubject(repo))
    silent(hook('git push origin feat', repo))
    silent(hook('git push origin feat:main', repo))
    silent(hook('gh pr create --head feat', repo))
    silent(hook('gh release create v1 --target feat', repo))
    silent(hook('git push --all origin', repo))
  })

  test('a ref that is unreviewed is denied even when another pushed ref is fine', () => {
    denied(hook('git push origin main feat', fromMain()))
  })

  test('a release target that does not resolve is denied with the reason', () => {
    const r = hook('gh release create v1 --target nope', fromMain())
    assert.equal(r.decision, 'deny')
    assert.match(r.reason, /does not resolve/)
  })
})

// A `cd` inside a subshell or a substitution ends with it; a quoted `)` does not close a `$(`.
describe('a subshell does not move the push to another directory', () => {
  const cases = [
    '(cd /tmp && ls); git push origin feat',
    '(cd /tmp && ls) && git push origin feat',
    'echo $(cd /tmp; pwd); git push origin feat',
    'echo `cd /tmp; pwd`; git push origin feat',
    'echo "`cd /tmp`" && git push origin feat',
    `echo "$(echo ')'; git push origin feat)"`,
    'echo "$(echo ")"; git push origin feat)"',
  ]
  for (const command of cases) test(command, () => denied(hook(command, featureRepo('2'))))
})

describe('the Risk cell is read whole', () => {
  const lensesOf = (risk) => hook('git push', featureRepo(risk)).reason ?? ''
  const cells = {
    '**2**': ['review-risk'],
    '`2`': ['review-risk'],
    'item 2': ['review-risk'],
    R2: ['review-risk'],
    '2 and 3': ['review-risk', 'review-reliability'],
    '2;3': ['review-risk', 'review-reliability'],
    '1–3': ['review-resilience', 'review-reliability'],
    '3 (contract text)': ['review-reliability'],
    '**1**, `3`': ['review-resilience', 'review-reliability'],
  }
  for (const [cell, lenses] of Object.entries(cells)) {
    test(`${cell} names ${lenses.join(', ')}`, () => {
      const reason = lensesOf(cell)
      for (const lens of lenses) assert.match(reason, new RegExp(lens), cell)
    })
  }

  test('none in any dress names no item', () => {
    for (const cell of ['none', '**none**', '`None`', 'none (docs only)']) silent(hook('git push', featureRepo(cell)))
  })

  test('an unreadable cell denies, naming the document and the cell', () => {
    for (const cell of ['tbd', 'soon', '', '7', '10']) {
      const r = hook('git push', featureRepo(cell))
      assert.equal(r.decision, 'deny', JSON.stringify(cell))
      assert.match(r.reason, /odd\/tasks\/f\.md/)
      assert.match(r.reason, /Risk cell/)
    }
  })

  test('a Tasks table without a Risk column denies naming the document', () => {
    const repo = makeRepo({ 'src/app.js': 'export const a = 1\n' })
    git(repo, 'checkout', '-q', '-b', 'feat')
    applyFiles(repo, { 'odd/tasks/f.md': '# F\n\n## Tasks\n\n| ID | Task |\n|---|---|\n| T1 | work |\n' })
    commitAll(repo, 'doc')
    const r = hook('git push', repo)
    assert.equal(r.decision, 'deny')
    assert.match(r.reason, /odd\/tasks\/f\.md/)
    assert.match(r.reason, /Risk column/)
  })
})

describe('a rejection stands', () => {
  test('a rejection is not undone by an approval of the same subject', () => {
    const repo = featureRepo('2')
    approve(repo, 'review-risk', subjectOf(repo), false)
    approve(repo, 'review-risk')
    assert.equal(readVerdicts(repo, subjectOf(repo))['review-risk'].approved, false)
    denied(hook('git push', repo))
  })

  test('only the exact subject counts: approvals of other subjects, even from the merge-base, do not (F17)', () => {
    const repo = featureRepo('2')
    const tree = (ref) => git(repo, 'rev-parse', `${ref}^{tree}`).trim()
    applyFiles(repo, { 'src/more.js': 'export const m = 1\n' })
    commitAll(repo, 'second')
    writeVerdict(repo, { lens: 'review-risk', subject_hash: subjectHash(tree('main'), tree('HEAD~1')), base_tree: tree('main'), head_tree: tree('HEAD~1'), approved: true, at: Date.now(), result: {} })
    writeVerdict(repo, { lens: 'review-risk', subject_hash: subjectHash(tree('HEAD~1'), tree('HEAD')), base_tree: tree('HEAD~1'), head_tree: tree('HEAD'), approved: true, at: Date.now(), result: {} })
    const r = hook('git push', repo)
    denied(r)
    assert.match(r.reason, /no verdict from review-risk/)
    assert.doesNotMatch(r.reason, /\.\./)
  })
})

describe('F7, F8: the default branch', () => {
  const plain = () => makeRepo({ 'src/app.js': 'export const a = 1\n' })

  test('gh release create without --target judges the default branch, not HEAD (F7)', () => {
    // gh --help: "--target branch  Target branch or full commit SHA (default [main branch])".
    const repo = withRemote(featureRepo('2'))
    // On feat (Risk 2, unreviewed) the release still targets origin/main, which is clean.
    silent(hook('gh release create v1', repo))
    silent(hook('gh release create v1 --notes hi', repo))
    // An explicit target is judged.
    denied(hook('gh release create v1 --target HEAD', repo))
  })

  test('publishing the default branch with no remote-tracking default denies with the reason (F8)', () => {
    const repo = plain()
    for (const command of ['git push origin main', 'git push', 'gh release create v1', 'gh release create v1 --target main']) {
      const r = hook(command, repo)
      assert.equal(r.decision, 'deny', command)
      assert.match(r.reason, /default branch and no remote-tracking default branch exists/, command)
    }
  })

  test('with a remote-tracking default, the default branch is compared against it (F8)', () => {
    const repo = withRemote(plain())
    silent(hook('git push origin main', repo))
    // Local main ahead of origin/main with an unreviewed Risk 2 document is judged.
    applyFiles(repo, { 'odd/tasks/f.md': TABLE('2'), 'src/app.js': 'export const a = 2\n' })
    commitAll(repo, 'unit')
    denied(hook('git push origin main', repo))
    denied(hook('git push', repo))
  })
})

describe('F1: the Risk items are read at the ref and at the merge-base', () => {
  test('lowering Risk 2 to none in the branch still requires the review', () => {
    const repo = makeRepo({ 'odd/tasks/f.md': TABLE('2'), 'src/app.js': 'export const a = 1\n' })
    git(repo, 'checkout', '-q', '-b', 'feat')
    applyFiles(repo, { 'odd/tasks/f.md': TABLE('none'), 'src/app.js': 'export const a = 2\n' })
    commitAll(repo, 'downgrade')
    const r = hook('git push', repo)
    denied(r)
    assert.match(r.reason, /Risk items 2/)
  })

  test('a renamed document with a lowered Risk is read at the merge-base under its old path', () => {
    const repo = makeRepo({ 'odd/tasks/f.md': TABLE('2'), 'src/app.js': 'export const a = 1\n' })
    git(repo, 'checkout', '-q', '-b', 'feat')
    git(repo, 'mv', 'odd/tasks/f.md', 'odd/tasks/g.md')
    applyFiles(repo, { 'odd/tasks/g.md': TABLE('none'), 'src/app.js': 'export const a = 2\n' })
    commitAll(repo, 'rename and downgrade')
    const r = hook('git push', repo)
    denied(r)
    assert.match(r.reason, /Risk items 2/)
  })

  test('deleting a Risk 2 document with no other risky change is allowed (L15)', () => {
    const repo = makeRepo({ 'odd/tasks/f.md': TABLE('2'), 'src/app.js': 'export const a = 1\n' })
    git(repo, 'checkout', '-q', '-b', 'feat')
    git(repo, 'rm', '-q', 'odd/tasks/f.md')
    commitAll(repo, 'remove the finished feature document')
    silent(hook('git push', repo))
  })

  test('an escaped pipe in a task cell does not shift the Risk column', () => {
    const doc = TABLE('2').replace('| work |', '| work a \\| b |')
    const repo = makeRepo({ 'src/app.js': 'export const a = 1\n' })
    git(repo, 'checkout', '-q', '-b', 'feat')
    applyFiles(repo, { 'odd/tasks/f.md': doc, 'src/app.js': 'export const a = 2\n' })
    commitAll(repo, 'unit')
    denied(hook('git push', repo))
  })

  test('the denial text has no double space, no stray comma, and short branch names', () => {
    const repo = featureRepo('2')
    const onFeat = hook('git push origin feat', repo)
    denied(onFeat)
    assert.doesNotMatch(onFeat.reason, /  | ,|check out/)
    assert.match(onFeat.reason, /` , fix|`, fix/)
    git(repo, 'checkout', '-q', 'main')
    const fromMain = hook('git push origin feat', repo)
    assert.match(fromMain.reason, /check out feat first/)
    const bare = hook('git push origin main', withRemote(featureRepo('2')))
    assert.doesNotMatch(bare.reason ?? '', /refs\/heads\//)
  })

  test('a document new on the branch has no merge-base version and is read at the ref', () => {
    denied(hook('git push', featureRepo('2')))
    silent(hook('git push', featureRepo('none')))
  })
})

describe('Risk ranges and a suffixed Tasks heading (L17)', () => {
  const lensesNamed = (risk) => {
    const r = hook('git push', featureRepo(risk))
    assert.equal(r.decision, 'deny', risk)
    return ['review-reliability', 'review-resilience', 'review-risk'].filter((lens) => r.reason.includes(lens))
  }
  test('a range names every item between its ends', () => {
    for (const cell of ['2–6', '2—6', '2-6', 'items 2 to 6']) {
      assert.deepEqual(lensesNamed(cell), ['review-reliability', 'review-resilience', 'review-risk'], cell)
    }
    // 2-5 covers 3 (reliability) and 4 (reliability, resilience) and 5.
    assert.deepEqual(lensesNamed('2-5'), ['review-reliability', 'review-resilience', 'review-risk'])
    const r = hook('git push', featureRepo('2-5'))
    assert.match(r.reason, /Risk items 2, 3, 4, 5\b/)
  })
  test('a reversed or out-of-range range denies as an unreadable cell', () => {
    for (const cell of ['6-2', '2-7', '0-3']) {
      const r = hook('git push', featureRepo(cell))
      assert.equal(r.decision, 'deny', cell)
      assert.match(r.reason, /Risk cell/, cell)
    }
  })
  test('a Tasks heading with a suffix is read, case-insensitively', () => {
    for (const heading of ['## Tasks (wave 2)', '## tasks - wave 2']) {
      const repo = makeRepo({ 'src/app.js': 'export const a = 1\n' })
      git(repo, 'checkout', '-q', '-b', 'feat')
      applyFiles(repo, { 'odd/tasks/f.md': TABLE('2').replace('## Tasks', heading), 'src/app.js': 'export const a = 2\n' })
      commitAll(repo, 'unit')
      denied(hook('git push', repo))
    }
  })
  test('a Tasks heading of level 3 to 6 is read, and a deeper subheading does not end the section', () => {
    for (const heading of ['### Tasks', '###### Tasks (wave 2)']) {
      const repo = makeRepo({ 'src/app.js': 'export const a = 1\n' })
      git(repo, 'checkout', '-q', '-b', 'feat')
      applyFiles(repo, { 'odd/tasks/f.md': TABLE('2').replace('## Tasks', heading), 'src/app.js': 'export const a = 2\n' })
      commitAll(repo, 'unit')
      denied(hook('git push', repo))
    }
    const repo = makeRepo({ 'src/app.js': 'export const a = 1\n' })
    git(repo, 'checkout', '-q', '-b', 'feat')
    applyFiles(repo, { 'odd/tasks/f.md': TABLE('2').replace('## Tasks\n', '## Tasks\n\n#### Notes\n'), 'src/app.js': 'export const a = 2\n' })
    commitAll(repo, 'unit')
    denied(hook('git push', repo))
  })
})

describe('errors deny, aliases and shell bodies are seen', () => {
  test('a crash in the parser denies a command that mentions a push', () => {
    const deep = `git push $(`.repeat(1) + '$('.repeat(30000) + ')'.repeat(30000)
    const r = hook(deep, featureRepo('none'))
    assert.equal(r.decision, 'deny')
    assert.match(r.reason, /publication-gate/)
  })

  test('a crash on a command that is no publication stays silent', () => {
    silent(hook('echo ' + '$('.repeat(30000) + ')'.repeat(30000), featureRepo('2')))
  })

  const cases = [
    'gh pr new --title t',
    'gh release new v1 --notes hi --target HEAD',
    'bash <<EOF\ngit push\nEOF',
    "sh <<'EOF'\ngit push origin feat\nEOF",
    'bash <<< "git push"',
    "cat <<EOF | bash\ngit push\nEOF",
  ]
  for (const command of cases) test(`denies without verdicts: ${JSON.stringify(command)}`, () => denied(hook(command, featureRepo('2'))))

  test('a heredoc fed to something else is data', () => {
    silent(hook('cat <<EOF\ngit push\nEOF', featureRepo('2')))
    silent(hook('git commit -F - <<EOF\ngit push\nEOF', featureRepo('2')))
  })
})
