// Test files are scanned only for added lines: their whole-file size never counts toward the
// scan byte budget, so a small edit to large test files keeps the tier it had without the scan.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyFiles, assessJson, makeRepo, reasonKeys } from './helpers.mjs'

const body = (bytes, tag) => `// ${tag}\n` + `export const x = ${JSON.stringify('y'.repeat(70))}\n`.repeat(Math.ceil(bytes / 80))

test('200 mid-sized test files with one edited line each stay medium', () => {
  const base = {}
  const change = {}
  for (let i = 0; i < 200; i++) {
    const path = `suite/f${i}.test.js`
    base[path] = body(23000, 'a')
    change[path] = body(23000, 'b')
  }
  const repo = makeRepo(base)
  applyFiles(repo, change)
  const { json } = assessJson(repo)
  assert.equal(json.risk, 'medium', JSON.stringify(json.reasons.slice(0, 2)))
  assert.ok(!reasonKeys(json.reasons).some((r) => r.startsWith('process_scan_limit')))
})

test('one 4.3 MB test file with one edited line stays medium', () => {
  const repo = makeRepo({ 'src/snap.test.js': body(4_300_000, 'a') })
  applyFiles(repo, { 'src/snap.test.js': body(4_300_000, 'b') })
  const { json } = assessJson(repo)
  assert.equal(json.risk, 'medium', JSON.stringify(json.reasons))
  assert.deepEqual(reasonKeys(json.reasons), ['executable_change:src/snap.test.js'])
})
