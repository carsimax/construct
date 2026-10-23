#!/usr/bin/env bash
set -euo pipefail
git init -q
cat > math.js <<'JS'
export function add(a, b) {
  return a + b
}
JS
cat > math.test.js <<'JS'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { add } from './math.js'

test('add sums two numbers', () => {
  assert.equal(add(2, 3), 5)
})
JS
printf '{ "type": "module", "scripts": { "test": "node --test" } }\n' > package.json
printf 'script-shell=/bin/sh\n' > .npmrc
git add -A
git -c user.email=eval@example.com -c user.name=eval commit -qm "chore: initial math module"
