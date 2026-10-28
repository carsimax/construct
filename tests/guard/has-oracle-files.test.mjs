// hasOracleFiles may only say "no locks" when it can prove it without git (review-risk on feat/hardening).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { hasOracleFiles } from '../../plugins/construct/hooks/scripts/review-store.mjs'
import { scratchDir } from '../helpers/repo.mjs'

test('a root without a .git entry (GIT_DIR or core.worktree layouts) is not proof of no locks', () => {
  assert.equal(hasOracleFiles(scratchDir('has-oracle-')), true)
})

test('a plain .git directory with no oracles folder has no locks', () => {
  const root = scratchDir('has-oracle-')
  mkdirSync(join(root, '.git'))
  assert.equal(hasOracleFiles(root), false)
})
