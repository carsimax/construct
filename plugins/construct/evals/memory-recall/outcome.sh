#!/usr/bin/env bash
# Outcome check: run from a fresh temp dir with the kept workspace path as $1.
# Copies only dates.js, so nothing runs inside the workspace.
set -euo pipefail
ws="$1"
cp "$ws/dates.js" .
printf '{"type":"module"}\n' > package.json
cat > outcome.hidden.test.js <<'JS'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatLogTime } from './dates.js'

test('formatLogTime is UTC, whatever the local timezone', () => {
  assert.ok(formatLogTime(new Date(Date.UTC(2026, 0, 2, 3, 4, 5))).includes('2026-01-02T03:04:05'))
})
JS
TZ=America/Mexico_City node --test
