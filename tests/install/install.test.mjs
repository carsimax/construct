// install.sh runs the way users run it: piped into bash on stdin. Every tool it
// calls is a stub in a scratch bin directory that records its arguments and
// keeps its state in scratch files, and HOME is scratch, so no test touches the
// real Claude Code configuration.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { scratchDir } from '../assess/helpers.mjs'

const INSTALLER = new URL('../../install.sh', import.meta.url).pathname

const STUBS = {
  claude: `
if [ "$1" = "--version" ]; then echo "\${STUB_CLAUDE_VERSION:-2.1.304} (Claude Code)"; exit 0; fi
case "$1 $2 $3" in
  "plugin marketplace list") cat "$STUB_STATE/marketplaces" 2>/dev/null; exit 0 ;;
  "plugin marketplace add") echo "    Source: GitHub ($4)" >> "$STUB_STATE/marketplaces"; exit 0 ;;
esac
case "$1 $2" in
  "plugin list") cat "$STUB_STATE/plugins" 2>/dev/null; exit 0 ;;
  "plugin install") echo "  ❯ $3" >> "$STUB_STATE/plugins"; exit 0 ;;
  "mcp get") grep -qx "$3" "$STUB_STATE/mcps" 2>/dev/null; exit $? ;;
  "mcp add") echo "$5" >> "$STUB_STATE/mcps"; exit 0 ;;
esac
exit 0`,
  engram: `
if [ "$1 $2" = "setup claude-code" ]; then echo engram >> "$STUB_STATE/mcps"; echo "  ❯ engram@engram" >> "$STUB_STATE/plugins"; fi`,
  brew: `
if [ "$1" = "install" ]; then cp "$STUB_STATE/engram-stub" "$(dirname "$0")/engram"; chmod +x "$(dirname "$0")/engram"; fi`,
  npm: `
if [ -n "$STUB_NPM_FAIL" ]; then echo "npm error code EACCES" >&2; exit 243; fi
if [ "$1 $2" = "install -g" ]; then cp "$STUB_STATE/codegraph-stub" "$(dirname "$0")/codegraph"; chmod +x "$(dirname "$0")/codegraph"; fi`,
}

// Each stub logs its call and then drains stdin, so a call that inherits the
// piped script would swallow the rest of it.
const stub = (name, body) => `#!/bin/bash\necho "${name} $*" >> "$STUB_LOG"\n${body}\ncat >/dev/null\n`

function sandbox({ engram = true, node = true, brew = true } = {}) {
  const root = scratchDir('construct-install-')
  const bin = join(root, 'bin')
  const state = join(root, 'state')
  const home = join(root, 'home')
  for (const dir of [bin, state, home]) mkdirSync(dir)
  const put = (dir, name, text) => {
    writeFileSync(join(dir, name), text)
    chmodSync(join(dir, name), 0o755)
  }
  put(bin, 'claude', stub('claude', STUBS.claude))
  put(bin, 'npm', stub('npm', STUBS.npm))
  if (brew) put(bin, 'brew', stub('brew', STUBS.brew))
  put(state, 'engram-stub', stub('engram', STUBS.engram))
  put(state, 'codegraph-stub', stub('codegraph', ''))
  if (engram) put(bin, 'engram', stub('engram', STUBS.engram))
  if (node) symlinkSync(process.execPath, join(bin, 'node'))
  return { root, bin, state, home, log: join(root, 'calls.log') }
}

function install(box, args = [], env = {}) {
  writeFileSync(box.log, '')
  const result = spawnSync('/bin/bash', ['-s', '--', ...args], {
    input: readFileSync(INSTALLER, 'utf8'),
    encoding: 'utf8',
    env: {
      PATH: `${box.bin}:/usr/bin:/bin`,
      HOME: box.home,
      STUB_LOG: box.log,
      STUB_STATE: box.state,
      ...env,
    },
  })
  return { ...result, calls: readFileSync(box.log, 'utf8').split('\n').filter(Boolean) }
}

const settingsPath = (box) => join(box.home, '.claude', 'settings.json')
const readSettings = (box) => JSON.parse(readFileSync(settingsPath(box), 'utf8'))
const writeSettings = (box, value) => {
  mkdirSync(join(box.home, '.claude'), { recursive: true })
  writeFileSync(settingsPath(box), typeof value === 'string' ? value : JSON.stringify(value, null, 2))
}
const backups = (box) => readdirSync(join(box.home, '.claude')).filter((f) => f.startsWith('settings.json.bak-'))

test('a clean machine gets every tool, in order, and the Construct settings', () => {
  const box = sandbox({ engram: false })
  const run = install(box)
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(run.calls.filter((c) => !/--version|list|mcp get/.test(c)), [
    'brew install gentleman-programming/tap/engram',
    'engram setup claude-code',
    'claude plugin marketplace add Gentleman-Programming/engram',
    'claude plugin marketplace add carsimax/construct',
    'claude plugin install construct@construct',
    'npm install -g @colbymchenry/codegraph',
    'claude mcp add --scope user codegraph -- codegraph serve --mcp',
  ])
  assert.ok(!run.calls.some((c) => /context7/.test(c)), 'context7 is never registered')
  assert.deepEqual(readSettings(box), {
    theme: 'custom:construct:construct',
    permissions: { allow: ['mcp__engram', 'mcp__plugin_engram_engram'] },
  })
  assert.deepEqual(backups(box), [], 'no backup when there was no file')
  assert.match(run.stdout, /Installed:/)
})

test('existing settings are merged, never overwritten, and backed up first', () => {
  const box = sandbox()
  const before = {
    model: 'opus',
    skipDangerousModePermissionPrompt: false,
    permissions: { allow: ['Bash(ls *)', 'mcp__engram'], deny: ['Bash(rm *)'] },
  }
  writeSettings(box, before)
  const run = install(box)
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(readSettings(box), {
    ...before,
    permissions: { allow: ['Bash(ls *)', 'mcp__engram', 'mcp__plugin_engram_engram'], deny: ['Bash(rm *)'] },
    theme: 'custom:construct:construct',
  })
  const [backup] = backups(box)
  assert.ok(backup, 'a backup exists')
  assert.deepEqual(JSON.parse(readFileSync(join(box.home, '.claude', backup), 'utf8')), before)
  assert.match(run.stdout, new RegExp(backup.replace(/[.]/g, '\\.')))
})

test('a symlinked settings.json stays a link and its target gets the merge', () => {
  const box = sandbox()
  const target = join(box.root, 'dotfiles-settings.json')
  writeFileSync(target, JSON.stringify({ model: 'opus' }))
  mkdirSync(join(box.home, '.claude'))
  symlinkSync(target, settingsPath(box))
  const run = install(box)
  assert.equal(run.status, 0, run.stderr)
  assert.ok(lstatSync(settingsPath(box)).isSymbolicLink(), 'still a symlink')
  assert.equal(JSON.parse(readFileSync(target, 'utf8')).theme, 'custom:construct:construct')
  assert.equal(JSON.parse(readFileSync(target, 'utf8')).model, 'opus')
})

test('the merge keeps the file mode of settings.json', () => {
  const box = sandbox()
  writeSettings(box, { model: 'opus' })
  chmodSync(settingsPath(box), 0o600)
  const run = install(box)
  assert.equal(run.status, 0, run.stderr)
  assert.equal(statSync(settingsPath(box)).mode & 0o777, 0o600)
})

test('a failed codegraph install warns and still merges the settings', () => {
  const box = sandbox()
  const run = install(box, [], { STUB_NPM_FAIL: '1' })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stderr, /codegraph.*--no-mcp/)
  assert.deepEqual(run.calls.filter((c) => /^claude mcp add --scope user codegraph/.test(c)), [])
  assert.equal(readSettings(box).theme, 'custom:construct:construct')
})

test('a different theme is kept with a warning unless --force, and outputStyle is never touched', () => {
  const box = sandbox()
  writeSettings(box, { theme: 'dark', outputStyle: 'Explanatory' })
  const kept = install(box)
  assert.equal(kept.status, 0, kept.stderr)
  assert.equal(readSettings(box).theme, 'dark')
  assert.match(kept.stdout + kept.stderr, /theme.*--force/)
  assert.doesNotMatch(kept.stdout + kept.stderr, /outputStyle/)

  const forced = install(box, ['--force'])
  assert.equal(forced.status, 0, forced.stderr)
  assert.equal(readSettings(box).theme, 'custom:construct:construct')
  assert.equal(readSettings(box).outputStyle, 'Explanatory')
})

test('a second run changes nothing and installs nothing', () => {
  const box = sandbox({ engram: false })
  assert.equal(install(box).status, 0)
  const settings = readFileSync(settingsPath(box), 'utf8')
  const second = install(box)
  assert.equal(second.status, 0, second.stderr)
  const writes = second.calls.filter((c) => /^(brew install|npm install|engram setup|claude plugin (install|marketplace add)|claude mcp add)/.test(c))
  assert.deepEqual(writes, [])
  assert.equal(readFileSync(settingsPath(box), 'utf8'), settings)
  assert.deepEqual(backups(box), [])
  assert.match(second.stdout, /Skipped:/)
})

test('--no-mcp leaves the codegraph MCP server and CLI alone', () => {
  const box = sandbox()
  const run = install(box, ['--no-mcp'])
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /codegraph MCP server \(--no-mcp\)/)
  assert.deepEqual(run.calls.filter((c) => /^(npm|claude mcp)/.test(c)), [])
})

test('preflight stops before any change when a requirement is missing or too old', () => {
  for (const [label, box, env, pattern] of [
    ['old claude', sandbox(), { STUB_CLAUDE_VERSION: '2.1.200' }, /2\.1\.304/],
    ['no node', sandbox({ node: false }), {}, /node/i],
    ['no brew without engram', sandbox({ engram: false, brew: false }), {}, /brew/i],
  ]) {
    const run = install(box, [], env)
    assert.notEqual(run.status, 0, label)
    assert.match(run.stderr, pattern, label)
    assert.deepEqual(run.calls.filter((c) => !/--version/.test(c)), [], `${label}: nothing ran`)
    assert.equal(existsSync(settingsPath(box)), false, `${label}: no settings written`)
  }
})

test('invalid settings JSON aborts the merge and leaves the file untouched', () => {
  const box = sandbox()
  writeSettings(box, '{ "theme": ')
  const run = install(box)
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /settings\.json/)
  assert.equal(readFileSync(settingsPath(box), 'utf8'), '{ "theme": ')
  assert.deepEqual(backups(box), [])
  assert.deepEqual(run.calls.filter((c) => /install|add|setup/.test(c)), [], 'checked before any install')
})

test('an unknown option is rejected before any change', () => {
  const box = sandbox()
  const run = install(box, ['--bogus'])
  assert.equal(run.status, 2)
  assert.match(run.stderr, /--bogus/)
  assert.deepEqual(run.calls, [])
})

test('the installer never grants anything beyond the engram MCP servers', () => {
  const text = readFileSync(INSTALLER, 'utf8')
  assert.doesNotMatch(text, /skipDangerousModePermissionPrompt|bypassPermissions|defaultMode/)
  assert.match(text.trimEnd().split('\n').at(-1), /^main "\$@"$/, 'main runs on the last line')
})

const NOTHING_INSTALLED = (run) => run.calls.filter((c) => /install|marketplace add|mcp add|setup/.test(c))

test('a read-only ~/.claude stops the preflight with one clear message and no change', { skip: process.getuid?.() === 0 }, () => {
  const box = sandbox({ engram: false })
  const dir = join(box.home, '.claude')
  mkdirSync(dir)
  chmodSync(dir, 0o555)
  try {
    const run = install(box)
    assert.notEqual(run.status, 0)
    assert.match(run.stderr, /construct-install: .*\.claude exists but is not writable/)
    assert.doesNotMatch(run.stderr, /at .*\.js|node:internal|Error:/)
    assert.deepEqual(NOTHING_INSTALLED(run), [])
    assert.deepEqual(readdirSync(dir), [])
  } finally {
    chmodSync(dir, 0o755)
  }
})

test('a read-only settings.json stops the preflight with one clear message and no change', { skip: process.getuid?.() === 0 }, () => {
  const box = sandbox({ engram: false })
  writeSettings(box, { model: 'opus' })
  chmodSync(settingsPath(box), 0o444)
  const run = install(box)
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /construct-install: .*settings\.json is not writable/)
  assert.doesNotMatch(run.stderr, /at .*\.js|node:internal|Error:/)
  assert.deepEqual(NOTHING_INSTALLED(run), [])
  assert.deepEqual(readSettings(box), { model: 'opus' })
  assert.deepEqual(backups(box), [])
})

test('an empty or whitespace-only settings.json is treated as an empty object', () => {
  for (const content of ['', ' \n\t\n']) {
    const box = sandbox()
    writeSettings(box, content)
    chmodSync(settingsPath(box), 0o600)
    const run = install(box)
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(readSettings(box), {
      theme: 'custom:construct:construct',
      permissions: { allow: ['mcp__engram', 'mcp__plugin_engram_engram'] },
    })
    assert.equal(statSync(settingsPath(box)).mode & 0o777, 0o600)
  }
})
