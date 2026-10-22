#!/usr/bin/env bash
set -euo pipefail
printf '{ "type": "module", "scripts": { "test": "node --test" } }\n' > package.json
printf 'script-shell=/bin/sh\n' > .npmrc
cat > money.js <<'JS'
// Rounds an amount of money to whole cents.
export function roundCents(amount) {
  return Math.round(amount * 100) / 100
}
JS
cat > money.test.js <<'JS'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { roundCents } from './money.js'

test('roundCents rounds to two decimals', () => {
  assert.equal(roundCents(1.234), 1.23)
  assert.equal(roundCents(1.236), 1.24)
  assert.equal(roundCents(1.005), 1)
})
JS
