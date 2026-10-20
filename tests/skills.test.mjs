import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const pluginRoot = new URL('../plugins/odd-skills/', import.meta.url).pathname
const skillsRoot = join(pluginRoot, 'skills')

const EXPECTED = [
  'branch-pr',
  'chained-pr',
  'codegraph',
  'cognitive-doc-design',
  'comment-writer',
  'go-testing',
  'judgment-day',
  'lossless-prompts',
  'odd-delegation',
  'odd-workflow',
  'rdd-review',
  'skill-creator',
  'skill-improver',
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
    assert.match(text, new RegExp(`odd-skills:${agent}`), agent)
    assert.doesNotMatch(text, new RegExp(`\`${agent}\``), `bare ${agent}`)
  }
})

test('the MIT notice for the ported material ships with the plugin', () => {
  const notice = readFileSync(join(pluginRoot, 'NOTICE'), 'utf8')
  assert.match(notice, /MIT License/)
  assert.match(notice, /Copyright \(c\) 2025 Gentleman Programming/)
})

test('every odd-review command and CLI flag named in rdd-review exists in the CLI implementations', () => {
  const reviewCli = readFileSync(join(pluginRoot, 'lib/review/cli.mjs'), 'utf8')
  const assessCli = readFileSync(join(pluginRoot, 'lib/assess/cli.mjs'), 'utf8')
  const commandBlock = reviewCli.match(/const ACCEPTS = \{([\s\S]*?)\n\}/)?.[1] ?? ''
  const commands = new Set([...commandBlock.matchAll(/^\s*'?([a-z-]+)'?:/gm)].map((m) => m[1]))
  const flags = (src) => new Set([...src.matchAll(/^\s*'?([a-z-]+)'?: \{ type:/gm)].map((m) => m[1]))
  const known = new Set([...flags(reviewCli), ...flags(assessCli)])
  const text = filesUnder(join(skillsRoot, 'rdd-review')).map((f) => readFileSync(f, 'utf8')).join('\n')
  const used = [...text.matchAll(/odd-review ([a-z][a-z-]*)/g)].map((m) => m[1])
  assert.ok(used.length > 5, 'the skill names odd-review commands')
  for (const name of new Set(used)) assert.ok(commands.has(name), `odd-review ${name} is not implemented in lib/review/cli.mjs`)
  const usedFlags = [...text.matchAll(/(?<![\w-])--([a-z][a-z-]*)/g)].map((m) => m[1])
  assert.ok(usedFlags.length > 5, 'the skill names flags')
  for (const flag of new Set(usedFlags)) assert.ok(known.has(flag), `--${flag} is not implemented`)
})

test('rdd-review covers the working-tree candidate, the root boundary rule, and the correction budget', () => {
  const text = filesUnder(join(skillsRoot, 'rdd-review')).map((f) => readFileSync(f, 'utf8')).join('\n')
  const lines = text.split('\n')
  assert.ok(lines.some((l) => /odd-review start/.test(l) && !/--base-ref/.test(l)), 'working-tree odd-review start')
  assert.ok(lines.some((l) => /odd-assess --json/.test(l) && !/--base-ref/.test(l)), 'working-tree odd-assess --json')
  assert.match(text, /`root`/)
  assert.match(text, /correction_budget_exceeded/)
  assert.doesNotMatch(text, /`next` is `/)
})

test('the codegraph skill uses the upstream CLI and the user-scope MCP tool, never a plugin MCP server', () => {
  const text = readFileSync(join(skillsRoot, 'codegraph', 'SKILL.md'), 'utf8')
  assert.match(text, /codegraph init/)
  assert.match(text, /codegraph sync/)
  assert.match(text, /mcp__codegraph__codegraph_explore/)
  assert.match(text, /claude mcp add --scope user codegraph -- codegraph serve --mcp/)
  assert.doesNotMatch(text, /mcp__plugin_odd-skills_codegraph/)
  assert.ok(!existsSync(join(pluginRoot, '.mcp.json')), 'option A: the plugin ships no MCP servers')
})
