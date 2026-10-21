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
