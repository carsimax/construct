import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { LENSES_BY_RISK } from '../plugins/construct/hooks/scripts/review-lenses.mjs'

const pluginRoot = new URL('../plugins/construct/', import.meta.url).pathname
const skillsRoot = join(pluginRoot, 'skills')

const EXPECTED = [
  'branch-pr',
  'chained-pr',
  'cognitive-doc-design',
  'comment-writer',
  'constraint-driven',
  'debugging',
  'go-testing',
  'judgment-day',
  'lossless-prompts',
  'memory',
  'migration',
  'odd-delegation',
  'odd-workflow',
  'rdd-review',
  'skill-creator',
  'skill-improver',
  'source-driven',
  'task-size-risk',
  'work-unit-commits',
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
  assert.deepEqual(skillDirs().sort(), EXPECTED)
})

test('every skill has frontmatter whose name matches its directory and a description', () => {
  for (const dir of skillDirs()) {
    const text = readFileSync(join(skillsRoot, dir, 'SKILL.md'), 'utf8')
    const block = text.split('---')[1] ?? ''
    assert.equal(block.match(/^name: (\S+)/m)?.[1], dir, `${dir} name`)
    assert.match(block, /^description: .{20,}/m, `${dir} description`)
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

test('judgment-day names the plugin-namespaced agents', () => {
  const text = readFileSync(join(skillsRoot, 'judgment-day', 'SKILL.md'), 'utf8')
  for (const agent of ['jd-judge-a', 'jd-judge-b', 'jd-fix-agent']) {
    assert.match(text, new RegExp(`construct:${agent}`), agent)
    assert.doesNotMatch(text, new RegExp(`\`${agent}\``), `bare ${agent}`)
  }
})

test('the MIT notice for the ported material ships with the plugin', () => {
  const notice = readFileSync(join(pluginRoot, 'NOTICE'), 'utf8')
  assert.match(notice, /MIT License/)
  assert.match(notice, /Copyright \(c\) 2025 Gentleman Programming/)
})

test('rdd-review quotes the lens mapping of review-lenses.mjs', () => {
  const text = readFileSync(join(skillsRoot, 'rdd-review', 'SKILL.md'), 'utf8')
  for (const [item, lenses] of Object.entries(LENSES_BY_RISK)) {
    const row = `| ${item} | ${lenses.map((l) => `\`${l}\``).join(', ')} |`
    assert.ok(text.includes(row), `missing mapping row ${row}`)
  }
})

test('rdd-review names the Review subject form and no longer names the removed CLIs or the switch', () => {
  const text = filesUnder(join(skillsRoot, 'rdd-review')).map((f) => readFileSync(f, 'utf8')).join('\n')
  assert.doesNotMatch(text, /<base>\.\.<head>|consecutive ranges/)
  assert.match(text, /Review subject: <base>`/)
  assert.doesNotMatch(text, /odd-review|odd-assess|review_due|refuter|validator/)
})

test('the plugin ships no MCP servers', () => {
  assert.ok(!existsSync(join(pluginRoot, '.mcp.json')))
})

test('S5: odd-delegation handoff names the verifier and its strength', () => {
  const t = readFileSync(join(skillsRoot, 'odd-delegation/references/handoffs.md'), 'utf8')
  assert.match(t, /Verifier strength/)
  assert.match(t, /weak/i)
  assert.match(t, /stops after one step/)
})

test('A2: weak and missing verifiers are distinguished in the worker, handoff, and delegation docs', () => {
  for (const f of ['odd-delegation/references/handoffs.md', 'odd-delegation/SKILL.md', '../agents/odd-worker.md']) {
    const t = readFileSync(join(skillsRoot, f), 'utf8')
    assert.match(t, /ambiguous requirements or external side effects/, f)
    assert.match(t, /no verifier/i, f)
    assert.match(t, /what would make (it|the work) verifiable/, f)
    assert.match(t, /docs-only[^\n]*reviewed diff is the verifier/, f)
    assert.doesNotMatch(t, /weak \(none or ambiguous\)/, f)
  }
})

test('A3: odd-workflow Close reports without another verification loop and loops only during implementation', () => {
  const t = readFileSync(join(skillsRoot, 'odd-workflow/SKILL.md'), 'utf8')
  assert.match(t, /during implementation[^\n]*loop until it passes/i)
  assert.match(t, /\*\*Close\.\*\*[^\n]*reports[^\n]*never starts another verification loop/)
})

test('S5: odd-workflow Close names skipped or unverified checks', () => {
  const t = readFileSync(join(skillsRoot, 'odd-workflow/SKILL.md'), 'utf8')
  assert.match(t, /\*\*Close\.\*\*[^\n]*unverified/)
})

test('S5: odd-worker reviews its own diff before reporting', () => {
  const t = readFileSync(join(pluginRoot, 'agents/odd-worker.md'), 'utf8')
  assert.match(t, /review your own diff/)
  assert.match(t, /missing test/)
})
