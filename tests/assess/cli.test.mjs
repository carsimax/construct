// CLI behavior: usage errors, escalation, candidate selection, fail-closed
// results, and the guarantee that the user's real index is never touched.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyFiles, assess, assessJson, commitAll, git, makeRepo, reasonKeys, sh, write } from './helpers.mjs'

const passiveRepo = () => {
  const repo = makeRepo()
  applyFiles(repo, { 'docs/guide.md': 'Guide\n' })
  return repo
}

describe('escalation', () => {
  test('a valid escalation raises passive to high and names the item', () => {
    const { status, json } = assessJson(passiveRepo(), ['--escalate-item', '2', '--escalate-reason', 'touches the login guard'])
    assert.equal(status, 0)
    assert.equal(json.risk, 'high')
    assert.deepEqual(reasonKeys(json.reasons), ['agent_escalation', 'non_executable_only'])
    assert.equal(json.reasons.at(-1).detail, 'item 2 (security): touches the login guard')
    assert.deepEqual([json.review_due, json.review_due_reason], [true, 'high_risk'])
    assert.equal(json.lenses.length, 4)
  })

  test('a valid escalation raises medium to high', () => {
    const repo = makeRepo()
    applyFiles(repo, { 'src/x.go': 'package x\n' })
    const { json } = assessJson(repo, ['--escalate-item', '6', '--escalate-reason', 'no test covers it'])
    assert.equal(json.risk, 'high')
    assert.equal(json.reasons.at(-1).detail, 'item 6 (no test would catch a regression): no test covers it')
  })

  test('an escalation never lowers a tier', () => {
    const repo = makeRepo()
    applyFiles(repo, { 'src/auth/x.go': 'package x\n' })
    const { json } = assessJson(repo, ['--escalate-item', '1', '--escalate-reason', 'data'])
    assert.equal(json.risk, 'high')
    assert.deepEqual(reasonKeys(json.reasons), ['agent_escalation', 'hot_path:src/auth/x.go'])
  })

  test('every item 1 to 6 is accepted with its name', () => {
    const names = ['data or irreversible effects', 'security', 'contracts others consume', 'concurrency', 'delivery or environment', 'no test would catch a regression']
    const repo = passiveRepo()
    names.forEach((name, index) => {
      const { json } = assessJson(repo, ['--escalate-item', String(index + 1), '--escalate-reason', 'why'])
      assert.equal(json.reasons.at(-1).detail, `item ${index + 1} (${name}): why`)
    })
  })

  const usageCases = [
    ['item 0', ['--escalate-item', '0', '--escalate-reason', 'x']],
    ['item 7', ['--escalate-item', '7', '--escalate-reason', 'x']],
    ['non-integer item', ['--escalate-item', 'abc', '--escalate-reason', 'x']],
    ['fractional item', ['--escalate-item', '2.5', '--escalate-reason', 'x']],
    ['blank reason', ['--escalate-item', '2', '--escalate-reason', '   ']],
    ['empty reason', ['--escalate-item', '2', '--escalate-reason', '']],
    ['reason over 500 bytes', ['--escalate-item', '2', '--escalate-reason', 'x'.repeat(501)]],
    ['reason over 500 bytes in multibyte text', ['--escalate-item', '2', '--escalate-reason', 'é'.repeat(251)]],
    ['item without reason', ['--escalate-item', '2']],
    ['reason without item', ['--escalate-reason', 'x']],
    ['unknown flag', ['--bogus']],
    ['positional argument', ['stray']],
    ['missing flag value', ['--base-ref']],
  ]
  for (const [name, args] of usageCases) {
    test(`usage error (exit 2, message on stderr): ${name}`, () => {
      const result = assess(passiveRepo(), [...args, '--json'])
      assert.equal(result.status, 2)
      assert.equal(result.stdout, '')
      assert.match(result.stderr, /^odd-assess: /)
    })
  }

  test('a reason of exactly 500 bytes is accepted', () => {
    const { status, json } = assessJson(passiveRepo(), ['--escalate-item', '3', '--escalate-reason', 'x'.repeat(500)])
    assert.equal(status, 0)
    assert.equal(json.risk, 'high')
  })
})

describe('candidate selection', () => {
  test('--base-ref assesses base to HEAD, committed only', () => {
    const repo = makeRepo()
    const base = git(repo, 'rev-parse', 'HEAD').trim()
    applyFiles(repo, { 'scripts/build.sh': 'echo hi\n', 'docs/a.md': 'a\n' })
    commitAll(repo, 'change')
    const { status, json } = assessJson(repo, ['--base-ref', base])
    assert.equal(status, 0)
    assert.equal(json.risk, 'high')
    assert.deepEqual(reasonKeys(json.reasons), ['shell_source:scripts/build.sh'])
    assert.equal(json.changed_paths, 2)
    assert.equal(json.changed_lines, 2)
    assert.deepEqual(json.candidate, { kind: 'base-diff', base_ref: base, consumed: false })
  })

  test('--base-ref ignores working-tree edits when --committed-only is given', () => {
    const repo = makeRepo()
    const base = git(repo, 'rev-parse', 'HEAD').trim()
    applyFiles(repo, { 'docs/a.md': 'a\n' })
    commitAll(repo, 'doc')
    write(repo, 'docs/a.md', 'dirty tracked edit\n')
    write(repo, 'src/auth/new.go', 'untracked\n')
    const { json } = assessJson(repo, ['--base-ref', base, '--committed-only'])
    assert.equal(json.risk, 'passive')
    assert.equal(json.changed_paths, 1)
  })

  test('--base-ref with dirty tracked files and no --committed-only fails closed', () => {
    const repo = makeRepo({ 'docs/a.md': 'a\n' })
    const base = git(repo, 'rev-parse', 'HEAD').trim()
    write(repo, 'docs/a.md', 'dirty\n')
    const { status, json } = assessJson(repo, ['--base-ref', base])
    assert.equal(status, 0)
    assert.equal(json.risk, 'high')
    assert.deepEqual(reasonKeys(json.reasons), ['unassessable'])
    assert.match(json.reasons[0].detail, /committed-only/)
  })

  test('the working-tree candidate includes untracked files but not ignored ones', () => {
    const repo = makeRepo({ '.gitignore': 'ignored/\n' })
    applyFiles(repo, { 'src/auth/new.go': 'package a\n', 'ignored/secret.go': 'package s\n', 'docs/a.md': 'a\n' })
    const { json } = assessJson(repo)
    assert.equal(json.changed_paths, 2)
    assert.deepEqual(reasonKeys(json.reasons), ['hot_path:src/auth/new.go'])
  })

  test('the working-tree candidate sees deletions of tracked files', () => {
    const repo = makeRepo({ 'docs/a.md': 'a\nb\n' })
    applyFiles(repo, { 'docs/a.md': null })
    const { json } = assessJson(repo)
    assert.equal(json.changed_lines, 2)
    assert.equal(json.risk, 'passive')
  })

  test('a repository with no commits uses the empty tree as base', () => {
    const repo = mkdtempSync(join(tmpdir(), 'odd-assess-unborn-'))
    git(repo, 'init', '-q', '-b', 'main')
    write(repo, 'docs/a.md', 'a\n')
    const { status, json } = assessJson(repo)
    assert.equal(status, 0)
    assert.equal(json.risk, 'passive')
    assert.equal(json.changed_lines, 1)
  })

  test('a linked worktree is assessed like any repository', () => {
    const repo = makeRepo()
    const linked = join(mkdtempSync(join(tmpdir(), 'odd-assess-wt-')), 'wt')
    git(repo, 'worktree', 'add', '-q', '-b', 'side', linked)
    write(linked, 'src/auth/x.go', 'package x\n')
    const { json } = assessJson(linked)
    assert.equal(json.risk, 'high')
    assert.deepEqual(reasonKeys(json.reasons), ['hot_path:src/auth/x.go'])
  })

  test('a repository with a .gitattributes binary rule is still diffed by content', () => {
    const repo = makeRepo({ '.gitattributes': '*.go -diff\n' })
    applyFiles(repo, { 'src/x.go': 'package x\nvar a = 1\n' })
    const { json } = assessJson(repo)
    assert.equal(json.changed_lines, 2)
  })
})

describe('fail closed', () => {
  test('a missing base ref reports unassessable with exit 0', () => {
    const { status, json } = assessJson(makeRepo(), ['--base-ref', 'no-such-ref', '--committed-only'])
    assert.equal(status, 0)
    assert.equal(json.risk, 'high')
    assert.equal(json.reasons.length, 1)
    assert.equal(json.reasons[0].code, 'unassessable')
    assert.ok(json.reasons[0].detail.length > 0)
    assert.deepEqual([json.review_due, json.review_due_reason], [true, 'high_risk'])
    assert.deepEqual([json.changed_paths, json.changed_lines], [0, 0])
    assert.deepEqual(json.candidate, { kind: 'base-diff', base_ref: 'no-such-ref', consumed: false })
  })

  test('a range or option-shaped base ref is rejected, not passed to git', () => {
    for (const args of [['--base-ref', 'a..b'], ['--base-ref=--output=x']]) {
      const { json } = assessJson(makeRepo(), [...args, '--committed-only'])
      assert.equal(json.risk, 'high')
      assert.equal(json.reasons[0].code, 'unassessable')
    }
  })

  test('a directory that is not a repository fails closed', () => {
    const { status, json } = assessJson(mkdtempSync(join(tmpdir(), 'odd-assess-none-')))
    assert.equal(status, 0)
    assert.equal(json.risk, 'high')
    assert.equal(json.reasons[0].code, 'unassessable')
    assert.deepEqual(json.candidate, { kind: 'current-changes', consumed: false })
  })

  test('a clean working tree has no pending changes and fails closed', () => {
    const { json } = assessJson(makeRepo())
    assert.equal(json.risk, 'high')
    assert.match(json.reasons[0].detail, /no pending changes/)
  })

  test('fail closed also applies without --json', () => {
    const result = assess(makeRepo(), ['--base-ref', 'no-such-ref', '--committed-only'])
    assert.equal(result.status, 0)
    assert.match(result.stdout, /^Risk: high/)
    assert.match(result.stdout, /unassessable/)
  })
})

describe('output', () => {
  test('the human summary lists tier, size, review state, and reasons', () => {
    const repo = makeRepo()
    applyFiles(repo, { 'scripts/build.sh': 'echo hi\n' })
    const { status, stdout } = assess(repo)
    assert.equal(status, 0)
    assert.match(stdout, /^Risk: high\nCandidate: current-changes\nChanged paths: 1\nChanged lines: 1\nreview due: yes \(high_risk\)\n/)
    assert.match(stdout, /  - shell_source \(scripts\/build\.sh\): signal: shell_process/)
  })

  test('--json omits next_transition and the original schema name', () => {
    const { json } = assessJson(passiveRepo())
    assert.equal(json.next_transition, undefined)
    assert.deepEqual(Object.keys(json), ['schema', 'risk', 'reasons', 'changed_paths', 'changed_lines', 'candidate', 'review_due', 'review_due_reason', 'lenses'])
  })

  test('--help prints usage and exits 0', () => {
    const result = assess(makeRepo(), ['--help'])
    assert.equal(result.status, 0)
    assert.match(result.stdout, /^Usage: odd-assess/)
  })
})

describe('the real index is never touched', () => {
  test('staged, unstaged, and untracked state is identical after the working-tree assessment', () => {
    const repo = makeRepo({ 'docs/a.md': 'a\n' })
    write(repo, 'staged.txt', 'staged\n')
    git(repo, 'add', 'staged.txt')
    write(repo, 'docs/a.md', 'unstaged edit\n')
    write(repo, 'src/auth/untracked.go', 'package a\n')
    const snapshot = () => ({
      cached: git(repo, 'diff', '--cached'),
      worktree: git(repo, 'diff'),
      status: git(repo, 'status', '--porcelain=v1', '--untracked-files=all'),
      index: readFileSync(join(repo, '.git', 'index')).toString('hex'),
    })
    const before = snapshot()
    const { json } = assessJson(repo)
    assert.equal(json.risk, 'high')
    assert.deepEqual(snapshot(), before)
    assert.equal(sh(repo, 'git', ['ls-files', '--stage']).stdout.includes('untracked.go'), false)
  })
})
