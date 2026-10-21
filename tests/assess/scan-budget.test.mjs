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

// Key-only paths (non-code text) are read for the PEM header alone: they never add a scan-limit reason.
const noScanLimit = (json) => assert.ok(!reasonKeys(json.reasons).some((r) => r.startsWith('process_scan_limit')), JSON.stringify(json.reasons))
const PEM_HEADER = '-----BEGIN RSA PRIVATE KEY-----\n'

for (const [name, path, bytes] of [['csv', 'data/big.csv', 11_000_000], ['md', 'notes/big.md', 10_800_000]]) {
  test(`one ${bytes} byte ${name} file stays medium`, () => {
    const repo = makeRepo({ 'src/a.js': 'export const a = 1\n' })
    applyFiles(repo, { 'src/a.js': 'export const a = 2\n', [path]: 'row,1\n'.repeat(Math.ceil(bytes / 6)) })
    const { json } = assessJson(repo)
    assert.equal(json.risk, 'medium', JSON.stringify(json.reasons))
    noScanLimit(json)
  })
}

test('40 markdown notes totalling 9.7 MB stay medium', () => {
  const files = { 'src/a.js': 'export const a = 2\n' }
  for (let i = 0; i < 40; i++) files[`notes/n${i}.md`] = 'line\n'.repeat(48_500)
  const repo = makeRepo({ 'src/a.js': 'export const a = 1\n' })
  applyFiles(repo, files)
  const { json } = assessJson(repo)
  assert.equal(json.risk, 'medium', JSON.stringify(json.reasons))
  noScanLimit(json)
})

test('a markdown path containing " b/" stays passive', () => {
  const repo = makeRepo({ 'README.txt': 'x\n' })
  applyFiles(repo, { 'notes/plan b/x.md': 'hello\n' })
  const { json } = assessJson(repo)
  assert.equal(json.risk, 'passive', JSON.stringify(json.reasons))
})

test('a code path containing " b/" is not a scan limit', () => {
  const repo = makeRepo({ 'README.txt': 'x\n' })
  applyFiles(repo, { 'src/plan b/x.js': 'export const x = 1\n' })
  noScanLimit(assessJson(repo).json)
})

for (const path of ['notes/keys.md', 'site/page.html']) {
  test(`a PEM header in ${path} stays high next to a large note`, () => {
    const repo = makeRepo({ 'README.txt': 'x\n' })
    applyFiles(repo, { [path]: PEM_HEADER, 'data/big.csv': 'row,1\n'.repeat(1_900_000) })
    const { json } = assessJson(repo)
    assert.equal(json.risk, 'high')
    assert.deepEqual(reasonKeys(json.reasons), [`private_key_content:${path}`])
  })
}
