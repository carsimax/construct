import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const pluginRoot = new URL('../plugins/construct/', import.meta.url).pathname
const repoRoot = new URL('../', import.meta.url).pathname

test('the plugin ships no output style', () => {
  assert.equal(existsSync(join(pluginRoot, 'output-styles')), false)
})

test('the plugin ships no theme', () => {
  assert.equal(existsSync(join(pluginRoot, 'themes')), false)
})

test('the eval runner grants only the commands the cases need', () => {
  const script = readFileSync(join(repoRoot, 'scripts/eval.sh'), 'utf8')
  assert.doesNotMatch(script, /"Bash\(node \*\)"/)
  assert.doesNotMatch(script, /"Bash\(git \*\)"/)
  assert.match(script, /"Bash\(npm test\*\)"/)
})
