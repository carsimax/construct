#!/usr/bin/env bash
# Outcome check: run from a fresh temp dir with the kept workspace path as $1.
# Copies only paginate.js, so nothing runs inside the workspace.
set -euo pipefail
ws="$1"
cp "$ws/paginate.js" .
printf '{"type":"module"}\n' > package.json
cat > outcome.hidden.test.js <<'JS'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paginate } from './paginate.js'

test('paginate pages are 1-based', () => {
  const items = ['a', 'b', 'c', 'd', 'e']
  assert.deepEqual(paginate(items, 1, 2), ['a', 'b'])
  assert.deepEqual(paginate(items, 2, 2), ['c', 'd'])
  assert.deepEqual(paginate(items, 3, 2), ['e'])
  assert.deepEqual(paginate(items, 4, 2), [])
})
JS
node --test
