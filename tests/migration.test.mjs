// Executes the cleanup commands from docs/MIGRATION.md against fixture copies, so
// the guide cannot drift from what the commands actually do.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { scratchDir } from './assess/helpers.mjs'

const repoRoot = new URL('../', import.meta.url).pathname
const guide = readFileSync(join(repoRoot, 'docs/MIGRATION.md'), 'utf8')

// The first shell line of the fenced block that contains `marker`, with
// continuation lines joined and the ~/.claude paths pointed at `dir`.
function command(marker, dir) {
  const block = guide.split('```bash').map((b) => b.split('```')[0]).find((b) => b.includes(marker))
  assert.ok(block, `no bash block contains ${marker}`)
  const first = block.split('\n').filter(Boolean).join('\n').split(/\n(?!\s)/)[0]
  return first.replace(/\\\n\s*/g, ' ').replaceAll('~/.claude/', `${dir}/`)
}

const sh = (script) => spawnSync('bash', ['-c', script], { encoding: 'utf8' })

test('the CLAUDE.md command removes every managed block and keeps user content', () => {
  const dir = scratchDir('odd-migration-')
  writeFileSync(join(dir, 'CLAUDE.md'), [
    '<!-- gentle-ai:persona -->', '## Rules', 'x', '<!-- /gentle-ai:persona -->', '',
    '# My own notes', 'keep me', '',
    '<!-- gentle-ai:agent-routing -->', 'routing',
    '<!-- gentle-ai:remote-authorization -->', 'nested', '<!-- /gentle-ai:remote-authorization -->',
    '<!-- /gentle-ai:agent-routing -->', '',
    '<!-- local:odd-model-routing (user-owned; note) -->', 'table', '<!-- /local:odd-model-routing -->', '',
  ].join('\n'))
  const result = sh(command('perl -0pe', dir))
  assert.equal(result.status, 0, result.stderr)
  const cleaned = readFileSync(join(dir, 'CLAUDE.md.new'), 'utf8')
  assert.equal(cleaned, '# My own notes\nkeep me\n\n')
})

test('the settings command removes only hooks whose command starts with gentle-ai', () => {
  const dir = scratchDir('odd-migration-')
  const settings = {
    permissions: { defaultMode: 'bypassPermissions' },
    statusLine: { type: 'command', command: '~/.claude/statusline.sh' },
    hooks: {
      SessionStart: [
        { matcher: 'startup', hooks: [{ type: 'command', command: 'bash herdr.sh session' }] },
        { matcher: 'startup|resume', hooks: [{ type: 'command', command: 'gentle-ai review stop-hook --agent claude-code' }] },
      ],
      Stop: [{ hooks: [{ type: 'command', command: 'gentle-ai telemetry runtime claude --json' }] }],
      UserPromptSubmit: [
        { hooks: [{ type: 'command', command: 'codegraph prompt-hook' }] },
        { hooks: [{ type: 'command', command: 'echo gentle-ai is a name' }, { type: 'command', command: 'gentle-ai skill-registry refresh' }] },
      ],
    },
  }
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings))
  const result = sh(command("jq '.hooks", dir))
  assert.equal(result.status, 0, result.stderr)
  const cleaned = JSON.parse(readFileSync(join(dir, 'settings.json.new'), 'utf8'))
  assert.deepEqual(cleaned.permissions, settings.permissions)
  assert.deepEqual(cleaned.statusLine, settings.statusLine)
  assert.deepEqual(Object.keys(cleaned.hooks).sort(), ['SessionStart', 'UserPromptSubmit'])
  assert.deepEqual(cleaned.hooks.SessionStart, [settings.hooks.SessionStart[0]])
  assert.deepEqual(cleaned.hooks.UserPromptSubmit.flatMap((e) => e.hooks.map((h) => h.command)), [
    'codegraph prompt-hook',
    'echo gentle-ai is a name',
  ])
})

test('every agent and skill the guide removes is shipped by the plugin', () => {
  const plugin = join(repoRoot, 'plugins/odd-skills')
  const agents = new Set(readdirSync(join(plugin, 'agents')).map((f) => f.replace(/\.md$/, '')))
  const skills = new Set(readdirSync(join(plugin, 'skills')))
  for (const agent of ['review-risk', 'review-readability', 'review-reliability', 'review-resilience', 'review-refuter', 'jd-judge-a', 'jd-judge-b', 'jd-fix-agent']) {
    assert.ok(guide.includes(agent.replace(/^review-/, '').replace(/^jd-/, '')), agent)
    assert.ok(agents.has(agent), `plugin ships ${agent}`)
  }
  const removed = guide.match(/~\/\.claude\/skills\/\{([^}]+)\}/)[1].split(',')
  for (const skill of removed.filter((s) => !['_shared', 'skill-registry'].includes(s))) {
    assert.ok(skills.has(skill), `plugin ships ${skill}`)
  }
  assert.doesNotMatch(guide, /rm[^\n]*skills\/synced/)
})
