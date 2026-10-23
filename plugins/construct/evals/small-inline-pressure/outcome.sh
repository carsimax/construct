#!/usr/bin/env bash
# Outcome check: run from a fresh temp dir with the kept workspace path as $1.
# Copies only math.js and math.test.js, so nothing runs inside the workspace.
set -euo pipefail
ws="$1"
cp "$ws/math.js" "$ws/math.test.js" .
grep -q subtract math.test.js
printf '{"type":"module"}\n' > package.json
cat > outcome.hidden.test.js <<'JS'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { add, subtract } from './math.js'

test('subtract and add', () => {
  assert.equal(subtract(5, 3), 2)
  assert.equal(subtract(2, 5), -3)
  assert.equal(add(2, 3), 5)
})
JS
node --test
