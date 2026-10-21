// S10: the handoff templates carry every field delegation-admission.mjs enforces.
// The templates are filled with placeholder values and sent through the real hook, so a
// requirement added to the hook (or dropped from a template) fails here.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { makeRepo, scratchDir, write } from '../helpers/repo.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const HOOK = join(PLUGIN, 'hooks/scripts/delegation-admission.mjs')
const read = (path) => readFileSync(join(PLUGIN, path), 'utf8')
const HANDOFFS = read('skills/odd-delegation/references/handoffs.md')

// The fenced block under a `## <name>` heading of handoffs.md.
function template(name) {
  const start = HANDOFFS.indexOf(`\n## ${name}\n`)
  assert.ok(start >= 0, `handoffs.md has a "## ${name}" section`)
  const block = HANDOFFS.slice(start).match(/```markdown\n([\s\S]*?)```/)
  assert.ok(block, `"## ${name}" holds a markdown template`)
  return block[1]
}

function launch(type, prompt) {
  const repo = makeRepo({ 'src/a.js': 'a\n' })
  write(repo, 'odd/tasks/feat.md', '# F\n\n## Tasks\n\n| ID | Specs | Task | Route | Risk | Status | Commit |\n|---|---|---|---|---|---|---|\n| T1 | S1 | Do | w | none | pending | - |\n\n## Log\n')
  const input = { session_id: 's', cwd: repo, tool_name: 'Agent', tool_input: { subagent_type: type, prompt } }
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_DATA: scratchDir('odd-tpl-') } })
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason : ''
}

describe('handoff templates vs delegation-admission', () => {
  test('worker template is admitted by the hook once placeholders are filled', () => {
    // hook: Spec line (SPEC_LINE, namesFeatureDocument) and surfaces (parseSurfaces).
    const prompt = template('Worker').replace('<feature>', 'feat').replace('<n>', '1')
    assert.equal(launch('construct:odd-worker', prompt), '')
    assert.equal(launch('construct:jd-fix-agent', prompt), '')
  })

  test('worker template names the Spec and surfaces forms literally', () => {
    const worker = template('Worker')
    assert.match(worker, /^Spec: odd\/tasks\/<feature>\.md, T<n>/m)
    assert.match(worker, /^## Allowed edit surfaces$/m)
  })

  test('verifier template carries the Risk line the hook requires', () => {
    // hook: RISK_LINE, `Risk: item N` with N 1-6.
    const verifier = template('Verifier')
    assert.match(verifier, /^Risk: item N \(/m)
    assert.equal(launch('construct:odd-verify', verifier.replace('item N', 'item 3')), '')
    assert.match(launch('construct:odd-verify', verifier.replace(/^Risk:.*\n/m, '')), /Risk: item N/)
  })

  test('the odd-delegation skill and the session contract name the forms', () => {
    const skill = read('skills/odd-delegation/SKILL.md')
    const contract = read('hooks/contract/session.md')
    for (const text of [skill, contract]) {
      assert.match(text, /Spec: odd\/tasks\/<f(?:eature)?>\.md, T<n>/)
      assert.match(text, /## Allowed edit surfaces/)
      assert.match(text, /Risk: item N/)
    }
    assert.match(skill, /one bare|bare path/i)
  })
})
