// install.sh runs the way users run it: piped into bash on stdin. Every tool it
// calls is a stub in a scratch bin directory that records its arguments and
// keeps its state in scratch files, and HOME is scratch, so no test touches the
// real Claude Code configuration.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { scratchDir } from '../helpers/repo.mjs'

const INSTALLER = new URL('../../install.sh', import.meta.url).pathname

// One rule per non-destructive construct-memory command (S21 d).
const MEMORY_RULES = [
  'Bash(construct-memory search *)',
  'Bash(construct-memory get *)',
  'Bash(construct-memory context *)',
  'Bash(construct-memory timeline *)',
  'Bash(construct-memory stats *)',
  'Bash(construct-memory doctor *)',
  'Bash(construct-memory suggest-topic-key *)',
  'Bash(construct-memory save *)',
  'Bash(construct-memory update *)',
  'Bash(construct-memory summary *)',
  'Bash(construct-memory review list *)',
  'Bash(construct-memory review stale *)',
  'Bash(construct-memory prompts --search *)',
  'Bash(construct-memory prompts --limit *)',
  'Bash(construct-memory pin *)',
  'Bash(construct-memory unpin *)',
  'Bash(construct-memory judge *)',
  'Bash(construct-memory judge-many *)',
  'Bash(construct-memory compare *)',
  'Bash(construct-memory help *)',
  'Bash(construct-memory prompts)',
]

// Permission rule semantics (code.claude.com/docs/en/permissions, Bash): a rule ending in ` *`
// matches the bare command and any arguments; any other rule matches only the exact command.
const allows = (rules, command) =>
  rules.some((rule) => {
    const body = rule.slice('Bash('.length, -1)
    return body.endsWith(' *') ? command === body.slice(0, -2) || command.startsWith(body.slice(0, -1)) : command === body
  })

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
esac
exit 0`,
}

// Each stub logs its call and then drains stdin, so a call that inherits the
// piped script would swallow the rest of it.
const stub = (name, body) => `#!/bin/bash\necho "${name} $*" >> "$STUB_LOG"\n${body}\ncat >/dev/null\n`

function sandbox({ engram = false, codegraph = false, node = true } = {}) {
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
  if (engram) put(bin, 'engram', stub('engram', ''))
  if (codegraph) put(bin, 'codegraph', stub('codegraph', ''))
  // Not logged: settings_tool calls node too. STUB_NODE_VERSION fakes `node -p`; STUB_NODE_NOSQLITE fails `node -e` (the probe).
  if (node) {
    put(bin, 'node', `#!/bin/bash
if [ "$1" = "-p" ] && [ -n "$STUB_NODE_VERSION" ]; then echo "$STUB_NODE_VERSION"; exit 0; fi
if [ "$1" = "-e" ] && [ -n "$STUB_NODE_NOSQLITE" ]; then echo "ERR_NO_FTS5" >&2; exit 1; fi
exec "${process.execPath}" "$@"
`)
  }
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
  const box = sandbox()
  const run = install(box)
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(run.calls.filter((c) => !/--version|list/.test(c)), [
    'claude plugin marketplace add carsimax/construct#v6.1.0',
    'claude plugin install construct@construct',
  ])
  assert.ok(!run.calls.some((c) => /context7/.test(c)), 'context7 is never registered')
  assert.deepEqual(readSettings(box), {
    permissions: { allow: MEMORY_RULES },
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
    permissions: { allow: ['Bash(ls *)', 'mcp__engram', ...MEMORY_RULES], deny: ['Bash(rm *)'] },
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
  assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')).permissions.allow, MEMORY_RULES)
})

test('the merge keeps the file mode of settings.json', () => {
  const box = sandbox()
  writeSettings(box, { model: 'opus' })
  chmodSync(settingsPath(box), 0o600)
  const run = install(box)
  assert.equal(run.status, 0, run.stderr)
  assert.equal(statSync(settingsPath(box)).mode & 0o777, 0o600)
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
  const box = sandbox()
  assert.equal(install(box).status, 0)
  const settings = readFileSync(settingsPath(box), 'utf8')
  const second = install(box)
  assert.equal(second.status, 0, second.stderr)
  const writes = second.calls.filter((c) => /^(brew|npm|engram|codegraph|claude (plugin (install|marketplace add)|mcp))/.test(c))
  assert.deepEqual(writes, [])
  assert.equal(readFileSync(settingsPath(box), 'utf8'), settings)
  assert.deepEqual(backups(box), [])
  assert.match(second.stdout, /Skipped:/)
})

test('a marketplace whose name only starts with the repository is not counted as added', () => {
  const box = sandbox()
  writeFileSync(join(box.state, 'marketplaces'), '    Source: GitHub (carsimax/construct-foo)\n')
  const run = install(box)
  assert.equal(run.status, 0, run.stderr)
  assert.ok(run.calls.some((c) => /^claude plugin marketplace add carsimax\/construct#/.test(c)), 'construct marketplace is added')
})

test('--no-mcp is accepted, deprecated, and changes nothing', () => {
  const box = sandbox()
  const plain = install(box)
  const again = install(sandbox(), ['--no-mcp'])
  assert.equal(again.status, 0, again.stderr)
  assert.deepEqual(again.calls, plain.calls)
  assert.equal(again.stderr.match(/--no-mcp is deprecated and has no effect/g)?.length, 1)
  assert.match(again.stdout, /Warnings:[\s\S]*--no-mcp is deprecated/)
  assert.doesNotMatch(plain.stdout + plain.stderr, /--no-mcp/)
  assert.match(install(box, ['--help']).stdout, /--no-mcp\s+Deprecated/)
})

test('an existing codegraph is left alone: one line says it is not needed, and no npm or mcp command runs', () => {
  const box = sandbox({ codegraph: true })
  const run = install(box)
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stdout.split('\n').filter((l) => /codegraph.*no longer needs it/i.test(l) || /Construct no longer needs codegraph/i.test(l)).length, 1)
  assert.match(run.stdout, /claude mcp remove --scope user codegraph/)
  assert.deepEqual(run.calls.filter((c) => /^(npm|codegraph|claude mcp)/.test(c)), [])
})

test('without codegraph nothing about it is printed', () => {
  const run = install(sandbox())
  assert.doesNotMatch(run.stdout + run.stderr, /codegraph/i)
})

test('preflight stops before any change when a requirement is missing or too old', () => {
  for (const [label, box, env, pattern] of [
    ['old claude', sandbox(), { STUB_CLAUDE_VERSION: '2.1.200' }, /2\.1\.304/],
    ['no node', sandbox({ node: false }), {}, /node/i],
    ['old node', sandbox(), { STUB_NODE_VERSION: '22.15.9' }, /22\.16/],
    ['old node, lower minor', sandbox(), { STUB_NODE_VERSION: '22.9.0' }, /22\.16/],
    ['node 23 without fts5', sandbox(), { STUB_NODE_VERSION: '23.11.0', STUB_NODE_NOSQLITE: '1' }, /node:sqlite.*FTS5.*22\.16/],
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

test('the installer never grants anything beyond the construct-memory CLI', () => {
  const text = readFileSync(INSTALLER, 'utf8')
  assert.doesNotMatch(text, /skipDangerousModePermissionPrompt|bypassPermissions|defaultMode/)
  assert.match(text.trimEnd().split('\n').at(-1), /^main "\$@"$/, 'main runs on the last line')
})

const NOTHING_INSTALLED = (run) => run.calls.filter((c) => /install|marketplace add|mcp add|setup/.test(c))

test('a read-only ~/.claude stops the preflight with one clear message and no change', { skip: process.getuid?.() === 0 }, () => {
  const box = sandbox()
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
  const box = sandbox()
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
      permissions: { allow: MEMORY_RULES },
    })
    assert.equal(statSync(settingsPath(box)).mode & 0o777, 0o600)
  }
})

test('a settings.json that is a directory stops the preflight with one clear message and no change', () => {
  const box = sandbox()
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
  const box = sandbox()
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
  const box = sandbox()
  mkdirSync(join(box.home, '.claude'))
  symlinkSync(settingsPath(box), settingsPath(box))
  const run = install(box)
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /construct-install: .*not a directory, or .*loops/)
  assert.doesNotMatch(run.stderr, CLEAN)
  assert.deepEqual(NOTHING_INSTALLED(run), [])
})

test('a regular file at ~/.claude stops the preflight with an accurate one-line message', () => {
  const box = sandbox()
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
  const box = sandbox()
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
  const box = sandbox()
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
  const before = JSON.stringify({ theme: 'dark', permissions: { allow: MEMORY_RULES } }, null, 2)
  writeSettings(box, before)
  const run = install(box, ['--force'])
  assert.equal(run.status, 0, run.stderr)
  assert.equal(readFileSync(settingsPath(box), 'utf8'), before)
  assert.deepEqual(backups(box), [])
})

const PLUGIN_LIST = (version) => `Installed plugins:\n\n  ❯ construct@construct\n${version ? `    Version: ${version}\n` : ''}    Scope: user\n`

test('an installed construct at another version warns and names the update command, and changes nothing', () => {
  const box = sandbox()
  writeFileSync(join(box.state, 'plugins'), PLUGIN_LIST('2.1.0'))
  const run = install(box)
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.stderr, /construct@construct 2\.1\.0 is installed.*6\.1\.0.*claude plugin update construct@construct/)
  assert.match(run.stdout, /Warnings:/)
  assert.ok(!run.calls.some((c) => /^claude plugin (install|update)/.test(c)), 'the install is never modified')
})

test('an installed construct at this version, a newer one, or with no readable version, gets the plain skip', () => {
  for (const version of ['6.1.0', '6.2.0', '']) {
    const box = sandbox()
    writeFileSync(join(box.state, 'plugins'), PLUGIN_LIST(version))
    const run = install(box)
    assert.equal(run.status, 0, run.stderr)
    assert.doesNotMatch(run.stderr, /claude plugin update/)
    assert.match(run.stdout, /construct@construct \(already installed\)/)
  }
})

test('a marketplace pinned to another ref warns; the same ref skips quietly', () => {
  for (const [ref, warns] of [['v6.0.0', true], ['v6.1.0', false]]) {
    const box = sandbox()
    writeFileSync(join(box.state, 'marketplaces'), `  ❯ construct\n    Source: GitHub (carsimax/construct#${ref})\n`)
    const run = install(box)
    assert.equal(run.status, 0, run.stderr)
    assert.equal(/pinned to v6\.0\.0, not v6\.1\.0/.test(run.stderr), warns)
  }
})

test('CONSTRUCT_REF and the header URL carry the plugin.json version', () => {
  const { version } = JSON.parse(readFileSync(new URL('../../plugins/construct/.claude-plugin/plugin.json', import.meta.url), 'utf8'))
  const text = readFileSync(INSTALLER, 'utf8')
  assert.equal(/^CONSTRUCT_REF=(\S+)/m.exec(text)?.[1], `v${version}`)
  assert.match(text, new RegExp(`raw\\.githubusercontent\\.com/carsimax/construct/v${version.replace(/\./g, '\\.')}/install\\.sh`))
})

test('node 22.16 passes the check, a newer minor than the installed major.minor compares numerically', () => {
  for (const version of ['22.16.0', '22.22.1', '24.0.0']) {
    const run = install(sandbox(), [], { STUB_NODE_VERSION: version })
    assert.equal(run.status, 0, `${version}: ${run.stderr}`)
  }
})

test('the node:sqlite FTS5 probe fails with one clear line and nothing is installed', () => {
  const box = sandbox()
  const run = install(box, [], { STUB_NODE_NOSQLITE: '1' })
  assert.notEqual(run.status, 0)
  const lines = run.stderr.split('\n').filter((l) => /construct-install:/.test(l))
  assert.deepEqual(lines, [`construct-install: Node.js ${process.versions.node} has no node:sqlite with FTS5 trigram, which Construct memory needs; use Node.js 22.16 or later (Node.js 23 is not supported)`])
  assert.doesNotMatch(run.stderr, /ERR_NO_FTS5/)
  assert.deepEqual(run.calls.filter((c) => !/--version/.test(c)), [])
  assert.equal(existsSync(settingsPath(box)), false)
})

test('the probe in install.sh is the doctor probe', () => {
  const sh = readFileSync(INSTALLER, 'utf8')
  const doctor = readFileSync(new URL('../../plugins/construct/hooks/status/doctor.js', import.meta.url), 'utf8')
  const sql = (t) => /CREATE VIRTUAL TABLE t USING fts5\(x, tokenize='trigram'\)/.exec(t)?.[0]
  assert.ok(sql(doctor) && sql(sh), 'both create the same trigram table')
})

test('engram is never installed, set up, uninstalled, or given permission rules; one line says it is not needed', () => {
  const box = sandbox({ engram: true })
  const before = { permissions: { allow: ['mcp__engram', 'mcp__plugin_engram_engram'] } }
  writeSettings(box, before)
  const run = install(box)
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(run.calls.filter((c) => /engram|brew/i.test(c)), [])
  assert.equal(run.stdout.split('\n').filter((l) => /no longer needs? engram|engram.*no longer/i.test(l)).length, 1)
  assert.deepEqual(readSettings(box).permissions.allow, ['mcp__engram', 'mcp__plugin_engram_engram', ...MEMORY_RULES], 'the user keeps their rules')
})

test('without engram nothing about it is printed, and no engram rule or marketplace is added', () => {
  const box = sandbox()
  const run = install(box)
  assert.equal(run.status, 0, run.stderr)
  assert.doesNotMatch(run.stdout + run.stderr, /engram/i)
  assert.doesNotMatch(readFileSync(settingsPath(box), 'utf8'), /engram/)
  assert.equal(run.calls.some((c) => /marketplace add/.test(c) && !/carsimax\/construct/.test(c)), false)
})

test('the construct-memory rule is merged once; a second run keeps it a single entry', () => {
  const box = sandbox()
  assert.equal(install(box).status, 0)
  assert.equal(install(box).status, 0)
  assert.deepEqual(readSettings(box).permissions.allow, MEMORY_RULES)
})

test('the merged rules pre-approve reads and saves and never a destructive construct-memory command', () => {
  const box = sandbox()
  assert.equal(install(box).status, 0)
  const rules = readSettings(box).permissions.allow
  assert.deepEqual(rules, MEMORY_RULES)
  // These prefixes are only safe because the CLI refuses trailing options and words that reach a destructive form
  // (tests/memory/cli.test.mjs, 'a pre-approved prefix plus a destructive suffix'); the rules alone would match `prompts --limit 5 delete 1`.
  for (const ok of ['search auth bug', 'prompts', 'prompts --search x', 'prompts --limit 5', 'review list', 'review list --limit 5', 'review stale', 'review stale --json', 'doctor --json', 'help'])
    assert.ok(allows(rules, `construct-memory ${ok}`), ok)
  for (const bad of ['delete 1 --hard', 'delete 1', 'prompts delete 1', 'export x.json', 'consolidate 1 2', 'import x.json', 'review done 1'])
    assert.ok(!allows(rules, `construct-memory ${bad}`), bad)
})
