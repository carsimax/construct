// S1: the two-tier destructive command guard, driven through the real secret-guard hook entry.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { scratchDir } from '../assess/helpers.mjs'

const SCRIPT = new URL('../../plugins/construct/hooks/scripts/secret-guard.mjs', import.meta.url).pathname

const home = scratchDir('cmdguard-home-')
const cwd = join(scratchDir('cmdguard-work-'), 'proj')
mkdirSync(cwd, { recursive: true })

function run(command, extra = {}) {
  const result = spawnSync('node', [SCRIPT], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd, ...extra }),
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  })
  let json = null
  try {
    json = JSON.parse(result.stdout)
  } catch {
    // allowed calls print nothing
  }
  return { ...result, json }
}

function decision(result) {
  assert.equal(result.status, 0)
  const out = result.json?.hookSpecificOutput
  if (!out) {
    assert.equal(result.stdout, '')
    return { decision: 'allow' }
  }
  assert.equal(out.hookEventName, 'PreToolUse')
  return { decision: out.permissionDecision, reason: out.permissionDecisionReason }
}

const deny = (command, rule, extra) => {
  const d = decision(run(command, extra))
  assert.equal(d.decision, 'deny', `expected deny for ${command}`)
  if (rule) assert.match(d.reason, rule, command)
}
const ask = (command, rule) => {
  const d = decision(run(command))
  assert.equal(d.decision, 'ask', `expected ask for ${command}`)
  assert.ok(d.reason, 'an ask carries a reason')
  if (rule) assert.match(d.reason, rule, command)
}
const allow = (command, extra) => assert.equal(decision(run(command, extra)).decision, 'allow', `expected allow for ${command}`)

test('hard deny: rm -rf of root, home, dot, and dot-dot', () => {
  for (const c of ['rm -rf /', 'rm -rf /*', 'rm -rf ~', 'rm -rf ~/', 'rm -fr $HOME', 'rm -rf ${HOME}/', 'rm -rf .', 'rm -rf ..', 'rm -r -f ./', 'rm --recursive --force .']) {
    deny(c, /rm -rf/, undefined)
  }
})

test('hard deny: git reset --hard, git clean -fd, force push', () => {
  deny('git reset --hard', /git reset --hard/)
  deny('git reset --hard HEAD~3', /git reset --hard/)
  for (const c of ['git clean -fd', 'git clean -fdx', 'git clean -xdf', 'git clean -f -d', 'git clean --force --directories']) deny(c, /git clean/)
  for (const c of [
    'git push --force', 'git push -f origin main', 'git push origin main --force', 'git push --force-with-lease',
    'git push -uf origin x', 'git -C /repo push --force',
  ]) deny(c, /force push/)
})

test('hard deny: chmod -R 777, chown -R, npm publish', () => {
  deny('chmod -R 777 .', /chmod -R 777/)
  deny('chmod 777 -R /srv', /chmod -R 777/)
  deny('chown -R root .', /chown -R/)
  deny('chown -Rh me:me /x', /chown -R/)
  deny('npm publish', /npm publish/)
  deny('npm publish --access public', /npm publish/)
})

test('confirm tier: ask with the rule named', () => {
  ask('rm -r build', /rm -r/)
  ask('rm -rf node_modules', /rm -r/)
  ask('rm -rf build/', /rm -r/)
  ask('rm -rf /tmp/some-dir', /rm -r/)
  ask('rm -rf ~/projects/old', /rm -r/)
  ask('find . -name "*.o" -delete', /find -delete/)
  ask('git restore src/a.ts', /git restore/)
  ask('git checkout -- src/a.ts', /git checkout --/)
  ask('git stash drop', /git stash drop/)
  ask('git stash clear', /git stash clear/)
  ask('git push', /git push/)
  ask('git push origin feat/x', /git push/)
  ask('git rebase main', /git rebase/)
  ask('git branch -D old', /git branch -D/)
  ask('git branch -d -f old', /git branch -D/)
  ask('psql -c "DROP TABLE users"', /SQL/)
  ask('psql -c "TRUNCATE users"', /SQL/)
  ask('mysql -e "DELETE FROM users"', /SQL/)
  ask('echo "DELETE FROM users;" | psql db', /SQL/)
  ask('sqlite3 db <<EOF\nDROP TABLE t;\nEOF', /SQL/)
})

test('a tier decision is single-valued: the hard deny wins over an ask in one command', () => {
  deny('git rebase main && git push --force', /force push/)
})

test('the same ask is a deny inside a subagent', () => {
  for (const c of ['rm -r build', 'git push', 'git rebase main', 'git stash drop', 'psql -c "DROP TABLE t"']) {
    const d = decision(run(c, { agent_id: 'agent-1', agent_type: 'construct:odd-worker' }))
    assert.equal(d.decision, 'deny', c)
    assert.match(d.reason, /subagent/i)
  }
  deny('git push --force', /force push/, { agent_id: 'agent-1' })
  allow('git status', { agent_id: 'agent-1' })
  // an empty or non-string agent_id is the main thread
  assert.equal(decision(run('git push', { agent_id: '' })).decision, 'ask')
})

test('unwrapping: sh -c, bash -c, zsh -c, eval', () => {
  deny("sh -c 'git reset --hard'", /git reset --hard/)
  deny('bash -c "rm -rf ."', /rm -rf/)
  deny("zsh -lc 'git push -f'", /force push/)
  deny('eval "git clean -fd"', /git clean/)
  deny("bash -c \"sh -c 'git reset --hard'\"", /git reset --hard/)
  ask("bash -c 'git push'", /git push/)
})

test('unwrapping: sudo, env, xargs, timeout, nice, command, assignments', () => {
  deny('sudo git reset --hard', /git reset --hard/)
  deny('sudo -u root rm -rf /', /rm -rf/)
  deny('env FOO=1 git push --force', /force push/)
  deny('FOO=1 git reset --hard', /git reset --hard/)
  deny('timeout 5 git clean -fd', /git clean/)
  deny('nice -n 5 chown -R me .', /chown -R/)
  deny('command npm publish', /npm publish/)
  ask('echo build | xargs rm -r', /rm -r/)
  ask('find . -name x | xargs -n1 rm -rf', /rm -r/)
  ask('nohup git rebase main', /git rebase/)
})

test('unwrapping: command substitution, backticks, find -exec, control flow', () => {
  deny('echo $(git reset --hard)', /git reset --hard/)
  deny('echo "$(git reset --hard)"', /git reset --hard/)
  deny('echo `git push --force`', /force push/)
  deny('x=$(rm -rf .)', /rm -rf/)
  ask('echo "$(git push)"', /git push/)
  deny('find . -exec git reset --hard \;', /git reset --hard/)
  ask('find . -type f -exec rm -r {} +', /rm -r/)
  deny('if true; then git reset --hard; fi', /git reset --hard/)
  deny('git status; git reset --hard', /git reset --hard/)
  deny('git status && git push -f || true', /force push/)
  deny('cat <<EOF | sh\ngit reset --hard\nEOF', /git reset --hard/)
  deny('bash <<EOF\nrm -rf .\nEOF', /rm -rf/)
})

test('git global flags before the subcommand do not hide it', () => {
  deny('git -C /repo reset --hard', /git reset --hard/)
  deny('git -c core.x=1 push -f', /force push/)
  ask('git --no-pager -C /r rebase main', /git rebase/)
})

test('non-command text is exempt: heredoc bodies and quoted data arguments', () => {
  allow('cat <<EOF\ngit reset --hard\nrm -rf .\ngit push --force\nEOF')
  allow("cat > notes.md <<'EOF'\nrun git push --force then rm -rf .\nEOF")
  allow('git commit -F - <<EOF\ndocs: explain git reset --hard and rm -rf .\nEOF')
  allow('echo "git reset --hard"')
  allow("echo 'rm -rf /' > note.txt")
  allow('printf "%s\\n" "git push --force"')
  allow('grep -rn "git reset --hard" docs/')
  allow("rg 'rm -rf \\.' src")
  allow('grep "DROP TABLE" schema.sql')
  allow('echo "DROP TABLE users" > migration.sql')
  allow("git commit -m 'never run git reset --hard'")
  allow("echo '$(git reset --hard)'")
})

test('look-alikes and safe forms are allowed', () => {
  for (const c of [
    'git status', 'git log --oneline', 'git reset --soft HEAD~1', 'git reset HEAD file', 'git clean -n', 'git clean -nd',
    'git checkout main', 'git checkout -b x', 'git branch -d merged', 'git stash', 'git stash pop', 'git stash list',
    'git fetch', 'git pull', 'rm file.txt', 'rm -f file.txt',
    'chmod 755 run.sh', 'chmod -R 755 dir', 'chown me file', 'npm install', 'npm run publish-docs', 'npm pack',
    'find . -name x', 'find . -exec ls {} \;', 'psql -c "SELECT 1"', 'psql -c "DELETE FROM t WHERE id = 1"', 'ls -la', 'node --test tests/',
  ]) {
    assert.equal(decision(run(c)).decision, 'allow', c)
  }
})

test('existing guard behavior is untouched: secrets still deny with the manual-run reason', () => {
  const d = decision(run('cat .env'))
  assert.equal(d.decision, 'deny')
  assert.match(d.reason, /manually/i)
  const rm = decision(run('rm -rf /'))
  assert.equal(rm.decision, 'deny')
})

test('non-Bash tools are not command-checked', () => {
  const result = spawnSync('node', [SCRIPT], {
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(cwd, 'a.txt'), content: 'git reset --hard' }, cwd }),
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  })
  assert.equal(result.stdout, '')
})
