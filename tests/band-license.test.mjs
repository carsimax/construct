import { test } from 'node:test'
import assert from 'node:assert/strict'
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
