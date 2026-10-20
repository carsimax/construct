import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const pluginRoot = new URL('../plugins/construct/', import.meta.url).pathname
const repoRoot = new URL('../', import.meta.url).pathname

function frontmatter(text) {
  const block = text.split('---')[1] ?? ''
  return Object.fromEntries(block.trim().split('\n').map((l) => l.split(/:\s*/, 2)))
}

test('the plugin ships only the Neutral output style and forces it', () => {
  const files = readdirSync(join(pluginRoot, 'output-styles')).sort()
  assert.deepEqual(files, ['neutral.md'])
  for (const [file, name] of [['neutral.md', 'Neutral']]) {
    const text = readFileSync(join(pluginRoot, 'output-styles', file), 'utf8')
    const fm = frontmatter(text)
    assert.equal(fm.name, name)
    assert.equal(fm['keep-coding-instructions'], 'true')
    assert.equal(fm['force-for-plugin'], 'true', `${file} must apply in every project`)
    assert.match(text, /## Working Rules/)
    assert.match(text, /Co-Authored-By/)
    assert.doesNotMatch(text, /gentle[-_ ]?ai/i)
  }
})

// Override tokens documented for custom themes (terminal-config, Color token reference).
const THEME_TOKENS = new Set([
  'claude', 'text', 'inverseText', 'inactive', 'subtle', 'suggestion', 'permission', 'remember',
  'success', 'error', 'warning', 'merged', 'promptBorder', 'planMode', 'autoAccept', 'bashBorder', 'ide',
  'fastMode', 'effortUltra', 'diffAdded', 'diffRemoved', 'diffAddedDimmed', 'diffRemovedDimmed',
  'diffAddedWord', 'diffRemovedWord', 'userMessageBackground', 'userMessageBackgroundHover',
  'bashMessageBackgroundColor', 'memoryBackgroundColor', 'selectionBg', 'composerSidebarBackground',
  'rate_limit_fill', 'rate_limit_empty', 'briefLabelYou', 'briefLabelClaude', 'claudeShimmer', 'warningShimmer',
  'permissionShimmer', 'promptBorderShimmer', 'inactiveShimmer', 'fastModeShimmer',
  ...['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'].map((c) => `${c}_FOR_SUBAGENTS_ONLY`),
])

test('the plugin ships a single Construct theme with the matrix palette', () => {
  assert.deepEqual(readdirSync(join(pluginRoot, 'themes')), ['construct.json'])
  const text = readFileSync(join(pluginRoot, 'themes', 'construct.json'), 'utf8')
  const theme = JSON.parse(text)
  assert.equal(theme.name, 'Construct')
  assert.equal(theme.base, 'dark')
  for (const [token, value] of Object.entries(theme.overrides)) {
    assert.ok(THEME_TOKENS.has(token), `unknown theme token ${token} would be ignored silently`)
    assert.match(value, /^#[0-9A-Fa-f]{6}$/, `${token} must be #rrggbb`)
  }
  // Matrix phosphor green as the accent; errors and warnings keep their signal colors.
  assert.equal(theme.overrides.claude, '#00FF41')
  assert.equal(theme.overrides.success, '#00FF41')
  assert.equal(theme.overrides.error, '#FF3B3B')
  assert.ok(theme.overrides.warning && theme.overrides.warning !== theme.overrides.success)
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
