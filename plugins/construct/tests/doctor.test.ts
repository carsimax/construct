import { expect, test } from 'claude-code/testing'
import { checkClaude, checkCodegraph, checkMemory, checkNode, formatReport } from '../hooks/status/doctor.js'

// Pure checks behind /construct doctor (S8).

test('Claude Code needs 2.1.304 or later', () => {
  expect(checkClaude('2.1.303').ok).toBe(false)
  expect(checkClaude('2.1.304').ok).toBe(true)
  expect(checkClaude('2.1.304-dev.20260920.t1.sha1a2b3c4').ok).toBe(true)
  expect(checkClaude('2.2.0 (Claude Code)').ok).toBe(true)
  expect(checkClaude('2.0.999').ok).toBe(false)
  expect(checkClaude('3.0.0').ok).toBe(true)
})

test('Claude Code with no output or junk fails with a hint', () => {
  for (const v of [null, '', 'nope']) {
    const row = checkClaude(v)
    expect(row.ok).toBe(false)
    expect(row.hint).toContain('2.1.304')
  }
})

test('Node needs 22.16 or later', () => {
  expect(checkNode('v22.15.9').ok).toBe(false)
  expect(checkNode('v22.9.0').ok).toBe(false)
  expect(checkNode('v22.16.0').ok).toBe(true)
  expect(checkNode('v22.22.1\n').ok).toBe(true)
  expect(checkNode('v24.0.0').ok).toBe(true)
  expect(checkNode('v20.11.0').ok).toBe(false)
  expect(checkNode(null).ok).toBe(false)
  expect(checkNode('v22.1.0').label).toContain('22.16')
})

test('memory needs node:sqlite with FTS5 trigram, probed through node', () => {
  expect(checkMemory('ok\n').ok).toBe(true)
  for (const out of [null, '', 'nope']) {
    const row = checkMemory(out)
    expect(row.ok).toBe(false)
    expect(row.hint).toContain('Node 22.16+')
    expect(row.hint).not.toContain('23')
  }
})

test('the CodeGraph index must exist', () => {
  expect(checkCodegraph(true).ok).toBe(true)
  expect(checkCodegraph(false).ok).toBe(false)
  expect(checkCodegraph(null).ok).toBe(false)
})

test('the report has one line per check', () => {
  const text = formatReport([
    { ok: true, label: 'fine', hint: 'unused' },
    { ok: false, label: 'broken', hint: 'fix it' },
  ])
  expect(text.split('\n')).toEqual(['Construct doctor', '✓ fine', '✗ broken — fix it'])
})
