// Drives the real secret-guard script as a hook: JSON on stdin, decision on stdout.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { scratchDir } from '../assess/helpers.mjs'

const SCRIPT = new URL('../../plugins/construct/hooks/scripts/secret-guard.mjs', import.meta.url).pathname
const HOOKS = new URL('../../plugins/construct/hooks/hooks.json', import.meta.url).pathname

const home = scratchDir('guard-home-')
const cwd = join(scratchDir('guard-work-'), 'proj', 'sub')
mkdirSync(cwd, { recursive: true })

function run(input, raw) {
  const result = spawnSync('node', [SCRIPT], {
    input: raw ?? JSON.stringify(input),
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

const call = (tool_name, tool_input) => run({ tool_name, tool_input, cwd })
const bash = (command) => call('Bash', { command })

function assertDeny(result, rule) {
  assert.equal(result.status, 0)
  const out = result.json?.hookSpecificOutput
  assert.ok(out, `expected a deny, got stdout=${JSON.stringify(result.stdout)}`)
  assert.equal(out.hookEventName, 'PreToolUse')
  assert.equal(out.permissionDecision, 'deny')
  assert.match(out.permissionDecisionReason, /manually/i)
  if (rule) assert.match(out.permissionDecisionReason, rule)
  assert.deepEqual(Object.keys(result.json), ['hookSpecificOutput'])
}

function assertAllow(result) {
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
}

test('file tools deny protected paths', () => {
  for (const path of [
    '/x/.env', '/x/.env.local', '/x/.env.production',
    '/x/server.key', '/x/ca.pem',
    '/x/config/secrets/db.yml',
    '/x/.ssh/id_rsa', '/x/.credentials/token',
    '/Users/a/Library/Keychains/login.keychain-db',
    '/x/.aws/credentials', '/x/.config/gh/hosts.yml',
  ]) {
    for (const tool of ['Read', 'Edit', 'Write', 'MultiEdit']) {
      assertDeny(call(tool, { file_path: path }))
    }
  }
  assertDeny(call('NotebookEdit', { notebook_path: '/x/.env' }))
})

test('file tools allow look-alikes and templates', () => {
  for (const path of [
    '/x/.env.example', '/x/.env.sample', '/x/.env.template',
    '/x/.environment.ts', '/x/src/keys.ts', '/x/docs/secrets.md',
    '/x/env', '/x/.aws/config', '/x/monkey.keyboard',
  ]) {
    assertAllow(call('Read', { file_path: path }))
  }
})

test('the rule is named in the reason', () => {
  assertDeny(call('Read', { file_path: '/x/.env' }), /\.env/)
  assertDeny(call('Read', { file_path: '/x/a.pem' }), /\.pem/)
  assertDeny(call('Read', { file_path: '/x/secrets/a' }), /secrets/)
})

test('relative paths resolve through cwd', () => {
  const rel = call('Read', { file_path: '../.env' })
  assertDeny(rel)
  assertAllow(call('Read', { file_path: '../.env.example' }))
  assertAllow(call('Read', { file_path: '../README.md' }))
})

test('home expansion for ~ and $HOME', () => {
  assertDeny(call('Read', { file_path: '~/.ssh/id_rsa' }))
  assertDeny(call('Read', { file_path: '$HOME/.aws/credentials' }))
  assertDeny(call('Read', { file_path: '${HOME}/.aws/credentials' }))
  assertDeny(call('Read', { file_path: `${home}/.ssh/id_rsa` }))
})

test('Grep and Glob path and pattern', () => {
  assertDeny(call('Grep', { pattern: 'ssh-rsa', path: '~/.ssh' }))
  assertDeny(call('Grep', { pattern: 'x', path: '~/.ssh/id_rsa' }))
  assertAllow(call('Grep', { pattern: 'todo', path: 'src' }))
  assertDeny(call('Glob', { pattern: '**/*.pem' }))
  assertDeny(call('Glob', { pattern: '**/.env' }))
  assertDeny(call('Glob', { pattern: '*', path: '~/.ssh' }))
  assertDeny(call('Glob', { pattern: '**/secrets/*' }))
  assertAllow(call('Glob', { pattern: '**/*.ts' }))
  assertAllow(call('Glob', { pattern: '**/.env.example' }))
  assertAllow(call('Grep', { pattern: 'x', glob: '*.ts' }))
  assertDeny(call('Grep', { pattern: 'x', glob: '*.pem' }))
})

test('a Grep pattern is a content regex, not a path, and is never treated as a location', () => {
  assertAllow(call('Grep', { pattern: '\\.env', path: 'src' }))
  assertAllow(call('Grep', { pattern: 'id_rsa' }))
  assertAllow(call('Grep', { pattern: 'BEGIN RSA PRIVATE KEY', glob: '*.ts' }))
})

test('Bash denies commands that name a protected path', () => {
  for (const command of [
    'cat ~/.ssh/id_rsa',
    'cat $HOME/.aws/credentials',
    'cat .env',
    'cat ../.env',
    'cp .env /tmp/x',
    'grep -r token config/secrets',
    'cat server.key',
    'cat "$HOME/.ssh/id_rsa"',
    "cat '.env'",
    'echo hi && cat .env',
    'cat < .env',
    'cat --file=.env',
    'cat ~/Library/Keychains/login.keychain-db',
  ]) {
    assertDeny(bash(command))
  }
})

test('Bash allows templates, look-alikes, and unrelated commands', () => {
  for (const command of [
    'ls -la',
    'cat .env.example',
    'cat .environment.ts',
    'cat src/keys.ts',
    'cat docs/secrets.md',
    'git commit -m "add .env.example"',
    'git status',
    'rm -rf build/',
    'rm -rf ./node_modules',
    'rm file.txt',
  ]) {
    assertAllow(bash(command))
  }
})

test('Bash: .env mentioned only inside a quoted multi-word string is allowed', () => {
  // A quoted string with spaces is one word and not a path, so prose that mentions
  // .env does not trip the guard; a bare .env word given to a reader such as cat does.
  assertAllow(bash('echo "remember to add .env to the gitignore"'))
  assertDeny(bash('cat .env'))
})

test('Bash denies every catastrophic rm -rf spelling', () => {
  for (const command of [
    'rm -rf /', 'rm -fr /', 'rm -r -f /', 'rm -f -r /', 'rm -Rf /',
    'rm --recursive --force /', 'rm --force --recursive /', 'rm -r --force /',
    'rm -rf ~', 'rm -rf ~/', 'rm -rf $HOME', 'rm -rf ${HOME}', 'rm -rf "$HOME"',
    'rm -rf /*', 'rm -rf ~/*', 'rm -rf -- /',
    'sudo rm -rf /', 'sudo rm -rf ~', 'sudo rm -fr $HOME',
    'echo ok; rm -rf /', 'true && sudo rm -r -f /*',
  ]) {
    assertDeny(bash(command), /rm -rf/)
  }
})

test('rm without both flags, or on other targets, is allowed', () => {
  assertAllow(bash('rm -r build'))
  assertAllow(bash('rm -f /tmp/x.log'))
  assertAllow(bash('rm -rf build/'))
  assertAllow(bash('rm -rf /tmp/some-dir'))
})

test('unrelated tools are allowed', () => {
  assertAllow(call('WebFetch', { url: 'https://example.com/.env' }))
  assertAllow(call('TodoWrite', { todos: [{ content: 'rotate .env', status: 'pending' }] }))
  assertAllow(call('Task', { prompt: 'read .env' }))
})

test('empty tool_input and missing fields are allowed', () => {
  assertAllow(call('Read', {}))
  assertAllow(call('Bash', {}))
  assertAllow(run({ tool_name: 'Read', cwd }))
  assertAllow(run({}))
})

test('unparseable input is allowed with a stderr note', () => {
  for (const raw of ['not json', '', '{"tool_name":']) {
    const result = run(null, raw)
    assert.equal(result.status, 0)
    assert.equal(result.stdout, '')
  }
  const bad = run(null, 'not json')
  assert.match(bad.stderr, /secret-guard/)
})

test('missing cwd falls back to the process cwd and still guards absolute paths', () => {
  assertDeny(run({ tool_name: 'Read', tool_input: { file_path: '/x/.env' } }))
})

test('hooks.json registers the guard on PreToolUse and keeps the other hooks', () => {
  const hooks = JSON.parse(readFileSync(HOOKS, 'utf8'))
  const entry = hooks.hooks.PreToolUse[0]
  assert.equal(entry.matcher, 'Read|Edit|Write|MultiEdit|NotebookEdit|Grep|Glob|Bash')
  const hook = entry.hooks[0]
  assert.equal(hook.type, 'command')
  assert.equal(hook.command, 'node')
  assert.deepEqual(hook.args, ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/secret-guard.mjs'])
  assert.equal(hook.timeout, 10)
  for (const event of ['SessionStart', 'SubagentStart', 'Stop']) assert.ok(hooks.hooks[event])
  assert.deepEqual(hooks.modules, ['./register.js'])
})

test('the guard never writes any file', () => {
  const dir = scratchDir('guard-nowrite-')
  const before = readdirSync(dir)
  writeFileSync(join(dir, 'probe'), 'x')
  const result = spawnSync('node', [SCRIPT], {
    input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '.env' }, cwd: dir }),
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  })
  assert.equal(result.status, 0)
  assert.deepEqual(readdirSync(dir).sort(), [...before, 'probe'].sort())
  assert.deepEqual(readdirSync(home), [])
  assert.doesNotMatch(readFileSync(SCRIPT, 'utf8'), /writeFile|appendFile|mkdir|createWriteStream|unlink|rmSync/)
})

test('B1: Grep glob and Glob pattern are globs that may match protected names', () => {
  for (const glob of ['*.env*', '.e*', '{a,.env}', '**/*.env*', '*.pem', '**/.ss?/**', '.env.*', '*.[k]ey', 'secrets/**', '**/.aws/credentials']) {
    assertDeny(call('Grep', { pattern: 'KEY', glob }))
    assertDeny(call('Glob', { pattern: glob }))
  }
  for (const glob of ['*.ts', '**/*.json', '.env.example', '{a,b}/*.md', '**/*', 'src/**/*.tsx']) {
    assertAllow(call('Grep', { pattern: 'KEY', glob }))
    assertAllow(call('Glob', { pattern: glob }))
  }
})

test('B2: search commands treat the pattern as data and check only the paths', () => {
  for (const command of [
    'rg ".env" src',
    'grep -rn "\\.env" src',
    'grep -r "secrets/" src',
    'grep -rn -e ".env" src',
    'egrep --regexp=.env src',
    'git grep ".env" -- src',
    'rg -A 3 ".env" src',
    'ag ".env" src',
  ]) {
    assertAllow(bash(command))
  }
  assertDeny(bash('rg token .env'))
  assertDeny(bash('grep -rn token ~/.ssh'))
  assertDeny(bash('grep -e token .env'))
  assertDeny(bash('git grep token -- .env'))
  assertDeny(bash('rg -g "*.env*" KEY'))
  assertDeny(bash('export $(grep -v ^# .env | xargs)'))
})

test('B2: inside double quotes a backslash is kept unless it escapes $ ` " \\ or newline', () => {
  // bash keeps the backslash here, so the word is `\.env`, a different file from `.env`
  assertAllow(bash('cat "\\.env"'))
  assertDeny(bash('cat "\\$HOME/.x" "$HOME/.ssh/id_rsa"'))
})

test('B3: echo and printf arguments are data; only redirections are checked', () => {
  for (const command of [
    'echo .env >> .gitignore',
    'echo ".env" >> .gitignore',
    'printf "%s\\n" .env >> .gitignore',
    'echo .env 2>&1',
    'echo .env | cat',
  ]) {
    assertAllow(bash(command))
  }
  assertDeny(bash('echo x > .env'))
  assertDeny(bash('echo x >> .env'))
  assertDeny(bash('printf x &> .env'))
  assertDeny(bash('cat < .env'))
  assertDeny(bash('echo .env > .env'))
})

test('matching is case-insensitive, templates included', () => {
  for (const path of ['/x/.ENV', '/x/.Env.local', '~/.SSH/id_rsa', '/x/A.PEM', '/x/Secrets/a']) {
    assertDeny(call('Read', { file_path: path }))
  }
  assertAllow(call('Read', { file_path: '/x/.ENV.EXAMPLE' }))
  assertDeny(bash('cat .ENV'))
})

test('rev:path tokens check the path part', () => {
  assertDeny(bash('git show HEAD:.env'))
  assertDeny(bash('git show origin/main:.env.local'))
  assertDeny(bash('git show HEAD:config/secrets/db.yml'))
  assertAllow(bash('git show HEAD:src/app.ts'))
  assertAllow(bash('git log --format=%H:%s'))
  assertAllow(bash('git show HEAD:.env.example'))
})

test('interpreter one-liners are scanned for protected string literals', () => {
  assertDeny(bash('python3 -c "print(open(\'.env\').read())"'))
  assertDeny(bash('python -c "open(\'~/.ssh/id_rsa\')"'))
  assertDeny(bash('node -e "require(\'fs\').readFileSync(\'.env\')"'))
  assertDeny(bash('perl -e \'open(F, "<.env")\''))
  assertDeny(bash('ruby -e "puts File.read(\'.env\')"'))
  assertAllow(bash('node -e "console.log(1)"'))
  assertAllow(bash('python3 -c "print(\'hello world\')"'))
  assertDeny(bash("python3 - <<'EOF'\nprint(open('.env').read())\nEOF"))
})

test('verifier probes', () => {
  for (const command of [
    'rm -rf / --no-preserve-root', '\\rm -rf /', 'command rm -rf /', 'rm -rf "$HOME"',
    'scp h:~/.ssh/id_rsa .', 'cat --env-file=.env', 'node --env-file=.env app.js',
  ]) {
    assertDeny(bash(command))
  }
  for (const command of ['rm -rf ./', 'rm -rf ~/projects/old']) assertAllow(bash(command))
  assertAllow(call('Edit', { file_path: 'config/keys/index.ts' }))
})

test('F11: data piped into a command that executes or reads its words is checked as paths', () => {
  for (const command of [
    'echo .env | xargs cat',
    'echo .env |& xargs cat',
    "printf '%s\\n' ~/.ssh/id_rsa | xargs cat",
    'printf .env | xargs cat',
    'echo "cat .env" | sh',
    'echo "cat .env" | bash',
    'echo ".env" | source /dev/stdin',
    'echo "cat .env" | eval',
    'echo .env | while read f; do cat "$f"; done',
    'echo .env | tr a a | xargs cat',
    'cat <<EOF | xargs cat\n.env\nEOF',
  ]) {
    assertDeny(bash(command))
  }
  for (const command of [
    'echo .env >> .gitignore',
    'echo .env | wc -c',
    'echo hello | xargs cat',
    'echo .env; xargs cat < list.txt',
    'echo .env || cat README.md',
  ]) {
    assertAllow(bash(command))
  }
})

test('F12: pattern-file and path-valued flags are checked as paths', () => {
  for (const command of [
    'grep -f .env src',
    'grep --file=.env src',
    'grep --file .env src',
    'grep -rf .env src',
    'rg --file=.env src',
    'rg -f .env src',
    'rg --ignore-file .env KEY',
    'ag --path-to-ignore .env KEY',
    'git grep -f .env',
  ]) {
    assertDeny(bash(command))
  }
  assertAllow(bash('grep -f patterns.txt src'))
  assertAllow(bash('rg --ignore-file .gitignore ".env" src'))
})

test('F13: flag arity is per command', () => {
  assertDeny(bash('grep -T KEY .env'))
  assertDeny(bash('ag -t KEY .env'))
  assertDeny(bash('git grep -T KEY .env'))
  assertAllow(bash('rg -t js "\\.env" src'))
  assertAllow(bash('rg -T js ".env" src'))
  assertAllow(bash('grep -T ".env" src'))
  assertAllow(bash('ag -t ".env" src'))
  assertAllow(bash('grep -A 2 ".env" src'))
})

test('F14: a malformed glob never fails open', () => {
  assertDeny(call('Grep', { pattern: 'x', glob: '[z-a].env' }))
  assertDeny(call('Glob', { pattern: '**/[z-a]*.pem' }))
  assertDeny(bash('rg -g "[z-a].env" KEY'))
  // no protected keyword appears literally, so only a real glob check can deny these
  assertDeny(call('Glob', { pattern: '**/.s[z-a]h/**' }))
  assertDeny(call('Grep', { pattern: 'x', glob: 'secr[z-a]ts/*' }))
  assertAllow(call('Glob', { pattern: 'src/[z-a].ts' }))
  assertAllow(call('Glob', { pattern: 'src/[a-z].ts' }))
})

test('S8a: heredoc bodies are data unless an interpreter runs them', () => {
  // data heredocs that only mention a protected name
  assertAllow(bash('cat > .gitignore <<EOF\nnode_modules\n.env\nEOF'))
  assertAllow(bash("cat >> .gitignore <<'EOF'\n.env\n*.log\nEOF"))
  assertAllow(bash("git commit -F - <<'EOF'\nchore: ignore\n.env\nEOF"))
  assertAllow(bash('cat > notes.md <<"EOF"\n.env\nEOF'))
  assertAllow(bash('cat > notes.md <<-EOF\n\t.env\n\tEOF'))
  assertAllow(bash('cat > notes.md <<EOF\n.env\nEOF\nls'))
  // the line that opens the heredoc is still checked
  assertDeny(bash('cat .env <<EOF\nhello\nEOF'))
  assertDeny(bash('cat > .env <<EOF\nKEY=1\nEOF'))
  assertDeny(bash("cat <<'EOF' > .env\nKEY=1\nEOF"))
  // commands after the heredoc are still checked
  assertDeny(bash('cat > a.txt <<EOF\nx\nEOF\ncat .env'))
  // a heredoc fed to an interpreter is executed, so its body is checked
  assertDeny(bash("bash <<'EOF'\ncat .env\nEOF"))
  assertDeny(bash('sh <<EOF\ncat .env\nEOF'))
  assertDeny(bash("sudo zsh <<'EOF'\ncat .env\nEOF"))
  assertDeny(bash("source /dev/stdin <<'EOF'\ncat .env\nEOF"))
  assertDeny(bash("cat <<'EOF' | bash\ncat .env\nEOF"))
  assertAllow(bash("bash <<'EOF'\nls\nEOF"))
  // an unquoted delimiter expands substitutions even for a data command
  assertDeny(bash('cat > a.txt <<EOF\n$(cat .env)\nEOF'))
  assertDeny(bash('cat > a.txt <<EOF\n`cat .env`\nEOF'))
  assertAllow(bash("cat > a.txt <<'EOF'\n$(cat .env)\nEOF"))
  // without a terminator nothing is proven to be data
  assertDeny(bash('cat > a.txt <<EOF\ncat .env'))
})

test('T13: a heredoc body is data only when every receiving command is a known data sink', () => {
  const body = 'cat .env'
  const denied = [
    `timeout 30 bash <<'EOF'\n${body}\nEOF`,
    `sudo -u root bash <<'EOF'\n${body}\nEOF`,
    `nice bash <<'EOF'\n${body}\nEOF`,
    `cat <<'EOF' | timeout 5 sh\n${body}\nEOF`,
    `python3.12 - <<'EOF'\nprint(open('.env').read())\nEOF`,
    `docker exec -i app sh <<'EOF'\n${body}\nEOF`,
    `fish <<'EOF'\n${body}\nEOF`,
    `env FOO=1 bash <<'EOF'\n${body}\nEOF`,
    `unknown-tool <<'EOF'\n${body}\nEOF`,
    `cat <<'EOF' | tee out.txt | timeout 5 sh\n${body}\nEOF`,
    `echo hi # <<EOF\ncat .env\nEOF`,
  ]
  for (const c of denied) assertDeny(bash(c))
  // data sinks, alone or chained, stay data
  assertAllow(bash("cat <<'EOF' | tee notes.md\n.env\nEOF"))
  assertAllow(bash("git tag -a v1 -F - <<'EOF'\n.env\nEOF"))
  assertAllow(bash("git commit --file=- <<'EOF'\n.env\nEOF"))
  assertAllow(bash("cat <<'EOF' > .gitignore ; ls\n.env\nEOF"))
  // an unquoted delimiter still expands command substitution for sinks
  assertDeny(bash('tee a.txt <<EOF\n$(cat .env)\nEOF'))
})

test('T16: process substitution on or around a heredoc opener hides the receiver, so the body is checked', () => {
  const body = 'cat .env'
  const denied = [
    `bash <(cat <<'EOF'\n${body}\nEOF\n)`,
    `source <(cat <<'EOF'\n${body}\nEOF\n)`,
    `cat <<'EOF' > >(bash)\n${body}\nEOF`,
    `cat <<'EOF' | tee >(bash)\n${body}\nEOF`,
    `cat <<'EOF' > >(sh) | cat\n${body}\nEOF`,
    `git commit -F - <<'EOF' 2> >(bash)\n${body}\nEOF`,
    `echo $(cat <<'EOF'\n${body}\nEOF\n)`,
    `echo \`cat <<'EOF'\n${body}\nEOF\n\``,
    // gains from the T13 allowlist
    `git -c core.editor=sh commit -F - <<'EOF'\n${body}\nEOF`,
    `/bin/cat <<'EOF'\n${body}\nEOF`,
    `command cat <<'EOF'\n${body}\nEOF`,
    `$CAT <<'EOF'\n${body}\nEOF`,
  ]
  for (const c of denied) assertDeny(bash(c))
  // previous behavior kept
  assertAllow(bash("cat > .gitignore <<EOF\nnode_modules\n.env\nEOF"))
  assertAllow(bash("cat >> .gitignore <<'EOF'\n.env\nEOF"))
  assertAllow(bash("git commit -F - <<'EOF'\nchore: ignore\n.env\nEOF"))
  assertAllow(bash('cat > notes.md <<"EOF"\n.env\nEOF'))
  assertAllow(bash('cat > notes.md <<-EOF\n\t.env\n\tEOF'))
  assertAllow(bash("cat <<'EOF' | tee notes.md\n.env\nEOF"))
  assertAllow(bash("cat <<'EOF'; bash\n.env\nEOF"))
  assertAllow(bash("cat <<'EOF' && bash\n.env\nEOF"))
  assertAllow(bash("cat <<'EOF' > notes.md\n.env\nEOF"))
})
