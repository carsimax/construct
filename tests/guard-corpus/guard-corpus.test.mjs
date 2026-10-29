// S4 of .vault/tasks/measure.md: a deterministic corpus run through bash-guard.mjs with no model.
// legit.txt must pass, bypass.txt must be denied; known-gaps.txt (documented as uncaught) and known-false-denials.txt
// (legitimate commands denied on purpose) are only reported.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyFiles, commitAll, git, makeRepo } from '../helpers/repo.mjs'

const GUARD = new URL('../../plugins/construct/hooks/scripts/bash-guard.mjs', import.meta.url).pathname
const TABLE = '# Feature\n\n## Tasks\n\n| ID | Specs | Task | Route | Risk | Status | Commit |\n|---|---|---|---|---|---|---|\n| T1 | S1 | work | worker | 2 | open | |\n\n## Log\n\n- 1 | none | x\n'

// A repository on an unreviewed branch whose feature document has an unfinished Risk-2 task: a publication is denied.
const repo = makeRepo({ 'src/app.js': 'export const a = 1\n' })
git(repo, 'checkout', '-q', '-b', 'feat')
applyFiles(repo, { '.vault/tasks/f.md': TABLE, 'src/app.js': 'export const a = 2\n' })
commitAll(repo, 'unit')

const load = (name) => readFileSync(join(import.meta.dirname, name), 'utf8').split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#'))

// verdict runs one command as a main-thread PreToolUse Bash input; returns the denial reason or null.
function verdict(command) {
  const input = JSON.stringify({ cwd: repo, session_id: 'corpus', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } })
  const r = spawnSync('node', [GUARD], { input, encoding: 'utf8' })
  assert.equal(r.status, 0, `bash-guard exited ${r.status} on: ${command}\n${r.stderr}`)
  if (r.stdout === '') return null
  return JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason
}

const legit = load('legit.txt')
const bypass = load('bypass.txt')
const gaps = load('known-gaps.txt')
const knownDenials = load('known-false-denials.txt')

test('corpus sizes', () => {
  assert.ok(legit.length >= 40, `legit has ${legit.length}, need 40`)
  assert.ok(bypass.length >= 40, `bypass has ${bypass.length}, need 40`)
})

test('every legit command passes and every bypass is denied', () => {
  const falseDenials = legit.flatMap((c) => {
    const r = verdict(c)
    return r ? [`  ${c}\n    -> ${r.slice(0, 160)}`] : []
  })
  const misses = bypass.filter((c) => verdict(c) === null).map((c) => `  ${c}`)
  assert.ok(
    falseDenials.length === 0 && misses.length === 0,
    `${falseDenials.length} false denial(s) of ${legit.length} legit, ${misses.length} miss(es) of ${bypass.length} bypasses\n` +
      `false denials:\n${falseDenials.join('\n') || '  none'}\nmisses:\n${misses.join('\n') || '  none'}`,
  )
})

test('known gaps are reported, not enforced', (t) => {
  const open = gaps.filter((c) => verdict(c) === null)
  const caught = gaps.filter((c) => !open.includes(c))
  t.diagnostic(`known gaps: ${open.length} of ${gaps.length} uncaught${caught.length ? `; now caught: ${caught.join(' | ')}` : ''}`)
})

test('known false denials are reported, not enforced', (t) => {
  const still = knownDenials.filter((c) => verdict(c) !== null)
  t.diagnostic(`known false denials: ${still.length} of ${knownDenials.length} still denied`)
})
