// The delivery skill states the feature-branch model; the feature document header no longer carries a strategy.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const skills = new URL('../plugins/construct/skills/', import.meta.url)
const read = (path) => readFileSync(new URL(path, skills), 'utf8')
const delivery = read('delivery/SKILL.md') + read('delivery/references/chains.md')
const header = read('workflow/references/feature-document.md').split('\n').find((line) => line.startsWith('Objective:'))
const REMOVED = ['ask-on-risk', 'auto-chain', 'single-pr', 'exception-ok', 'stacked-to-main', 'feature-branch-chain', 'size:exception', 'slice_lines']

test('the delivery skill names the feature-branch model', () => {
  const skill = read('delivery/SKILL.md')
  assert.ok(skill.includes('feat/<feature>-t<n>'))
  assert.ok(skill.includes('git merge --no-ff'))
  assert.match(skill, /only PR is `feat\/<feature>`/)
  assert.match(skill, /never pushed/)
  assert.ok(skill.includes('400 KB'))
})

test('the removed strategy and chain words are gone from the skill, its reference, and the header', () => {
  for (const word of REMOVED) {
    assert.ok(!delivery.includes(word), `skill still names ${word}`)
    assert.ok(!header?.includes(word), `header still names ${word}`)
  }
  assert.match(header ?? '', /Branch: .*Baseline: .*Test runner:/)
})

test('workflow points at construct:delivery, not the removed reference', () => {
  assert.doesNotMatch(read('workflow/SKILL.md'), /references\/delivery\.md/)
  assert.match(read('workflow/SKILL.md'), /construct:delivery/)
})
