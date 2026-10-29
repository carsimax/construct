#!/usr/bin/env bash
set -euo pipefail
git init -q
printf '{ "type": "module", "scripts": { "test": "node --test" } }\n' > package.json
printf 'script-shell=/bin/sh\n' > .npmrc
cat > money.js <<'JS'
// Money helpers: amounts are handled as integer cents.
export function toCents(amount) {
  return Math.floor(amount * 100)
}

export function fromCents(cents) {
  return cents / 100
}
JS
cat > invoice.js <<'JS'
import { toCents, fromCents } from './money.js'

// A line's total in cents, tax included.
export function lineTotal(item, rate) {
  const net = toCents(item.price) * item.qty
  return net + Math.round(net * rate)
}

export function invoiceTotal(items, rate = 0) {
  const sum = items.reduce((s, item) => s + lineTotal(item, rate), 0)
  return fromCents(sum + Math.round(sum * rate))
}
JS
cat > invoice.test.js <<'JS'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { invoiceTotal } from './invoice.js'

test('a taxed invoice totals net plus tax once', () => {
  assert.equal(invoiceTotal([{ price: 10, qty: 1 }], 0.1), 11)
})
JS
git add -A
git -c user.email=eval@example.com -c user.name=eval commit -qm "chore: initial files"
