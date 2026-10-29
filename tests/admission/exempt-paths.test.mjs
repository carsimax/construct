// S3 of .vault/tasks/autonomy.md: `.vault/exempt-paths` at the default-branch tip lets delegation-admission write the envelope of a
// worker task whose code surfaces are all allowlisted.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { commitAll, git, makeRepo, scratchDir, write } from '../helpers/repo.mjs'
import { readEnvelope } from '../../plugins/construct/hooks/scripts/review-store.mjs'

const SCRIPT = new URL('../../plugins/construct/hooks/scripts/delegation-admission.mjs', import.meta.url).pathname
const FEATURE = '# F\n\n## Tasks\n\n| ID | Specs | Task | Route | Risk | Status | Commit |\n|---|---|---|---|---|---|---|\n| T1 | S1 | Do it | w | none | pending | - |\n\n## Log\n'
const prompt = (...paths) => `Spec: .vault/tasks/feat.md, T1\n\n## Allowed edit surfaces\n${paths.join('\n')}\n\n## Verification\n- x\n`

const repoWith = (exempt) => {
  const files = { '.vault/tasks/feat.md': FEATURE }
  if (exempt !== undefined) files['.vault/exempt-paths'] = exempt
  return makeRepo(files)
}
const launch = (repo, text) => {
  const r = spawnSync('node', [SCRIPT], {
    input: JSON.stringify({ session_id: 's1', cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'construct:worker', prompt: text, description: 'u' } }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_DATA: scratchDir('exempt-data-') },
  })
  return { status: r.status, json: r.stdout ? JSON.parse(r.stdout) : null }
}
const reason = (r) => r.json?.hookSpecificOutput?.permissionDecisionReason ?? ''
const envelope = (repo) => readEnvelope(repo, '.vault/tasks/feat.md', 'T1')

describe('exempt-paths allowlist', () => {
  test('matching surfaces get an allowlist envelope with the joined, deduplicated commands and the worker surfaces', () => {
    const repo = repoWith('# comment\n\nscripts/** -- bash scripts/check.sh\ninstall.sh -- bash -n install.sh\nscripts/x.sh -- bash scripts/check.sh\n')
    const r = launch(repo, prompt('scripts/a.sh', 'install.sh', 'docs/a.md'))
    assert.equal(r.json, null)
    const e = envelope(repo)
    assert.equal(e.command, 'bash -n install.sh && bash scripts/check.sh')
    assert.deepEqual(e.surfaces, ['docs/a.md', 'install.sh', 'scripts/a.sh'])
    assert.equal(e.source, 'allowlist')
    assert.deepEqual([e.attempts, e.minutes, e.lines], [5, 30, 400])
  })
  test('a surface that matches no entry keeps the oracle rule and writes no envelope', () => {
    const repo = repoWith('scripts/** -- true\n')
    assert.match(reason(launch(repo, prompt('scripts/a.sh', 'lib/b.js'))), /construct:oracle/)
    assert.equal(envelope(repo), null)
  })
  test('a malformed line denies, naming the file and line', () => {
    for (const bad of ['scripts/**\n', 'scripts/** --\n', ' -- true\n', 'scripts/** --   \n']) {
      const r = launch(repoWith(`# ok\n${bad}`), prompt('scripts/a.sh'))
      assert.match(reason(r), /\.vault\/exempt-paths/)
      assert.match(reason(r), /line 2/)
    }
  })
  test('an edit only in the working tree has no effect, and neither does a non-default branch', () => {
    const repo = repoWith('docs/** -- true\n')
    write(repo, '.vault/exempt-paths', 'scripts/** -- true\n')
    assert.match(reason(launch(repo, prompt('scripts/a.sh'))), /construct:oracle/)
    git(repo, 'switch', '-q', '-c', 'topic')
    commitAll(repo, 'allow')
    assert.match(reason(launch(repo, prompt('scripts/a.sh'))), /construct:oracle/)
    assert.equal(envelope(repo), null)
  })
  test('no default branch resolvable: no allowlist', () => {
    const repo = repoWith('scripts/** -- true\n')
    git(repo, 'branch', '-m', 'trunk')
    assert.match(reason(launch(repo, prompt('scripts/a.sh'))), /construct:oracle/)
  })
  test('an existing envelope is left alone', () => {
    const repo = repoWith('scripts/** -- true\n')
    assert.equal(launch(repo, prompt('scripts/a.sh')).json, null)
    const before = join(repo, '.git/construct-review/envelopes')
    assert.ok(before)
    assert.equal(launch(repo, prompt('scripts/a.sh', 'scripts/b.sh')).json?.hookSpecificOutput?.permissionDecision, 'deny')
  })
})
