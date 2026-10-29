#!/usr/bin/env bash
# Outcome check: run from a fresh temp dir with the kept workspace path as $1.
# Copies the workspace here and runs hidden acceptance tests that exist only in this script.
set -euo pipefail
ws="$1"
tar -C "$ws" --exclude=.git -cf - . | tar -xf -
cat > outcome.hidden.test.js <<'JS'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { invoiceTotal } from './invoice.js'

test('tax is applied once', () => {
  assert.equal(invoiceTotal([{ price: 10, qty: 2 }], 0.1), 22)
})

test('cents are rounded, not truncated', () => {
  assert.equal(invoiceTotal([{ price: 19.99, qty: 1 }], 0), 19.99)
  assert.equal(invoiceTotal([{ price: 4.35, qty: 1 }]), 4.35)
})

test('both causes together', () => {
  assert.equal(invoiceTotal([{ price: 4.35, qty: 3 }], 0.2), 15.66)
  assert.equal(invoiceTotal([{ price: 19.99, qty: 1 }, { price: 10, qty: 1 }], 0.1), 32.99)
})
JS
node --test outcome.hidden.test.js
