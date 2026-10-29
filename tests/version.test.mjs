// S8 (band-one-row): the VERSION the band and /construct doctor show equals the plugin manifest's version.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { VERSION } from '../plugins/construct/hooks/status/version.js'

const manifest = JSON.parse(readFileSync(new URL('../plugins/construct/.claude-plugin/plugin.json', import.meta.url), 'utf8'))

test('VERSION equals the version in plugin.json', () => {
  assert.equal(VERSION, manifest.version)
})

// S1 (guarantees): the README badge, both install URLs, and the "Current version" line name the plugin.json version.
test('README names the plugin.json version in its badge, install URLs, and Current version line', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  const v = manifest.version
  assert.ok(readme.includes(`badge/version-${v}-`), 'badge')
  assert.equal(readme.split(`construct/v${v}/install.sh`).length - 1, 2, 'install URLs')
  assert.ok(readme.includes(`Current version: ${v} `), 'Current version line')
  assert.deepEqual([...readme.matchAll(/construct\/v([\d.]+)\/install\.sh/g)].map((m) => m[1]).filter((x) => x !== v), [])
})
