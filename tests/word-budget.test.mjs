import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// S9-S11 word targets: whitespace-separated words of the whole file, like `wc -w`.
const root = new URL('../plugins/construct/', import.meta.url)
const words = (rel) => readFileSync(new URL(rel, root), 'utf8').split(/\s+/).filter(Boolean).length
const sum = (rels) => rels.reduce((n, r) => n + words(r), 0)

const skill = (name) => `skills/${name}/SKILL.md`
const ref = (name, file) => `skills/${name}/references/${file}.md`
const lens = ['risk', 'reliability', 'resilience', 'readability'].map((l) => [`agents/review-${l}.md`, 500])

const FILES = [
  [skill('workflow'), 700], [skill('delegation'), 800], [ref('delegation', 'handoffs'), 600],
  ['agents/worker.md', 500], ['agents/explorer.md', 250], ['agents/verifier.md', 650], ['agents/general.md', 200],
  [skill('review'), 900], [ref('review', 'security-checklist'), 450], [ref('review', 'dual-review'), 700],
  ...lens, ['agents/judge-a.md', 265], ['agents/judge-b.md', 265],
  [skill('delivery'), 900], [ref('delivery', 'chains'), 500],
  [skill('debugging'), 550], [ref('debugging', 'triage'), 500],
  [skill('migration'), 450], [ref('migration', 'phases'), 300],
  [skill('constraints'), 600], [ref('constraints', 'constraints-template'), 450],
  [skill('sources'), 400], [ref('sources', 'sources'), 200],
]

for (const [rel, max] of FILES) {
  test(`${rel} stays at or under ${max} words`, () => {
    assert.ok(words(rel) <= max, `${rel} has ${words(rel)} words`)
  })
}

test('the workflow references together stay at or under 1,400 words', () => {
  const refs = ['feature-document', 'persistence', 'research', 'testing'].map((f) => ref('workflow', f))
  assert.ok(sum(refs) <= 1400, `${sum(refs)} words`)
})
