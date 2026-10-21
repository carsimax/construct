import { expect, test } from 'claude-code/testing'
import { checkClaude, checkCodegraph, checkEngram, checkNode, formatReport } from '../hooks/status/doctor.js'

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

test('Node needs 20 or later', () => {
  expect(checkNode('v19.9.0').ok).toBe(false)
  expect(checkNode('v20.0.0').ok).toBe(true)
  expect(checkNode('v22.1.0\n').ok).toBe(true)
  expect(checkNode(null).ok).toBe(false)
})

test('engram must be enabled', () => {
  expect(checkEngram({ 'engram@engram': true }).ok).toBe(true)
  expect(checkEngram({ 'engram@engram': false }).ok).toBe(false)
  expect(checkEngram({ 'other@x': true }).ok).toBe(false)
  expect(checkEngram(undefined).ok).toBe(false)
  expect(checkEngram(null).ok).toBe(false)
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
