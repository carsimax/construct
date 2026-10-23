import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const pluginRoot = new URL('../plugins/construct/', import.meta.url).pathname
const repoRoot = new URL('../', import.meta.url).pathname

function frontmatter(text) {
  const block = text.split('---')[1] ?? ''
  return Object.fromEntries(block.trim().split('\n').map((l) => l.split(/:\s*/, 2)))
}

test('the plugin ships only the Principal Engineer output style and forces it', () => {
  const files = readdirSync(join(pluginRoot, 'output-styles')).sort()
  assert.deepEqual(files, ['principal-engineer.md'])
  const text = readFileSync(join(pluginRoot, 'output-styles', 'principal-engineer.md'), 'utf8')
  const fm = frontmatter(text)
  assert.equal(fm.name, 'Principal Engineer')
  assert.equal(fm['keep-coding-instructions'], 'true')
  assert.equal(fm['force-for-plugin'], 'true', 'the style must apply in every project')
  assert.doesNotMatch(text, /gentle[-_ ]?ai/i)
})

test('the Principal Engineer style keeps the working rules and the Risk-line close', () => {
  const text = readFileSync(join(pluginRoot, 'output-styles', 'principal-engineer.md'), 'utf8')
  assert.match(text, /## Working Rules/)
  assert.match(text, /Co-Authored-By/)
  assert.match(text, /Conventional Commits/)
  assert.match(text, /check whether an available skill matches/)
  assert.match(text, /Risk: item N \(reason\)/)
  assert.match(text, /Risk: none/)
  assert.match(text, /what was verified/)
  assert.match(text, /subagent contract/)
  assert.doesNotMatch(text, /do not act\./i, 'No verifier must not forbid acting unconditionally')
  assert.match(text, /reviewed diff is the verifier/)
  assert.doesNotMatch(text, /Use CAPS/)
  assert.doesNotMatch(text, /## Own Every Line|## Simplicity Over Cleverness/)
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
