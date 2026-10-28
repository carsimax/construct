// S8 (band-one-row): the VERSION the band and /construct doctor show equals the plugin manifest's version.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { VERSION } from '../plugins/construct/hooks/status/version.js'

const manifest = JSON.parse(readFileSync(new URL('../plugins/construct/.claude-plugin/plugin.json', import.meta.url), 'utf8'))

test('VERSION equals the version in plugin.json', () => {
  assert.equal(VERSION, manifest.version)
})
