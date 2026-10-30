#!/usr/bin/env bash
# Outcome check: run from a fresh temp dir with the kept workspace path as $1.
# Copies the workspace here and runs hidden acceptance tests that exist only in this script.
set -euo pipefail
ws="$1"
tar -C "$ws" --exclude=.git -cf - . | tar -xf -
cat > outcome.hidden.test.js <<'JS'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const cli = (text, ...flags) => {
  writeFileSync('people.txt', text)
  return spawnSync(process.execPath, ['cli.js', ...flags.map((f) => (f === '@' ? 'people.txt' : f))], { encoding: 'utf8' })
}

test('S1 header row, flag before or after the file', () => {
  assert.equal(cli('Ann: admin\nBob: dev\n', '--csv', '@').stdout, 'name,role\nAnn,admin\nBob,dev\n')
  assert.equal(cli('Ann: admin\n', '@', '--csv').stdout, 'name,role\nAnn,admin\n')
})

test('S2 quoting of commas and quotes', () => {
  const res = cli('Smith, Ann: the "boss"\n', '--csv', '@')
  assert.equal(res.stdout, 'name,role\n"Smith, Ann","the ""boss"""\n')
  assert.equal(cli('Ann: say "hi"\n', '--csv', '@').stdout, 'name,role\nAnn,"say ""hi"""\n')
})

test('S3 empty list prints only the header', () => {
  const res = cli('\n', '--csv', '@')
  assert.equal(res.status, 0)
  assert.equal(res.stdout, 'name,role\n')
})

test('S4 unknown flag exits 2 with a message on stderr', () => {
  for (const flags of [['--bogus', '@'], ['--csv', '--bogus', '@']]) {
    const res = cli('Ann: admin\n', ...flags)
    assert.equal(res.status, 2)
    assert.notEqual(res.stderr.trim(), '')
  }
})

test('without --csv the text output is unchanged', () => {
  assert.equal(cli('Ann: admin\n', '@').stdout, 'Ann - admin\n')
})
JS
node --test outcome.hidden.test.js
