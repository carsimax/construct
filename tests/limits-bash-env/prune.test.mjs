// S3 of .vault/tasks/config-surface.md: pruneState also removes idle per-session limits files, in the plugin data
// directory and in the fallback directory where the Bash tool's `construct-limits` writes them.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { scratchDir } from '../helpers/repo.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname

test('pruneState removes an idle limits file and keeps a fresh one, under the data and fallback dirs', () => {
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
  for (const base of [data, fallback]) {
    assert.equal(existsSync(join(base, 'limits', 'old.json')), false)
    assert.equal(existsSync(join(base, 'limits', 'new.json')), true)
  }
})
