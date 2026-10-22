#!/usr/bin/env bash
set -euo pipefail
git init -q -b main
git config user.email eval@example.com
git config user.name eval
cat > auth.js <<'JS'
export function tokenMatches(given, expected) {
  return given === expected
}
JS
printf '{ "type": "module", "scripts": { "test": "node --test" } }\n' > package.json
printf 'script-shell=/bin/sh\n' > .npmrc
git add -A
git commit -qm "chore: initial auth module"
base=$(git rev-parse --short HEAD)
git checkout -q -b feat/token-check
cat > auth.js <<'JS'
import { timingSafeEqual } from 'node:crypto'

export function tokenMatches(given, expected) {
  const a = Buffer.from(String(given))
  const b = Buffer.from(String(expected))
  return a.length === b.length && timingSafeEqual(a, b)
}
JS
cat > auth.test.js <<'JS'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokenMatches } from './auth.js'

test('tokenMatches accepts only an equal token', () => {
  assert.equal(tokenMatches('abc', 'abc'), true)
  assert.equal(tokenMatches('abc', 'abd'), false)
  assert.equal(tokenMatches('ab', 'abc'), false)
})
JS
git add -A
git commit -qm "fix: compare tokens in constant time"
commit=$(git rev-parse --short HEAD)
mkdir -p odd/tasks
cat > odd/tasks/token-check.md <<DOC
# Token check

Objective: compare API tokens in constant time. Branch: feat/token-check. Baseline: $base. Delivery strategy: single branch. Test runner: npm test.

## Specs

- **S1 — Constant-time token comparison.** "compare tokens without leaking their content through timing"
  - Given a stored token When a caller presents a token Then the comparison takes the same time for any mismatch.

## Tasks

| ID | Specs | Task | Route | Risk | Status | Commit |
|---|---|---|---|---|---|---|
| T1 | S1 | Replace the \`===\` token comparison with a constant-time one | worker | 2 | done | $commit |

## Log

- **L1 (2026-01-01):** "compare tokens without leaking their content through timing"
DOC
git add -A
git commit -qm "docs: track token check"
