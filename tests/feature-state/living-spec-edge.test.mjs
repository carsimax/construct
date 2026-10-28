// Edge cases of .vault/tasks/living-spec.md found by running the hooks on this repository (T4).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { makeRepo } from '../helpers/repo.mjs'

const HOOK = new URL('../../plugins/construct/hooks/scripts/feature-state.mjs', import.meta.url).pathname
const TABLE = (status) => `## Tasks\n\n| ID | Specs | Task | Route | Risk | Status | Commit |\n|---|---|---|---|---|---|---|\n| T1 | S1 | work | worker | none | ${status} | - |\n`
const doc = (spec, status, l1) => `# F\n\nObjective: x.\n\n## Specs\n\n- **S1 — One.** "do it" ${spec}\n\n${TABLE(status)}\n## Log\n\n- **L1 (${l1}):** "do it"\n`
const context = (repo) => {
  const out = spawnSync('node', [HOOK], { input: JSON.stringify({ cwd: repo, hook_event_name: 'SessionStart' }), encoding: 'utf8' }).stdout
  return out ? JSON.parse(out).hookSpecificOutput.additionalContext : ''
}

test('a marker quoted as inline code describes the marker and is not an open clarification', () => {
  const repo = makeRepo({ '.vault/tasks/f.md': doc('An `S#` may carry `NEEDS CLARIFICATION: <question>`.', 'pending', '2026-10-30') })
  assert.doesNotMatch(context(repo), /Open clarification/)
  const open = makeRepo({ '.vault/tasks/f.md': doc('NEEDS CLARIFICATION: which port?', 'pending', '2026-10-30') })
  assert.match(context(open), /Open clarification S1: which port\?/)
})

test('an L1 date followed by more text in the parentheses still counts, and a document without an L1 date is skipped', () => {
  const spec = '# Living spec\nStarted: 2026-10-29\n'
  const old = makeRepo({ '.vault/specs/README.md': spec, '.vault/tasks/f.md': doc('', 'done', '2026-10-22, user') })
  assert.doesNotMatch(context(old), /Living spec: f /)
  const fresh = makeRepo({ '.vault/specs/README.md': spec, '.vault/tasks/f.md': doc('', 'done', '2026-10-30, user') })
  assert.match(context(fresh), /Living spec: f /)
  const undated = makeRepo({ '.vault/specs/README.md': spec, '.vault/tasks/f.md': doc('', 'done', 'no date') })
  assert.doesNotMatch(context(undated), /Living spec: f /)
})

test('S1: a repository with only odd/tasks gets no feature state, and a finished document with .vault/specs/<feature>.md is not warned', () => {
  assert.equal(context(makeRepo({ 'odd/tasks/f.md': doc('', 'pending', '2026-10-30') })), '')
  const spec = '# Living spec\nStarted: 2026-10-29\n'
  const has = makeRepo({ '.vault/specs/README.md': spec, '.vault/specs/f.md': '# f\n', '.vault/tasks/f.md': doc('', 'done', '2026-10-30') })
  assert.doesNotMatch(context(has), /Living spec: f /)
})

test('a finished README.md document is warned about even though .vault/specs/README.md exists', () => {
  const spec = '# Living spec\nStarted: 2026-10-29\n'
  const repo = makeRepo({ '.vault/specs/README.md': spec, '.vault/tasks/README.md': doc('', 'done', '2026-10-30') })
  assert.match(context(repo), /Living spec: README is finished but \.vault\/specs\/README\.feature\.md is missing/)
  const has = makeRepo({ '.vault/specs/README.md': spec, '.vault/specs/README.feature.md': '# r\n', '.vault/tasks/README.md': doc('', 'done', '2026-10-30') })
  assert.doesNotMatch(context(has), /Living spec: README /)
})
