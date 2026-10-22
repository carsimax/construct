#!/usr/bin/env bash
set -euo pipefail
git init -q
printf '{ "type": "module", "scripts": { "test": "node --test" } }\n' > package.json
printf 'script-shell=/bin/sh\n' > .npmrc
cat > paginate.js <<'JS'
// Pages are 1-based: page 1 is the first `size` items.
export function paginate(items, page, size) {
  const start = page * size
  return items.slice(start, start + size)
}
JS
cat > paginate.test.js <<'JS'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paginate } from './paginate.js'

const items = ['a', 'b', 'c', 'd', 'e']

test('paginate returns the first page for page 1', () => {
  assert.deepEqual(paginate(items, 1, 2), ['a', 'b'])
})

test('paginate returns the short last page', () => {
  assert.deepEqual(paginate(items, 3, 2), ['e'])
})
JS
git add -A
git -c user.email=eval@example.com -c user.name=eval commit -qm "chore: initial files"
