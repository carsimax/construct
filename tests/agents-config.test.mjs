import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const pluginRoot = new URL('../plugins/construct/', import.meta.url).pathname
const manifest = JSON.parse(readFileSync(join(pluginRoot, '.claude-plugin/plugin.json'), 'utf8'))
const agentFiles = readdirSync(join(pluginRoot, 'agents')).filter((f) => f.endsWith('.md'))

// S6 role table: agent, model, effort ('default' means no effort override)
const S6 = {
  'explorer': ['haiku', 'medium'],
  'worker': ['sonnet', 'medium'],
  'oracle': ['opus', 'medium'],
  'verifier': ['opus', 'medium'],
  'judge-a': ['opus', 'medium'],
  'judge-b': ['sonnet', 'medium'],
  'review-risk': ['opus', 'medium'],
  'review-readability': ['sonnet', 'medium'],
  'review-reliability': ['sonnet', 'medium'],
  'review-resilience': ['sonnet', 'medium'],
  'general': ['sonnet', 'medium'],
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

test('userConfig declares model and effort options defaulting to inherit, and no legacy options', () => {
  const cfg = manifest.userConfig
  for (const agent of Object.keys(S6)) {
    const role = agent.replaceAll('-', '_')
    assert.equal(cfg[`model_${role}`].default, 'inherit', `model_${role} default`)
    assert.equal(cfg[`effort_${role}`].default, 'inherit', `effort_${role} default`)
    assert.deepEqual(cfg[`model_${role}`].options, ['inherit', 'haiku', 'sonnet', 'opus', 'fable'])
    assert.deepEqual(cfg[`effort_${role}`].options, ['inherit', 'default', 'low', 'medium', 'high', 'xhigh', 'max'])
    assert.match(cfg[`model_${role}`].description, /inherit/)
  }
  for (const old of ['odd_explorer', 'odd_worker', 'odd_verify', 'odd_general', 'jd_judge_a', 'jd_judge_b', 'jd_fix_agent']) {
    assert.equal(cfg[`model_${old}`], undefined, old)
    assert.equal(cfg[`effort_${old}`], undefined, old)
  }
  // The band above the prompt has no switch: the docked panel and its option are gone
  assert.equal(cfg.panel_open_on_start, undefined)
  assert.equal(cfg.command_guard_asks?.type, 'boolean')
  assert.equal(cfg.command_guard_asks?.default, false)
  assert.equal(cfg.inline_edit_max_lines?.type, 'number')
  assert.equal(cfg.inline_edit_max_lines?.default, 150)
  assert.equal(cfg.slice_lines?.type, 'number')
  assert.equal(cfg.slice_lines?.default, 1500)
  assert.equal(cfg.iteration_cap?.type, 'number')
  assert.equal(cfg.iteration_cap?.default, 3)
  assert.equal(Object.keys(cfg).length, Object.keys(S6).length * 2 + 4)
})

test('no userConfig title names a methodology (ODD, RDD, JD)', () => {
  for (const [key, opt] of Object.entries(manifest.userConfig)) {
    assert.doesNotMatch(opt.title, /\b(ODD|RDD|JD)\b/, key)
  }
})

test('no plugin agent references gentle-ai', () => {
  for (const file of agentFiles) {
    const text = readFileSync(join(pluginRoot, 'agents', file), 'utf8')
    assert.doesNotMatch(text, /gentle[-_ ]?ai/i, file)
  }
})

test('explorer tells agents to recall with mem_search, and the manifests have no engram dependency', () => {
  const text = readFileSync(join(pluginRoot, 'agents', 'explorer.md'), 'utf8')
  assert.match(text, /mem_search/)
  const tools = text.split('---')[1].match(/^tools: (.*)$/m)[1].split(/,\s*/)
  assert.equal(manifest.dependencies, undefined)
  const market = JSON.parse(readFileSync(new URL('../.claude-plugin/marketplace.json', import.meta.url), 'utf8'))
  assert.equal(market.allowCrossMarketplaceDependenciesOn, undefined)
})

// Engram serves its tools under either prefix: direct MCP (`engram setup claude-code`) or the plugin's own server.
test('explorer and judges list Engram read tools under both prefixes, and no Engram write tool', () => {
  for (const agent of ['explorer', 'judge-a', 'judge-b']) {
    const tools = readFileSync(join(pluginRoot, 'agents', `${agent}.md`), 'utf8').split('---')[1].match(/^tools: (.*)$/m)[1].split(/,\s*/)
    for (const prefix of ['mcp__engram__', 'mcp__plugin_engram_engram__']) {
      for (const t of ['mem_search', 'mem_get_observation']) assert.ok(tools.includes(prefix + t), `${agent} lists ${prefix + t}`)
    }
    assert.deepEqual(tools.filter((t) => /engram/.test(t) && !/__mem_(search|get_observation)$/.test(t)), [], `${agent} lists only Engram read tools`)
  }
})

test('S2: explorer and judge agents list LSP, and no agent lists a codegraph tool', () => {
  const tools = (file) => readFileSync(join(pluginRoot, 'agents', file), 'utf8').split('---')[1].match(/^tools: (.*)$/m)?.[1] ?? ''
  for (const agent of ['explorer', 'judge-a', 'judge-b']) {
    assert.match(tools(`${agent}.md`), /\bLSP\b/, `${agent} lists LSP`)
  }
  for (const file of agentFiles) assert.doesNotMatch(tools(file), /mcp__codegraph/, `${file} lists no codegraph tool`)
})
