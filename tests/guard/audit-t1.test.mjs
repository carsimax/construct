// audit-findings T1: S1 shared git value flags, S3 globs and expansions, S4 symlinks, S17/S18 shared guard constants.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { scratchDir } from '../assess/helpers.mjs'

const SCRIPTS = new URL('../../plugins/construct/hooks/scripts/', import.meta.url).pathname
const SCRIPT = join(SCRIPTS, 'secret-guard.mjs')
const home = scratchDir('guard-t1-home-')
const work = scratchDir('guard-t1-work-')
mkdirSync(join(home, '.ssh'), { recursive: true })

function decision(tool_name, tool_input, cwd = work) {
  const r = spawnSync('node', [SCRIPT], { input: JSON.stringify({ tool_name, tool_input, cwd }), encoding: 'utf8', env: { ...process.env, HOME: home } })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout.includes('"deny"') ? 'deny' : 'allow'
}
const bash = (command) => decision('Bash', { command })

test('S1: both guards skip --super-prefix and --config-env values', () => {
  assert.equal(bash('git --super-prefix x reset --hard'), 'deny')
  assert.equal(bash('git --config-env a=B push --force origin main'), 'deny')
})

test('S3: globs and expansions that can name a protected path are denied', () => {
  for (const c of ['cat .en?', 'cat .[e]nv', 'cat ~/.s?h/id_rsa', 'f=.en; cat ${f}v', 'cat .e$(true)nv', 'cat ".e$(true)nv"', "cat $'.en\\x76'", "cat $'.\\145nv'", 'cat `echo x`.env']) {
    assert.equal(bash(c), 'deny', c)
  }
})

test('S3: variables, quoted HOME, and ordinary globs stay allowed', () => {
  for (const c of ['cat $f', 'cat "$HOME/notes.txt"', 'ls *.js', 'cat src/*.ts', 'cat ${f}', 'cat $(pwd)/README.md', "echo $'a\\nb'", 'ls $dir/src']) {
    assert.equal(bash(c), 'allow', c)
  }
})

test('S4: a symlink to a protected path is denied for Read and cat', () => {
  writeFileSync(join(home, '.ssh', 'id_rsa'), 'k')
  symlinkSync(join(home, '.ssh', 'id_rsa'), join(work, 'innocent.txt'))
  symlinkSync(join(home, '.ssh'), join(work, 'dirlink'))
  writeFileSync(join(work, 'plain.txt'), 'x')
  assert.equal(decision('Read', { file_path: join(work, 'innocent.txt') }), 'deny')
  assert.equal(bash('cat innocent.txt'), 'deny')
  assert.equal(bash('cat dirlink/id_rsa'), 'deny')
  assert.equal(decision('Read', { file_path: join(work, 'plain.txt') }), 'allow')
  assert.equal(bash('cat plain.txt missing.txt'), 'allow')
})

test('S18: one SHELLS, one GIT_VALUE_FLAGS and one rm-root rule live in shell-words.mjs', async () => {
  const words = await import(join(SCRIPTS, 'shell-words.mjs'))
  assert.ok(words.SHELLS.has('zsh'))
  assert.ok(words.GIT_VALUE_FLAGS.has('--super-prefix'))
  const expand = (w) => w.replace(/^~/, '/home/u')
  for (const t of ['/', '/*', '.', '..', '~', '~/', '$HOME', '${HOME}/', '~/*']) assert.equal(words.isRootOrHome(t, expand), true, t)
  for (const t of ['/tmp/x', '~/projects', 'node_modules']) assert.equal(words.isRootOrHome(t, expand), false, t)
  assert.equal(words.isRootOrHome('/home/u', expand, { cwd: '/', home: '/home/u' }), true)
})
