// S1: no per-role model or effort options in /config.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('../../plugins/construct/.claude-plugin/plugin.json', import.meta.url), 'utf8'))

test('S1: plugin.json userConfig lists no model_<role> or effort_<role> option', () => {
  const keys = Object.keys(manifest.userConfig ?? {})
  assert.deepEqual(keys.filter((k) => /^(model|effort)_/.test(k)), [])
})
