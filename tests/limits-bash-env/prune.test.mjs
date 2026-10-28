// S3 of .vault/tasks/config-surface.md and S2 of .vault/tasks/limits-hook.md: pruneState also removes idle per-session limits
// files under dataDir() only; the temp fallback directory's limits are left alone.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { scratchDir } from '../helpers/repo.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname

test('pruneState removes an idle limits file and keeps a fresh one, under the data dir and leaves the fallback dir alone', () => {
  const tmp = scratchDir('prune-tmp-')
  const data = scratchDir('prune-data-')
  const fallback = join(tmp, `construct-${process.getuid()}`)
  mkdirSync(fallback, { mode: 0o700 })
  const week = new Date(Date.now() - 8 * 24 * 3600 * 1000)
  const seed = (base) => {
    mkdirSync(join(base, 'limits'), { recursive: true })
    writeFileSync(join(base, 'limits', 'old.json'), '{}')
    writeFileSync(join(base, 'limits', 'new.json'), '{}')
    utimesSync(join(base, 'limits', 'old.json'), week, week)
  }
  seed(data)
  seed(fallback)
  const hookIo = join(PLUGIN, 'hooks/scripts/hook-io.mjs')
  const r = spawnSync('node', ['-e', `import(${JSON.stringify(hookIo)}).then((m) => m.pruneState())`], { env: { ...process.env, TMPDIR: tmp, CLAUDE_PLUGIN_DATA: data } })
  assert.equal(r.status, 0)
  assert.equal(existsSync(join(data, 'limits', 'old.json')), false)
  assert.equal(existsSync(join(data, 'limits', 'new.json')), true)
  assert.equal(existsSync(join(fallback, 'limits', 'old.json')), true)
  assert.equal(existsSync(join(fallback, 'limits', 'new.json')), true)
})
