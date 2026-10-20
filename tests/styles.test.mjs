import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const pluginRoot = new URL('../plugins/odd-skills/', import.meta.url).pathname
const repoRoot = new URL('../', import.meta.url).pathname

function frontmatter(text) {
  const block = text.split('---')[1] ?? ''
  return Object.fromEntries(block.trim().split('\n').map((l) => l.split(/:\s*/, 2)))
}

test('the plugin ships only the Neutral output style, without forcing it', () => {
  const files = readdirSync(join(pluginRoot, 'output-styles')).sort()
  assert.deepEqual(files, ['neutral.md'])
  for (const [file, name] of [['neutral.md', 'Neutral']]) {
    const text = readFileSync(join(pluginRoot, 'output-styles', file), 'utf8')
    const fm = frontmatter(text)
    assert.equal(fm.name, name)
    assert.equal(fm['keep-coding-instructions'], 'true')
    assert.equal(fm['force-for-plugin'], undefined, `${file} must not force itself`)
    assert.match(text, /## Working Rules/)
    assert.match(text, /Co-Authored-By/)
    assert.doesNotMatch(text, /gentle[-_ ]?ai/i)
  }
})

test('the plugin ships a single odd theme as valid theme JSON', () => {
  assert.deepEqual(readdirSync(join(pluginRoot, 'themes')), ['odd.json'])
  const text = readFileSync(join(pluginRoot, 'themes', 'odd.json'), 'utf8')
  const theme = JSON.parse(text)
  assert.equal(theme.name, 'odd')
  assert.ok(['dark', 'light'].includes(theme.base))
  assert.ok(Object.keys(theme.overrides).length > 0)
  assert.doesNotMatch(text, /gentleman/i)
})

test('the eval runner grants only the commands the cases need', () => {
  const script = readFileSync(join(repoRoot, 'scripts/eval.sh'), 'utf8')
  assert.doesNotMatch(script, /"Bash\(node \*\)"/)
  assert.doesNotMatch(script, /"Bash\(git \*\)"/)
  assert.match(script, /"Bash\(npm test\*\)"/)
})

test('the Risk-line grader accepts plain and bold Risk lines', () => {
  const grader = readFileSync(join(pluginRoot, 'evals/small-inline/graders/risk-line.md'), 'utf8')
  const pattern = new RegExp(grader.match(/^pattern: '(.+)'$/m)[1])
  for (const ok of ['Risk: none', 'Risk: item 2 (auth)', '**Risk:** none', '**Risk: item 3 (shared parser)**']) {
    assert.match(ok, pattern, ok)
  }
  for (const bad of ['Risk: maybe', 'no risk line here', 'Risk: item 9']) {
    assert.doesNotMatch(bad, pattern, bad)
  }
})
