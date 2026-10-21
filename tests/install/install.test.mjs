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
  "mcp add") [ -n "$STUB_MCP_FAIL" ] && { echo "mcp add failed" >&2; exit 1; }; echo "$5" >> "$STUB_STATE/mcps"; exit 0 ;;
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
    'claude plugin marketplace add carsimax/construct#v1.3.0',
    'claude plugin install construct@construct',
    'npm install -g @colbymchenry/codegraph',
    'claude mcp add --scope user codegraph -- codegraph serve --mcp',
  ])
  assert.ok(!run.calls.some((c) => /context7/.test(c)), 'context7 is never registered')
  assert.deepEqual(readSettings(box), {
    permissions: { allow: ['mcp__engram', 'mcp__plugin_engram_engram'] },
  })
  assert.ok(!('theme' in readSettings(box)), 'a clean machine never gets a theme')
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
  assert.equal(JSON.parse(readFileSync(target, 'utf8')).theme, undefined)
  assert.equal(JSON.parse(readFileSync(target, 'utf8')).model, 'opus')
  assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')).permissions.allow, ['mcp__engram', 'mcp__plugin_engram_engram'])
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
  assert.equal(readSettings(box).theme, undefined)
})

test('a failed MCP registration warns and still merges the settings and prints the summary', () => {
  const box = sandbox()
  const run = install(box, [], { STUB_MCP_FAIL: '1' })
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stderr, /for the codegraph MCP server failed/)
  assert.deepEqual(readSettings(box).permissions.allow, ['mcp__engram', 'mcp__plugin_engram_engram'])
  assert.match(run.stdout, /codegraph CLI/)
})

test('MIN_CLAUDE and MIN_NODE match the doctor minimums', () => {
  const sh = readFileSync(INSTALLER, 'utf8')
  const doctor = readFileSync(new URL('../../plugins/construct/hooks/status/doctor.js', import.meta.url), 'utf8')
  for (const k of ['MIN_CLAUDE', 'MIN_NODE']) {
    assert.equal(sh.match(new RegExp(`^${k}=(\\S+)`, 'm'))[1], doctor.match(new RegExp(`${k} = '?([\\d.]+)`))[1], k)
  }
})

const OLD_THEME = 'custom:construct:construct'

test('the old Construct theme is removed with a backup and a + line; the rest is kept', () => {
  const box = sandbox()
  const before = { theme: OLD_THEME, model: 'opus', outputStyle: 'Explanatory' }
  writeSettings(box, before)
  const run = install(box)
  assert.equal(run.status, 0, run.stderr)
  assert.equal('theme' in readSettings(box), false)
  assert.equal(readSettings(box).model, 'opus')
  assert.equal(readSettings(box).outputStyle, 'Explanatory')
  assert.match(run.stdout, /setting: theme custom:construct:construct removed/)
  const [backup] = backups(box)
  assert.ok(backup, 'a backup exists')
  assert.deepEqual(JSON.parse(readFileSync(join(box.home, '.claude', backup), 'utf8')), before)

  const again = install(box)
  assert.equal(again.status, 0, again.stderr)
  assert.doesNotMatch(again.stdout, /theme/)
  assert.equal(backups(box).length, 1, 'the second run makes no new backup')
})

test('any other theme value is kept with no warning, and outputStyle is never touched', () => {
  for (const theme of ['dark', 'custom:other:theme']) {
    const box = sandbox()
    writeSettings(box, { theme, outputStyle: 'Explanatory' })
    const run = install(box)
    assert.equal(run.status, 0, run.stderr)
    assert.equal(readSettings(box).theme, theme)
    assert.equal(readSettings(box).outputStyle, 'Explanatory')
    assert.doesNotMatch(run.stdout + run.stderr, /theme|outputStyle/)
  }
})

test('--force is accepted, has no effect, and prints a deprecation warning', () => {
  const box = sandbox()
  writeSettings(box, { theme: 'dark' })
  const run = install(box, ['--force'])
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stderr, /--force is deprecated and has no effect/)
  assert.match(run.stdout, /Warnings:[\s\S]*--force is deprecated/)
  assert.equal(readSettings(box).theme, 'dark', 'a different theme is not replaced')

  const plain = install(box)
  assert.doesNotMatch(plain.stdout + plain.stderr, /--force/)
})

test('the help text marks --force deprecated and no longer mentions replacing a theme', () => {
  const box = sandbox()
  const run = install(box, ['--help'])
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stdout, /--force\s+Deprecated/)
  assert.doesNotMatch(run.stdout, /theme/)
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

test('a marketplace whose name only starts with the repository is not counted as added', () => {
  const box = sandbox()
  writeFileSync(join(box.state, 'marketplaces'), '    Source: GitHub (carsimax/construct-foo)\n    Source: GitHub (Gentleman-Programming/engram)\n')
  const run = install(box)
  assert.equal(run.status, 0, run.stderr)
  assert.ok(run.calls.some((c) => /^claude plugin marketplace add carsimax\/construct#/.test(c)), 'construct marketplace is added')
  assert.equal(run.calls.some((c) => /marketplace add Gentleman-Programming\/engram/.test(c)), false, 'the exact match is skipped')
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
      permissions: { allow: ['mcp__engram', 'mcp__plugin_engram_engram'] },
    })
    assert.equal(statSync(settingsPath(box)).mode & 0o777, 0o600)
  }
})

test('a settings.json that is a directory stops the preflight with one clear message and no change', () => {
  const box = sandbox({ engram: false })
  mkdirSync(settingsPath(box), { recursive: true })
  const run = install(box)
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /construct-install: .*settings\.json is a directory/)
  assert.doesNotMatch(run.stderr, /at .*\.js|node:internal|Error:|EISDIR/)
  assert.deepEqual(NOTHING_INSTALLED(run), [])
  assert.ok(statSync(settingsPath(box)).isDirectory(), 'the directory is untouched')
})

test('a dangling-symlink settings.json stays a link and its target is created with the merge', () => {
  const box = sandbox()
  const target = join(box.root, 'dotfiles', 'settings.json')
  mkdirSync(join(box.home, '.claude'))
  symlinkSync(target, settingsPath(box))
  const run = install(box)
  assert.equal(run.status, 0, run.stderr)
  assert.ok(lstatSync(settingsPath(box)).isSymbolicLink(), 'still a symlink')
  assert.equal(JSON.parse(readFileSync(target, 'utf8')).theme, undefined)
  assert.deepEqual(readSettings(box), JSON.parse(readFileSync(target, 'utf8')))
})

const CLEAN = /at .*\.js|node:|Error:|ELOOP|ENOTDIR|EISDIR/

test('a symlink-loop settings.json stops the preflight with one clean message and no change', () => {
  const box = sandbox({ engram: false })
  mkdirSync(join(box.home, '.claude'))
  symlinkSync(join(box.home, '.claude', 'b.json'), settingsPath(box))
  symlinkSync(settingsPath(box), join(box.home, '.claude', 'b.json'))
  const run = install(box)
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /construct-install: .*not a directory, or .*loops/)
  assert.doesNotMatch(run.stderr, CLEAN)
  assert.deepEqual(NOTHING_INSTALLED(run), [])
  assert.ok(lstatSync(settingsPath(box)).isSymbolicLink(), 'the link is untouched')
})

test('a self-referencing settings.json symlink stops the preflight cleanly', () => {
  const box = sandbox({ engram: false })
  mkdirSync(join(box.home, '.claude'))
  symlinkSync(settingsPath(box), settingsPath(box))
  const run = install(box)
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /construct-install: .*not a directory, or .*loops/)
  assert.doesNotMatch(run.stderr, CLEAN)
  assert.deepEqual(NOTHING_INSTALLED(run), [])
})

test('a regular file at ~/.claude stops the preflight with an accurate one-line message', () => {
  const box = sandbox({ engram: false })
  writeFileSync(join(box.home, '.claude'), 'x')
  const run = install(box)
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /construct-install: .*not a directory, or .*loops/)
  assert.doesNotMatch(run.stderr, /symlink loop or a link/)
  assert.doesNotMatch(run.stderr, CLEAN)
  assert.equal(run.stderr.trim().split('\n').filter((l) => /construct-install:/.test(l)).length, 1)
  assert.deepEqual(NOTHING_INSTALLED(run), [])
})

test('a dangling settings.json link through a regular file stops the preflight cleanly', () => {
  const box = sandbox({ engram: false })
  mkdirSync(join(box.home, '.claude'))
  writeFileSync(join(box.root, 'plain'), 'x')
  symlinkSync(join(box.root, 'plain', 'settings.json'), settingsPath(box))
  const run = install(box)
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /construct-install: .*not a directory/)
  assert.doesNotMatch(run.stderr, CLEAN)
  assert.deepEqual(NOTHING_INSTALLED(run), [])
})

test('a settings.json symlink to a directory gets the clean directory refusal', () => {
  const box = sandbox({ engram: false })
  mkdirSync(join(box.home, '.claude'))
  mkdirSync(join(box.root, 'dir'))
  symlinkSync(join(box.root, 'dir'), settingsPath(box))
  const run = install(box)
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /construct-install: .*settings\.json is a directory/)
  assert.doesNotMatch(run.stderr, CLEAN)
  assert.deepEqual(NOTHING_INSTALLED(run), [])
})

test('settings.local.json is never touched, even with the old theme in it', () => {
  const box = sandbox()
  const local = join(box.home, '.claude', 'settings.local.json')
  const text = '{"theme":"custom:construct:construct"}'
  writeSettings(box, { model: 'opus' })
  writeFileSync(local, text)
  const run = install(box)
  assert.equal(run.status, 0, run.stderr)
  assert.equal(readFileSync(local, 'utf8'), text)
})

test('--force with another theme leaves settings.json unchanged and makes no backup', () => {
  const box = sandbox()
  const before = JSON.stringify({ theme: 'dark', permissions: { allow: ['mcp__engram', 'mcp__plugin_engram_engram'] } }, null, 2)
  writeSettings(box, before)
  const run = install(box, ['--force'])
  assert.equal(run.status, 0, run.stderr)
  assert.equal(readFileSync(settingsPath(box), 'utf8'), before)
  assert.deepEqual(backups(box), [])
})
