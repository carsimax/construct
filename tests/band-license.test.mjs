import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

// Ported MIT code: each project has a LICENSE-<project> file with its copyright line and permission
// notice, and each ported file names that file.
const plugin = new URL('../plugins/construct/', import.meta.url)
const PORTS = [
  ['gentle-shell', 'Copyright \\(c\\) 2025 Mario Zechner', ['hooks/scripts/delegation-admission.mjs', 'hooks/scripts/delivery-signals.mjs']],
]

for (const [project, copyright, files] of PORTS) {
  test(`LICENSE-${project} holds its copyright line and the permission notice`, () => {
    const text = readFileSync(new URL(`LICENSE-${project}`, plugin), 'utf8')
    assert.match(text, new RegExp(copyright))
    assert.match(text, /Permission is hereby granted/)
    assert.match(text, /THE SOFTWARE IS PROVIDED "AS IS"/)
  })
  for (const file of files) {
    test(`${file} names LICENSE-${project}`, () => {
      const text = readFileSync(new URL(file, plugin), 'utf8')
      assert.match(text, new RegExp(`adapted from ${project} \\(https://github.com/Gentleman-Programming/${project}\\), MIT, ${copyright}, see LICENSE-${project}`))
    })
  }
}

// The band files are Construct's own code: no MIT header, no adaptation line.
for (const file of ['layout.js', 'state.js']) {
  test(`${file} carries no adapted-code header`, () => {
    const text = readFileSync(new URL(`hooks/band/${file}`, plugin), 'utf8')
    assert.doesNotMatch(text, /Permission is hereby granted/)
    assert.doesNotMatch(text, /adapted from/i)
  })
}

// Vendored code: mvdan-sh (BSD-3-Clause) is copied unmodified, so its hash is pinned to the npm
// package's index.js, its license sits beside the plugin's own, and NOTICE and its user name it.
test('LICENSE-mvdan-sh holds its copyright line and the BSD-3-Clause terms', () => {
  const text = readFileSync(new URL('LICENSE-mvdan-sh', plugin), 'utf8')
  assert.match(text, /Copyright \(c\) 2016, Daniel Mart/)
  assert.match(text, /Redistribution and use in source and binary forms/)
  assert.match(text, /Redistributions of source code must retain the above copyright/)
  assert.match(text, /Neither the name of the copyright holder/)
  assert.match(text, /THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS/)
})

test('hooks/vendor/mvdan-sh.cjs is the unmodified mvdan-sh 0.10.1 build', () => {
  const sha = createHash('sha256').update(readFileSync(new URL('hooks/vendor/mvdan-sh.cjs', plugin))).digest('hex')
  assert.equal(sha, '2b613c6ddf9ff8ba530e3d2e30a1c34a7b146abafa8408e18a9b8cdd771d0f2c')
})

test('shell-words.mjs and NOTICE name mvdan-sh and its license', () => {
  assert.match(readFileSync(new URL('hooks/scripts/shell-words.mjs', plugin), 'utf8'), /mvdan-sh 0\.10\.1 .*BSD-3-Clause.*see LICENSE-mvdan-sh/s)
  const notice = readFileSync(new URL('NOTICE', plugin), 'utf8')
  assert.match(notice, /mvdan-sh/)
  assert.match(notice, /hooks\/vendor\/mvdan-sh\.cjs/)
  assert.match(notice, /LICENSE-mvdan-sh/)
})
