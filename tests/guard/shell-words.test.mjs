// shell-words.mjs: the tokenizer and command unwrapping the publication gate relies on.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GIT_VALUE_FLAGS, headIndex, SHELLS, splitCommands } from '../../plugins/construct/hooks/scripts/shell-words.mjs'

test('shared constants', () => {
  assert.ok(SHELLS.has('zsh'))
  assert.ok(GIT_VALUE_FLAGS.has('--super-prefix'))
})

test('headIndex skips wrapper flags, their values, and the timeout duration', () => {
  assert.equal(headIndex(['timeout', '-k', '2', '--foreground', '5', 'git']), 5)
  assert.equal(headIndex(['nice', '-n', '5', 'git']), 3)
  assert.equal(headIndex(['sudo', '-u', 'me', 'git']), 3)
  assert.equal(headIndex(['env', '-u', 'A', 'B=1', 'git']), 4)
})

test('a backslash-newline joins before tokenizing, and stays inside a word when the word continues', () => {
  assert.deepEqual(splitCommands('git \\\nreset --hard').map((w) => w.map((x) => x.t)), [['git', 'reset', '--hard']])
  assert.deepEqual(splitCommands('gi\\\nt status').map((w) => w.map((x) => x.t)), [['git', 'status']])
  assert.deepEqual(splitCommands('echo "a\\\nb"').map((w) => w.map((x) => x.t)), [['echo', 'ab']])
  assert.deepEqual(splitCommands("echo 'a\\\nb'").map((w) => w.map((x) => x.t)), [['echo', 'a\\\nb']])
})
