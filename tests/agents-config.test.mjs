import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const pluginRoot = new URL('../plugins/construct/', import.meta.url).pathname
const manifest = JSON.parse(readFileSync(join(pluginRoot, '.claude-plugin/plugin.json'), 'utf8'))
const agentFiles = readdirSync(join(pluginRoot, 'agents')).filter((f) => f.endsWith('.md'))

// S6 role table: agent, model, effort ('default' means no effort override)
const S6 = {
  'odd-explorer': ['haiku', 'medium'],
  'odd-worker': ['sonnet', 'medium'],
  'odd-verify': ['opus', 'medium'],
  'jd-judge-a': ['opus', 'medium'],
  'jd-judge-b': ['sonnet', 'medium'],
  'jd-fix-agent': ['sonnet', 'medium'],
  'review-risk': ['opus', 'medium'],
  'review-readability': ['sonnet', 'medium'],
  'review-reliability': ['sonnet', 'medium'],
  'review-resilience': ['sonnet', 'medium'],
  'odd-general': ['sonnet', 'medium'],
}

function frontmatter(file) {
  const text = readFileSync(join(pluginRoot, 'agents', file), 'utf8')
  const block = text.split('---')[1]
  const field = (name) => block.match(new RegExp(`^${name}: (\\S+)`, 'm'))?.[1]
  return { name: field('name'), model: field('model'), effort: field('effort') ?? 'default' }
}

test('every S6 role has exactly one agent file and nothing else ships', () => {
  assert.deepEqual(agentFiles.map((f) => f.replace(/\.md$/, '')).sort(), Object.keys(S6).sort())
})

test('agent frontmatter matches the S6 table and the file name', () => {
  for (const file of agentFiles) {
    const fm = frontmatter(file)
    const agent = file.replace(/\.md$/, '')
    assert.equal(fm.name, agent, `${file} name`)
    assert.deepEqual([fm.model, fm.effort], S6[agent], `${file} model/effort`)
  }
})

test('userConfig declares model and effort options whose defaults match each agent', () => {
  const cfg = manifest.userConfig
  for (const [agent, [model, effort]] of Object.entries(S6)) {
    const role = agent.replaceAll('-', '_')
    assert.equal(cfg[`model_${role}`]?.default, model, `model_${role}`)
    assert.equal(cfg[`effort_${role}`]?.default, effort, `effort_${role}`)
    assert.ok(cfg[`model_${role}`].options.includes(model))
    assert.ok(cfg[`effort_${role}`].options.includes('default'))
  }
  // The panel's switch is a key that is not a model or effort option
  assert.equal(cfg.panel_open_on_start?.type, 'boolean')
  assert.equal(cfg.panel_open_on_start?.default, true)
  assert.equal(Object.keys(cfg).length, Object.keys(S6).length * 2 + 1)
})

test('no plugin agent references gentle-ai or any engram tool', () => {
  for (const file of agentFiles) {
    const text = readFileSync(join(pluginRoot, 'agents', file), 'utf8')
    assert.doesNotMatch(text, /gentle[-_ ]?ai/i, file)
    assert.doesNotMatch(text, /mcp__(plugin_engram_)?engram/, file)
  }
})

test('odd-explorer keeps Bash so it can run construct-memory search, and the manifests have no engram dependency', () => {
  const tools = readFileSync(join(pluginRoot, 'agents', 'odd-explorer.md'), 'utf8').match(/^tools:(.*)$/m)[1]
  assert.match(tools, /\bBash\b/)
  assert.equal(manifest.dependencies, undefined)
  const market = JSON.parse(readFileSync(new URL('../.claude-plugin/marketplace.json', import.meta.url), 'utf8'))
  assert.equal(market.allowCrossMarketplaceDependenciesOn, undefined)
})
