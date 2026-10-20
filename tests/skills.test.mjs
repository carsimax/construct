import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const pluginRoot = new URL('../plugins/odd-skills/', import.meta.url).pathname
const skillsRoot = join(pluginRoot, 'skills')

const EXPECTED = [
  'branch-pr',
  'chained-pr',
  'cognitive-doc-design',
  'comment-writer',
  'go-testing',
  'judgment-day',
  'skill-creator',
  'skill-improver',
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

test('the plugin ships exactly the T3 skills', () => {
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
