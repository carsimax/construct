// The Stop hook timeout must cover the snapshot budgets plus the two bounded git diffs (S12).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DIFF_BUDGET_MS, FALLBACK_BUDGET_MS, SNAPSHOT_BUDGET_MS } from '../../plugins/construct/hooks/scripts/git-tree.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname

test('the Stop hook timeout covers the snapshot and both git diffs', () => {
  const stop = JSON.parse(readFileSync(`${PLUGIN}hooks/hooks.json`, 'utf8')).hooks.Stop
  const entry = stop.flatMap((e) => e.hooks).find((h) => h.args?.some((a) => a.endsWith('risk-line.mjs')))
  assert.ok(entry.timeout * 1000 >= SNAPSHOT_BUDGET_MS + FALLBACK_BUDGET_MS + 2 * DIFF_BUDGET_MS + 5000, 'five seconds of slack for node and the small git calls')
})

test('risk-line bounds the status and the diff with the diff budget', () => {
  const source = readFileSync(`${PLUGIN}hooks/scripts/risk-line.mjs`, 'utf8')
  assert.equal(source.match(/fingerprint\(git, root, DIFF_BUDGET_MS\)/g)?.length, 2)
  assert.match(source, /'--untracked-files=all'\], \{ timeout \}/)
  assert.equal(source.match(/timeout: DIFF_BUDGET_MS/g)?.length, 1)
})
