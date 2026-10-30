#!/usr/bin/env bash
# Outcome check: run from a fresh temp dir with the kept workspace path as $1.
# Copies the workspace here and runs a hidden acceptance test that exists only in this script.
set -euo pipefail
ws="$1"
tar -C "$ws" --exclude=.git -cf - . | tar -xf -
cat > outcome.hidden.test.js <<'JS'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { greet } from './greet.js'

test('greet welcomes by name', () => {
  assert.equal(greet('Ann'), 'Welcome, Ann!')
})
JS
node --test outcome.hidden.test.js
