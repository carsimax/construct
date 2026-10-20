#!/usr/bin/env bash
set -euo pipefail
git init -q
cat > last.js <<'JS'
export function lastItem(items) {
  return items[items.length]
}
JS
cat > last.test.js <<'JS'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lastItem } from './last.js'

test('lastItem returns the final element', () => {
  assert.equal(lastItem([1, 2, 3]), 3)
})
JS
printf '{ "type": "module", "scripts": { "test": "node --test" } }\n' > package.json
git add -A
git -c user.email=eval@example.com -c user.name=eval commit -qm "chore: initial last module"
