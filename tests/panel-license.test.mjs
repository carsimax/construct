import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// S10: every file with adapted claude-flightdeck code carries the full MIT notice in its header.
const dir = new URL('../plugins/construct/hooks/panel/', import.meta.url)

for (const file of ['draw.js', 'layout.js', 'state.js']) {
  test(`${file} carries the flightdeck copyright and the MIT permission notice in its header`, () => {
    const head = readFileSync(new URL(file, dir), 'utf8').slice(0, 2500)
    assert.match(head, /Copyright \(c\) 2026 Stephen Casella/)
    assert.match(head, /Permission is hereby granted/)
    assert.match(head, /THE SOFTWARE IS PROVIDED "AS IS"/)
  })
}

// Ported MIT code: each project has a LICENSE-<project> file with its copyright line and permission
// notice, and each ported file names that file.
const plugin = new URL('../plugins/construct/', import.meta.url)
const PORTS = [
  ['gentle-shell', 'Copyright \\(c\\) 2025 Mario Zechner', ['hooks/scripts/delegation-admission.mjs', 'hooks/scripts/delivery-signals.mjs']],
  ['gentle-agent-state', 'Copyright \\(c\\) 2026 Alan Buscaglia', ['hooks/panel/state.js']],
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
