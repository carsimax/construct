// Regression pins from the independent verification of T6: Go's
// strings.TrimSpace keeps U+FEFF and strips U+0085, while JavaScript's
// String.prototype.trim does the opposite. A BOM before a comment marker or a
// code fence must not hide the line from the scans.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { goTrimSpace } from '../../plugins/construct/lib/assess/text.mjs'
import { applyFiles, assessJson, makeRepo, reasonKeys } from './helpers.mjs'

const BOM = '﻿'

describe('goTrimSpace matches Go strings.TrimSpace', () => {
  test('keeps U+FEFF', () => {
    assert.equal(goTrimSpace(`  ${BOM}// x  `), `${BOM}// x`)
  })

  test('strips U+0085, U+00A0, ASCII whitespace, and Unicode space separators', () => {
    assert.equal(goTrimSpace('\u0085 \t\n\v\f\r  x　     '), 'x')
  })
})

describe('BOM-prefixed source lines are still scanned', () => {
  const cases = [
    ['BOM before a JS comment that names child_process', 'app/r.js', `${BOM}// uses child_process to spawn\nconst a = 1\n`, 'high', ['process_boundary:app/r.js']],
    ['BOM before a Python comment that names subprocess', 'app/r.py', `${BOM}# calls subprocess\nx = 1\n`, 'high', ['process_boundary:app/r.py']],
    ['BOM before a JS eval sink', 'app/r.js', `${BOM}// eval(x)\n`, 'high', ['dangerous_sink:app/r.js']],
  ]
  for (const [name, path, content, risk, reasons] of cases) {
    test(name, () => {
      const repo = makeRepo({ 'README.md': 'base\n' })
      applyFiles(repo, { [path]: content })
      const { json } = assessJson(repo)
      assert.equal(json.risk, risk, JSON.stringify(json.reasons))
      assert.deepEqual(reasonKeys(json.reasons), reasons)
      assert.equal(json.review_due, true)
    })
  }

  test('a NEL before a JS comment is still a comment, as in Go', () => {
    const repo = makeRepo({ 'README.md': 'base\n' })
    applyFiles(repo, { 'app/n.js': '\u0085// exec(x)\n' })
    assert.equal(assessJson(repo).json.risk, 'medium')
  })
})

describe('BOM inside MDX does not open a hidden code fence', () => {
  for (const [name, content] of [
    ['indented BOM before a fence', `  ${BOM}\`\`\`\n<script>alert(1)</script>\n`],
    ['double BOM before a fence', `${BOM}${BOM}\`\`\`\n<script>\n`],
  ]) {
    test(name, () => {
      const repo = makeRepo({ 'README.md': 'base\n' })
      applyFiles(repo, { 'guide.mdx': content })
      assert.equal(assessJson(repo).json.risk, 'medium')
    })
  }
})
