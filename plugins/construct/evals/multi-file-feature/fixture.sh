#!/usr/bin/env bash
set -euo pipefail
git init -q
printf '{ "type": "module", "scripts": { "test": "node --test" } }\n' > package.json
printf 'script-shell=/bin/sh\n' > .npmrc
cat > parser.js <<'JS'
// Reads lines of the form "name: role"; blank lines are skipped.
export function parse(text) {
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const i = line.indexOf(':')
      return { name: line.slice(0, i).trim(), role: line.slice(i + 1).trim() }
    })
}
JS
cat > formatter.js <<'JS'
export function formatText(rows) {
  return rows.map((r) => `${r.name} - ${r.role}`)
}
JS
cat > writer.js <<'JS'
export function write(lines) {
  if (lines.length) process.stdout.write(lines.join('\n') + '\n')
}
JS
cat > cli.js <<'JS'
import { readFileSync } from 'node:fs'
import { parse } from './parser.js'
import { formatText } from './formatter.js'
import { write } from './writer.js'

const [file] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
write(formatText(parse(readFileSync(file, 'utf8'))))
JS
cat > parser.test.js <<'JS'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from './parser.js'

test('parse reads name and role', () => {
  assert.deepEqual(parse('Ann: admin\n\nBob: dev\n'), [
    { name: 'Ann', role: 'admin' },
    { name: 'Bob', role: 'dev' },
  ])
})
JS
cat > formatter.test.js <<'JS'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatText } from './formatter.js'

test('formatText joins name and role', () => {
  assert.deepEqual(formatText([{ name: 'Ann', role: 'admin' }]), ['Ann - admin'])
})
JS
git add -A
git -c user.email=eval@example.com -c user.name=eval commit -qm "chore: initial files"
