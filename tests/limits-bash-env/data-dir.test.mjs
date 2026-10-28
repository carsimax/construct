// S2 of .vault/tasks/limits-hook.md: readLimits reads dataDir() only; a file in the temp fallback directory is ignored.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { scratchDir } from '../helpers/repo.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const run = (cmd, args, env, input) => spawnSync(cmd, args, { input, encoding: 'utf8', env })

test('readLimits uses the plugin data dir file and ignores a newer one in the fallback dir', () => {
  const tmp = scratchDir('limits-tmp-')
  const data = scratchDir('limits-data-')
  for (const [dir, inline] of [[data, 200], [join(tmp, `construct-${process.getuid()}`), 400]]) {
    mkdirSync(join(dir, 'limits'), { recursive: true, mode: 0o700 })
    writeFileSync(join(dir, 'limits', 'sB.json'), JSON.stringify({ inline }))
  }
  const script = `import { readLimits } from ${JSON.stringify(join(PLUGIN, 'hooks/scripts/limits.mjs'))}; console.log(JSON.stringify(readLimits('sB')))`
  const r = run('node', ['--input-type=module', '-e', script], { ...process.env, TMPDIR: tmp, CLAUDE_PLUGIN_DATA: data })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(JSON.parse(r.stdout).inline, 200)
})
