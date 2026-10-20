// One CLI-level case per classifier rule, positive and negative (table in
// fixtures.mjs). Each case builds a throwaway repository (an unchanged base
// commit plus `base` files), applies `change` to the working tree, and asserts
// tier, reasons, changed lines, and review_due through the real odd-assess binary.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { CASES, DUE } from './fixtures.mjs'
import { applyFiles, assessJson, makeRepo, reasonKeys } from './helpers.mjs'

describe('classifier rules through the CLI', () => {
  for (const [name, base, change, [risk, reasons, lines]] of CASES) {
    test(name, () => {
      const repo = makeRepo(base)
      applyFiles(repo, change)
      const { status, json, stderr } = assessJson(repo)
      assert.equal(status, 0, stderr)
      assert.equal(json.schema, 'odd-skills.review-assessment/v1')
      assert.equal(json.risk, risk, JSON.stringify(json.reasons))
      assert.deepEqual(reasonKeys(json.reasons), [...reasons].sort())
      assert.equal(json.changed_lines, lines)
      assert.equal(json.changed_paths, Object.keys(change).length)
      assert.deepEqual([json.review_due, json.review_due_reason], DUE[risk])
      assert.deepEqual(json.candidate, { kind: 'current-changes', consumed: false })
    })
  }

  test('reason details are formatted like the original', () => {
    const repo = makeRepo({ 'tools/run.txt': 'text\n' })
    applyFiles(repo, { 'tools/run.txt': { content: 'text\n', executable: true }, 'scripts/build.sh': 'echo hi\n' })
    const { json } = assessJson(repo)
    const byCode = Object.fromEntries(json.reasons.map((r) => [r.code, r]))
    assert.equal(byCode.executable_mode.detail, 'signal: permissions; mode 100644 -> 100755')
    assert.equal(byCode.shell_source.detail, 'signal: shell_process')
  })

  test('only one reason is kept per code and signal', () => {
    const repo = makeRepo()
    applyFiles(repo, { 'src/auth/a.go': 'package a\n', 'src/auth/b.go': 'package b\n' })
    const { json } = assessJson(repo)
    assert.deepEqual(reasonKeys(json.reasons), ['hot_path:src/auth/a.go'])
  })

  test('a byte budget overrun fails closed into process_scan_limit', () => {
    const repo = makeRepo()
    applyFiles(repo, { 'tools/big.py': `${'x = "padding padding padding padding padding padding"\n'.repeat(180000)}` })
    const { json } = assessJson(repo)
    assert.equal(json.risk, 'high')
    assert.deepEqual(reasonKeys(json.reasons), ['process_scan_limit:tools/big.py'])
    assert.equal(json.reasons[0].detail, 'signal: shell_process')
  })

  test('lenses: none for passive and medium, four for high', () => {
    const passive = assessJson(applyAndReturn({ 'docs/a.md': 'a\n' })).json
    const medium = assessJson(applyAndReturn({ 'src/x.go': 'package x\n' })).json
    const high = assessJson(applyAndReturn({ 'src/auth/x.go': 'package x\n' })).json
    assert.deepEqual(passive.lenses, [])
    assert.deepEqual(medium.lenses, [])
    assert.deepEqual(high.lenses, ['review-risk', 'review-resilience', 'review-readability', 'review-reliability'])
  })
})

function applyAndReturn(change) {
  const repo = makeRepo()
  applyFiles(repo, change)
  return repo
}
