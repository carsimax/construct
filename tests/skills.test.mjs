import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { LENSES_BY_RISK } from '../plugins/construct/hooks/scripts/review-lenses.mjs'

const pluginRoot = new URL('../plugins/construct/', import.meta.url).pathname
const skillsRoot = join(pluginRoot, 'skills')

const EXPECTED = [
  'constraints',
  'debugging',
  'delivery',
  'memory',
  'migration',
  'delegation',
  'workflow',
  'review',
  'sources',
]

function skillDirs() {
  return existsSync(skillsRoot)
    ? readdirSync(skillsRoot).filter((d) => statSync(join(skillsRoot, d)).isDirectory())
    : []
}

function filesUnder(dir) {
  return readdirSync(dir, { recursive: true })
    .map((f) => join(dir, f))
    .filter((f) => statSync(f).isFile())
}

test('the plugin ships exactly the expected skills', () => {
  assert.deepEqual(skillDirs().sort(), [...EXPECTED].sort())
})

test('every skill has frontmatter whose name matches its directory and a description', () => {
  for (const dir of skillDirs()) {
    const text = readFileSync(join(skillsRoot, dir, 'SKILL.md'), 'utf8')
    const block = text.split('---')[1] ?? ''
    assert.equal(block.match(/^name: (\S+)/m)?.[1], dir, `${dir} name`)
    assert.match(block, /^description: .{20,}/m, `${dir} description`)
  }
})

// S5 (deterministic-signals): skills only the orchestrator applies stay out of the / menu.
test('model-only skills are hidden from the / menu, the rest stay user-invocable', () => {
  const MODEL_ONLY = ['delegation', 'review', 'workflow']
  for (const dir of skillDirs()) {
    const block = readFileSync(join(skillsRoot, dir, 'SKILL.md'), 'utf8').split('---')[1] ?? ''
    const value = block.match(/^user-invocable: *(\S+)/m)?.[1]
    assert.equal(value, MODEL_ONLY.includes(dir) ? 'false' : undefined, dir)
  }
})

test('no skill references gentle-ai, the skill registry, or skill resolution reporting', () => {
  for (const dir of skillDirs()) {
    for (const file of filesUnder(join(skillsRoot, dir))) {
      const text = readFileSync(file, 'utf8')
      assert.doesNotMatch(text, /gentle[-_ ]?ai/i, file)
      assert.doesNotMatch(text, /skill-registry|\.atl\//, file)
      assert.doesNotMatch(text, /skill[ _]resolution/i, file)
    }
  }
})

test('relative markdown links inside skills resolve to existing files', () => {
  for (const dir of skillDirs()) {
    for (const file of filesUnder(join(skillsRoot, dir)).filter((f) => f.endsWith('.md'))) {
      const text = readFileSync(file, 'utf8')
      for (const [, target] of text.matchAll(/\]\(((?!https?:|#)[^)\s]+)\)/g)) {
        const path = resolve(dirname(file), target.split('#')[0])
        assert.ok(existsSync(path), `${file} links to missing ${target}`)
      }
    }
  }
})

test('review (dual review) names the plugin-namespaced agents', () => {
  const text = filesUnder(join(skillsRoot, 'review')).map((f) => readFileSync(f, 'utf8')).join('\n')
  for (const agent of ['judge-a', 'judge-b', 'worker']) {
    assert.match(text, new RegExp(`construct:${agent}`), agent)
    assert.doesNotMatch(text, new RegExp(`\`${agent}\``), `bare ${agent}`)
  }
})

test('NOTICE lists the adapted code and carries no license text', () => {
  const notice = readFileSync(join(pluginRoot, 'NOTICE'), 'utf8')
  assert.doesNotMatch(notice, /Permission is hereby granted/)
  assert.ok(notice.trimEnd().split('\n').length < 30, 'NOTICE stays under 30 lines')
  for (const project of ['gentle-shell']) {
    assert.match(notice, new RegExp(`LICENSE-${project}`))
    const license = join(pluginRoot, `LICENSE-${project}`)
    assert.ok(existsSync(license))
    assert.match(readFileSync(license, 'utf8'), /Permission is hereby granted/)
  }
  assert.doesNotMatch(notice, /flightdeck/i)
  assert.ok(!existsSync(join(pluginRoot, 'LICENSE-flightdeck')))
  assert.doesNotMatch(notice, /gentle-agent-state/)
  assert.ok(!existsSync(join(pluginRoot, 'LICENSE-gentle-agent-state')))
  assert.doesNotMatch(notice, /agent-skills|BMAD|engram/)
})

test('README credits the ideas-only projects', () => {
  const readme = readFileSync(join(pluginRoot, '..', '..', 'README.md'), 'utf8')
  const credits = readme.slice(readme.indexOf('## Credits'), readme.indexOf('## License'))
  for (const p of ['gentle-ai', 'agent-skills', 'engram', 'BMAD-METHOD', 'get-shit-done', 'gstack', 'compound-engineering-plugin', 'spec-kit', 'ECC', 'claude-flightdeck']) assert.match(credits, new RegExp(p))
})

test('review quotes the lens mapping of review-lenses.mjs', () => {
  const text = readFileSync(join(skillsRoot, 'review', 'SKILL.md'), 'utf8')
  for (const [item, lenses] of Object.entries(LENSES_BY_RISK)) {
    const row = `| ${item} | ${lenses.map((l) => `\`${l}\``).join(', ')} |`
    assert.ok(text.includes(row), `missing mapping row ${row}`)
  }
})

test('review names the Review subject form and no longer names the removed CLIs or the switch', () => {
  const text = filesUnder(join(skillsRoot, 'review')).map((f) => readFileSync(f, 'utf8')).join('\n')
  assert.doesNotMatch(text, /<base>\.\.<head>|consecutive ranges/)
  assert.match(text, /Review subject: <base>`/)
  assert.doesNotMatch(text, /odd-review|odd-assess|review_due|refuter|validator/)
})

test('the only MCP server is the plugin\'s own memory server', () => {
  const { mcpServers } = JSON.parse(readFileSync(join(pluginRoot, '.mcp.json'), 'utf8'))
  assert.deepEqual(mcpServers, { memory: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/memory-mcp.mjs'] } })
  assert.ok(existsSync(join(pluginRoot, 'hooks/scripts/memory-mcp.mjs')))
})

test('S5: delegation handoff names the verifier and its strength', () => {
  const t = readFileSync(join(skillsRoot, 'delegation/references/handoffs.md'), 'utf8')
  assert.match(t, /Verifier strength/)
  assert.match(t, /weak/i)
  assert.match(t, /stops after one step/)
})

test('A2: weak and missing verifiers are distinguished in the worker, handoff, and delegation docs', () => {
  for (const f of ['delegation/references/handoffs.md', 'delegation/SKILL.md', '../agents/worker.md']) {
    const t = readFileSync(join(skillsRoot, f), 'utf8')
    assert.match(t, /ambiguous requirements or external side effects/, f)
    assert.match(t, /no verifier/i, f)
    assert.match(t, /what would make (it|the work) verifiable/, f)
    assert.match(t, /docs-only[^\n]*reviewed diff is the verifier/, f)
    assert.doesNotMatch(t, /weak \(none or ambiguous\)/, f)
  }
})

test('A3: workflow Close reports without another verification loop and loops only during implementation', () => {
  const t = readFileSync(join(skillsRoot, 'workflow/SKILL.md'), 'utf8')
  assert.match(t, /during implementation[^\n]*loop until it passes/i)
  assert.match(t, /\*\*Close\.\*\*[^\n]*reports[^\n]*never starts another verification loop/)
})

test('S5: workflow Close names skipped or unverified checks', () => {
  const t = readFileSync(join(skillsRoot, 'workflow/SKILL.md'), 'utf8')
  assert.match(t, /\*\*Close\.\*\*[^\n]*unverified/)
})

test('S5: worker reviews its own diff before reporting', () => {
  const t = readFileSync(join(pluginRoot, 'agents/worker.md'), 'utf8')
  assert.match(t, /review your own diff/)
  assert.match(t, /missing test/)
})

test('testing.md verifier-weakening list names skipped tests, deleted assertions, suppressed errors, widened types, and committed credentials', () => {
  const t = readFileSync(join(skillsRoot, 'workflow/references/testing.md'), 'utf8')
  assert.match(t, /Never: skip a test, delete an assertion, suppress an error, widen a type, or commit a real credential or a fixture holding one/i)
})

// S2 (deterministic-signals T4): three skills inject real repository state through one dynamic-context line.
test('workflow, review, and delivery inject skill-context.mjs at column 0; no other skill injects anything', () => {
  const CMD = 'node "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/skill-context.mjs"'
  for (const dir of skillDirs()) {
    const text = readFileSync(join(skillsRoot, dir, 'SKILL.md'), 'utf8')
    const block = text.split('---')[1] ?? ''
    const injected = text.split('\n').filter((line) => line.startsWith('!`'))
    if (['workflow', 'review', 'delivery'].includes(dir)) {
      assert.deepEqual(injected, [`!\`${CMD} ${dir}\``], dir)
      assert.ok(block.split('\n').includes(`allowed-tools: Bash(${CMD} *)`), `${dir} allowed-tools`)
      assert.match(text, /^## Current state\n\n!`/m, `${dir} section`)
    } else {
      assert.deepEqual(injected, [], dir)
      assert.doesNotMatch(block, /skill-context/, `${dir} allowed-tools`)
    }
  }
})
