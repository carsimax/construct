// S11 D1: the delivery skill states the vocabulary the feature document uses.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const skills = new URL('../plugins/construct/skills/', import.meta.url)
const read = (path) => readFileSync(new URL(path, skills), 'utf8')
const delivery = read('delivery/SKILL.md') + read('delivery/references/chains.md')
const header = read('workflow/references/feature-document.md').split('\n').find((line) => line.startsWith('Objective:'))
const VOCABULARY = ['ask-on-risk', 'auto-chain', 'single-pr', 'exception-ok', 'stacked-to-main', 'feature-branch-chain']

test('the strategy vocabulary is the same in the skill and the feature document header', () => {
  for (const word of VOCABULARY) {
    assert.ok(delivery.includes(`\`${word}\``), `skill names ${word}`)
    assert.ok(header?.includes(word), `feature document header names ${word}`)
  }
})

test('workflow points at construct:delivery, not the removed reference', () => {
  assert.doesNotMatch(read('workflow/SKILL.md'), /references\/delivery\.md/)
  assert.match(read('workflow/SKILL.md'), /construct:delivery/)
})
