// S1, S2: the git pre-push hook (pre-push.mjs) and its installer (bin/construct-gate), driven by real
// `git push` runs against a local bare remote.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyFiles, commitAll, git, makeRepo, scratchDir, sh } from '../helpers/repo.mjs'
import { subjectHash, writeVerdict } from '../../plugins/construct/hooks/scripts/review-store.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const GATE = join(PLUGIN, 'bin/construct-gate')

const TABLE = (risk) => `# Feature\n\n## Tasks\n\n| ID | Specs | Task | Route | Risk | Status | Commit |\n|---|---|---|---|---|---|---|\n| T1 | S1 | work | worker | ${risk} | done | \`abc\` |\n\n## Log\n\n- 1 | none | x\n`

// A repository on branch feat (one unit over main) with a bare origin that already has main.
function setup(risk = '2', { fetch = true, docs = true } = {}) {
  const repo = makeRepo({ 'src/app.js': 'export const a = 1\n' })
  const bare = join(scratchDir('pre-push-remote-'), 'origin.git')
  git(repo, 'clone', '-q', '--bare', repo, bare)
  git(repo, 'remote', 'add', 'origin', bare)
  if (fetch) {
    git(repo, 'fetch', '-q', 'origin')
    git(repo, 'remote', 'set-head', 'origin', 'main')
  }
  git(repo, 'checkout', '-q', '-b', 'feat')
  applyFiles(repo, { ...(docs && { 'odd/tasks/f.md': TABLE(risk) }), 'src/app.js': 'export const a = 2\n' })
  commitAll(repo, 'unit')
  return { repo, bare }
}

const configDir = () => scratchDir('pre-push-config-')
const run = (cwd, command, args, config) => sh(cwd, command, args, { allowFailure: true, env: { ...process.env, CLAUDE_CONFIG_DIR: config } })
const gate = (repo, config, arg) => run(repo, 'node', [GATE, arg], config)
const push = (repo, config, ...args) => run(repo, 'git', ['push', ...args], config)
const remoteRefs = (bare) => git(bare, 'for-each-ref', '--format=%(refname) %(objectname)')

const subjectOf = (repo) => subjectHash(git(repo, 'rev-parse', 'main^{tree}').trim(), git(repo, 'rev-parse', 'HEAD^{tree}').trim())
const approve = (repo, lens) => writeVerdict(repo, { lens, subject_hash: subjectOf(repo), approved: true, at: Date.now(), result: {} })

// installed: a setup with the hook installed (its recorded path is this checkout's pre-push.mjs).
function installed(risk, options) {
  const s = setup(risk, options)
  s.config = configDir()
  const r = gate(s.repo, s.config, 'install')
  assert.equal(r.status, 0, r.stderr)
  return s
}

describe('pre-push hook judges a real git push', () => {
  test('a Risk 2 branch with no verdict is rejected and the remote is unchanged', () => {
    const { repo, bare, config } = installed('2')
    const before = remoteRefs(bare)
    const r = push(repo, config, 'origin', 'feat')
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /review-risk/)
    assert.match(r.stderr, /Review subject: /)
    assert.equal(remoteRefs(bare), before)
  })

  test('the same push succeeds once review-risk approved the subject', () => {
    const { repo, bare, config } = installed('2')
    approve(repo, 'review-risk')
    const r = push(repo, config, 'origin', 'feat')
    assert.equal(r.status, 0, r.stderr)
    assert.match(remoteRefs(bare), /refs\/heads\/feat /)
  })

  test('a Risk none branch pushes', () => {
    const { repo, bare, config } = installed('none')
    const r = push(repo, config, 'origin', 'feat')
    assert.equal(r.status, 0, r.stderr)
    assert.match(remoteRefs(bare), /refs\/heads\/feat /)
  })

  test('a branch delete pushes', () => {
    const { repo, bare, config } = installed('none')
    assert.equal(push(repo, config, 'origin', 'feat').status, 0)
    const r = push(repo, config, 'origin', '--delete', 'feat')
    assert.equal(r.status, 0, r.stderr)
    assert.ok(!remoteRefs(bare).includes('refs/heads/feat'))
  })

  test('an error while judging denies (no default branch resolves)', () => {
    const { repo, bare, config } = installed('none', { fetch: false })
    git(repo, 'branch', '-m', 'main', 'trunk')
    const r = push(repo, config, 'origin', 'feat')
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /default branch cannot be resolved/)
    assert.match(r.stderr, /git remote set-head origin --auto/)
    assert.match(r.stderr, /construct-gate uninstall/)
    assert.match(r.stderr, /--no-verify/)
    assert.ok(!remoteRefs(bare).includes('refs/heads/feat'))
  })
})

describe('construct-gate installer', () => {
  test("install writes an executable hook marked as Construct's; status reports it", () => {
    const { repo } = setup()
    const config = configDir()
    const r = gate(repo, config, 'install')
    assert.equal(r.status, 0, r.stderr)
    const hook = join(repo, '.git/hooks/pre-push')
    assert.ok(statSync(hook).mode & 0o100)
    assert.match(readFileSync(hook, 'utf8'), /construct-gate: Construct pre-push hook/)
    const s = gate(repo, config, 'status')
    assert.equal(s.status, 0)
    assert.match(s.stdout, /installed: .*pre-push/)
    assert.ok(s.stdout.includes(join(PLUGIN, 'hooks/scripts/pre-push.mjs')))
  })

  test('status says not installed before install', () => {
    const { repo } = setup()
    assert.match(gate(repo, configDir(), 'status').stdout, /not installed/)
  })

  test('install honors core.hooksPath', () => {
    const { repo } = setup()
    const dir = scratchDir('pre-push-hooks-')
    git(repo, 'config', 'core.hooksPath', dir)
    const r = gate(repo, configDir(), 'install')
    assert.equal(r.status, 0, r.stderr)
    assert.ok(existsSync(join(dir, 'pre-push')))
    assert.ok(!existsSync(join(repo, '.git/hooks/pre-push')))
  })

  test('install and uninstall refuse a foreign hook and leave it byte-identical', () => {
    const { repo } = setup()
    const hook = join(repo, '.git/hooks/pre-push')
    const foreign = '#!/bin/sh\necho mine\n'
    mkdirSync(join(repo, '.git/hooks'), { recursive: true })
    writeFileSync(hook, foreign, { mode: 0o755 })
    for (const command of ['install', 'uninstall']) {
      const r = gate(repo, configDir(), command)
      assert.notEqual(r.status, 0)
      assert.ok(r.stderr.includes(hook), r.stderr)
      assert.equal(readFileSync(hook, 'utf8'), foreign)
    }
  })

  test("uninstall removes Construct's hook", () => {
    const { repo } = setup()
    const config = configDir()
    gate(repo, config, 'install')
    const r = gate(repo, config, 'uninstall')
    assert.equal(r.status, 0, r.stderr)
    assert.ok(!existsSync(join(repo, '.git/hooks/pre-push')))
    assert.match(gate(repo, config, 'status').stdout, /not installed/)
  })

  test('the hook prefers the newest plugin version in the cache over the recorded path', () => {
    const { repo, bare } = setup('2')
    const config = configDir()
    gate(repo, config, 'install')
    // 10.0.0 allows, 2.0.0 denies: only a numeric sort picks the allowing one, and the recorded script would deny too.
    for (const v of ['2.0.0', '10.0.0']) {
      const dir = join(config, 'plugins/cache/construct/construct', v, 'hooks/scripts')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'pre-push.mjs'), v === '10.0.0' ? '' : 'process.exitCode = 1\n')
    }
    const r = push(repo, config, 'origin', 'feat')
    assert.equal(r.status, 0, r.stderr)
    assert.match(remoteRefs(bare), /refs\/heads\/feat /)
  })

  test('with no plugin found the hook warns and allows the push', () => {
    const { repo, bare } = setup('2')
    const config = configDir()
    gate(repo, config, 'install')
    const hook = join(repo, '.git/hooks/pre-push')
    writeFileSync(hook, readFileSync(hook, 'utf8').replace(/^recorded='.*'$/m, "recorded='/nonexistent/pre-push.mjs'"))
    const r = push(repo, config, 'origin', 'feat')
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stderr, /plugin was not found/)
    assert.match(remoteRefs(bare), /refs\/heads\/feat /)
  })
})

const HOOK_MARKER = '# construct-gate: Construct pre-push hook'
const ZERO = '0'.repeat(40)
const PRE_PUSH = join(PLUGIN, 'hooks/scripts/pre-push.mjs')

describe('review findings fixed in T3', () => {
  test('B-001: without node on PATH the hook denies and names the ways out', () => {
    const { repo, config } = installed('none')
    const bin = scratchDir('pre-push-bin-')
    for (const tool of ['sh', 'ls', 'sort']) symlinkSync(sh(repo, 'sh', ['-c', `command -v ${tool}`]).stdout.trim(), join(bin, tool))
    const r = sh(repo, '/bin/sh', [join(repo, '.git/hooks/pre-push')], { allowFailure: true, env: { PATH: bin, CLAUDE_CONFIG_DIR: config }, input: '' })
    assert.equal(r.status, 1)
    assert.match(r.stderr, /needs node on PATH/)
    assert.match(r.stderr, /construct-gate uninstall/)
    assert.match(r.stderr, /git push --no-verify/)
  })

  test('B-002: a pushed commit with no feature documents is allowed although no default branch resolves', () => {
    const { repo, bare, config } = installed('none', { fetch: false, docs: false })
    git(repo, 'branch', '-m', 'main', 'trunk')
    const r = push(repo, config, 'origin', 'feat')
    assert.equal(r.status, 0, r.stderr)
    assert.match(remoteRefs(bare), /refs\/heads\/feat /)
  })

  test('B-005: a ref sharing no history with the default branch is denied with an actionable message', () => {
    const { repo, bare, config } = installed('none')
    git(repo, 'checkout', '-q', '--orphan', 'other')
    applyFiles(repo, { 'odd/tasks/g.md': TABLE('none') })
    commitAll(repo, 'orphan')
    const r = push(repo, config, 'origin', 'other')
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /shares no history/)
    assert.match(r.stderr, /construct-gate uninstall/)
    assert.match(r.stderr, /--no-verify/)
    assert.doesNotMatch(r.stderr, /merge-base/)
    assert.ok(!remoteRefs(bare).includes('refs/heads/other'))
  })

  test('A-001: a foreign hook with the marker on another line is refused and untouched', () => {
    const { repo } = setup()
    const hook = join(repo, '.git/hooks/pre-push')
    const foreign = `#!/bin/sh\necho mine\n${HOOK_MARKER}\n`
    writeFileSync(hook, foreign, { mode: 0o755 })
    for (const command of ['install', 'uninstall']) {
      const r = gate(repo, configDir(), command)
      assert.notEqual(r.status, 0)
      assert.equal(readFileSync(hook, 'utf8'), foreign)
    }
  })

  test('B-003: install replaces the hook by rename and leaves no temporary file', () => {
    const { repo } = setup()
    const config = configDir()
    const hook = join(repo, '.git/hooks/pre-push')
    gate(repo, config, 'install')
    const before = statSync(hook).ino
    assert.equal(gate(repo, config, 'install').status, 0)
    assert.notEqual(statSync(hook).ino, before)
    assert.deepEqual(readdirSync(join(repo, '.git/hooks')).filter((f) => f.includes('pre-push') && !f.endsWith('.sample')), ['pre-push'])
  })

  test('A-003: a symlink at the hook path is refused like a foreign hook, dangling or not', () => {
    const { repo } = setup()
    const hook = join(repo, '.git/hooks/pre-push')
    const target = join(scratchDir('pre-push-link-'), 'target')
    for (const exists of [false, true]) {
      if (exists) writeFileSync(target, `#!/bin/sh\n${HOOK_MARKER}\n`)
      symlinkSync(target, hook)
      for (const command of ['install', 'uninstall']) {
        const r = gate(repo, configDir(), command)
        assert.notEqual(r.status, 0)
        assert.ok(lstatSync(hook).isSymbolicLink())
      }
      rmSync(hook)
    }
  })

  test('B-004 / A-005: install warns when the hooks dir is in the working tree or outside the git dir, not otherwise', () => {
    const inTree = setup().repo
    git(inTree, 'config', 'core.hooksPath', '.husky')
    const a = gate(inTree, configDir(), 'install')
    assert.equal(a.status, 0, a.stderr)
    assert.match(a.stderr, /can be committed/)
    const outside = setup().repo
    git(outside, 'config', 'core.hooksPath', scratchDir('pre-push-shared-'))
    const b = gate(outside, configDir(), 'install')
    assert.equal(b.status, 0, b.stderr)
    assert.match(b.stderr, /applies to every repository using it/)
    const plain = gate(setup().repo, configDir(), 'install')
    assert.equal(plain.stderr, '')
  })

  test('A-002: a malformed stdin line denies', () => {
    const { repo } = setup('none')
    const sha = git(repo, 'rev-parse', 'HEAD').trim()
    for (const input of ['garbage\n', `refs/heads/feat zzzz refs/heads/feat ${ZERO}\n`, `refs/heads/feat ${sha} refs/heads/feat\n`]) {
      const r = sh(repo, 'node', [PRE_PUSH, 'origin', 'url'], { allowFailure: true, input })
      assert.equal(r.status, 1, input)
      assert.match(r.stderr, /malformed/)
    }
  })

  test('B-007: status reports the script the hook would run (sh ls | sort -V order)', () => {
    const { repo } = setup()
    const config = configDir()
    gate(repo, config, 'install')
    const root = join(config, 'plugins/cache/construct/construct')
    for (const v of ['1.0.0', '1.0.0~rc1']) {
      mkdirSync(join(root, v, 'hooks/scripts'), { recursive: true })
      writeFileSync(join(root, v, 'hooks/scripts/pre-push.mjs'), '')
    }
    const newest = sh(repo, 'sh', ['-c', `ls "${root}" | sort -V | tail -n 1`]).stdout.trim()
    assert.ok(gate(repo, config, 'status').stdout.includes(`script: ${join(root, newest, 'hooks/scripts/pre-push.mjs')}`))
  })
})

describe('round-2 review findings', () => {
  test('N-1: a branch whose name contains merge-base keeps the real denial reason', () => {
    const { repo, bare, config } = installed('2')
    git(repo, 'branch', '-m', 'feat', 'fix-merge-base')
    const r = push(repo, config, 'origin', 'fix-merge-base')
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /review-risk/)
    assert.doesNotMatch(r.stderr, /shares no history/)
    assert.ok(!remoteRefs(bare).includes('refs/heads/fix-merge-base'))
  })

  test('N-2: with the plugin gone and no node on PATH the hook still warns and allows', () => {
    const { repo, config } = installed('2')
    const hook = join(repo, '.git/hooks/pre-push')
    writeFileSync(hook, readFileSync(hook, 'utf8').replace(/^recorded='.*'$/m, "recorded='/nonexistent/pre-push.mjs'"))
    const bin = scratchDir('pre-push-bin-')
    for (const tool of ['sh', 'ls', 'sort']) symlinkSync(sh(repo, 'sh', ['-c', `command -v ${tool}`]).stdout.trim(), join(bin, tool))
    const r = sh(repo, '/bin/sh', [hook], { allowFailure: true, env: { PATH: bin, CLAUDE_CONFIG_DIR: config }, input: '' })
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stderr, /plugin was not found/)
  })
})

describe('round-2 judge A findings', () => {
  for (const [name, to] of [['moved out of odd/tasks/', 'docs/f.md'], ['archived under odd/tasks/', 'odd/tasks/archive/f.md']]) {
    test(`N1: a Risk 2 document ${name} after the merge-base is still judged`, () => {
      const { repo, bare } = setup('2')
      git(repo, 'checkout', '-q', 'main')
      applyFiles(repo, { 'odd/tasks/f.md': TABLE('2') })
      commitAll(repo, 'track')
      git(repo, 'push', '-q', 'origin', 'main')
      git(repo, 'fetch', '-q', 'origin')
      git(repo, 'checkout', '-q', '-b', 'moved')
      mkdirSync(join(repo, to, '..'), { recursive: true })
      git(repo, 'mv', 'odd/tasks/f.md', to)
      applyFiles(repo, { 'src/app.js': 'export const a = 3\n' })
      commitAll(repo, 'move')
      const config = configDir()
      assert.equal(gate(repo, config, 'install').status, 0)
      const r = push(repo, config, 'origin', 'moved')
      assert.notEqual(r.status, 0, r.stderr)
      assert.match(r.stderr, /review-risk/)
      assert.ok(!remoteRefs(bare).includes('refs/heads/moved'))
    })
  }

  test('N3: the set-head advice names the remote being pushed to', () => {
    const { repo, config } = installed('2', { fetch: false })
    git(repo, 'branch', '-m', 'main', 'trunk')
    git(repo, 'remote', 'rename', 'origin', 'upstream')
    const r = push(repo, config, 'upstream', 'feat')
    assert.notEqual(r.status, 0)
    assert.match(r.stderr, /git remote set-head upstream --auto/)
  })
})
