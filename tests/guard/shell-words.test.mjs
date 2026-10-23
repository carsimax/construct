// shell-words.mjs: the tokenizer and command unwrapping the publication gate relies on.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GIT_VALUE_FLAGS, SHELLS, nestedLines, splitCommands } from '../../plugins/construct/hooks/scripts/shell-words.mjs'

test('shared constants', () => {
  assert.ok(SHELLS.has('zsh'))
  assert.ok(GIT_VALUE_FLAGS.has('--super-prefix'))
})

test('a backslash-newline joins before tokenizing, and stays inside a word when the word continues', () => {
  assert.deepEqual(splitCommands('git \\\nreset --hard').map((w) => w.map((x) => x.t)), [['git', 'reset', '--hard']])
  assert.deepEqual(splitCommands('gi\\\nt status').map((w) => w.map((x) => x.t)), [['git', 'status']])
  assert.deepEqual(splitCommands('echo "a\\\nb"').map((w) => w.map((x) => x.t)), [['echo', 'ab']])
  assert.deepEqual(splitCommands("echo 'a\\\nb'").map((w) => w.map((x) => x.t)), [['echo', 'a\\\nb']])
})

test('xargs unwraps to its command: -i, -l and -e take no separate value, -J, -n and -S do', () => {
  const head = (line) => { const { name, args } = nestedLines(splitCommands(line)[0].map((x) => x.t)); return [name, ...args].join(' ') }
  assert.equal(head('xargs -i rm -rf {}'), 'rm -rf {}')
  assert.equal(head('xargs -l rm -rf'), 'rm -rf')
  assert.equal(head('xargs -e rm -rf'), 'rm -rf')
  assert.equal(head('xargs -J % rm -rf %'), 'rm -rf %')
  assert.equal(head('xargs -S 100 -R 2 rm -rf'), 'rm -rf')
  assert.equal(head('xargs -n 1 rm -rf'), 'rm -rf')
})
