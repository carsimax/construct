#!/usr/bin/env bash
set -euo pipefail
git init -q
printf '{ "type": "module", "scripts": { "test": "node --test" } }\n' > package.json
printf 'script-shell=/bin/sh\n' > .npmrc
cat > greet.js <<'JS'
export const GREETING = 'Hello'

export function greet(name) {
  return `${GREETING}, ${name}!`
}
JS
cat > greet.test.js <<'JS'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { greet, GREETING } from './greet.js'

test('greet uses the greeting', () => {
  assert.equal(greet('Ann'), `${GREETING}, Ann!`)
})
JS
git add -A
git -c user.email=eval@example.com -c user.name=eval commit -qm "chore: initial files"
