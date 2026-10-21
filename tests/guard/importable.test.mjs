// T7(d): secret-guard.mjs is importable (main runs only when executed directly) and exports the tokenizer.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

const SCRIPT = new URL('../../plugins/construct/hooks/scripts/secret-guard.mjs', import.meta.url).pathname
const SHELL_WORDS = new URL('../../plugins/construct/hooks/scripts/shell-words.mjs', import.meta.url).pathname

test('importing secret-guard reads no stdin, prints nothing, and exposes splitCommands', () => {
  const code = `const m = await import(${JSON.stringify(SCRIPT)}); console.log(JSON.stringify(m.splitCommands('a "b c" | d').map((w) => w.map((x) => x.t))))`
  const r = spawnSync('node', ['--input-type=module', '-e', code], { encoding: 'utf8', input: '', timeout: 10_000 })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout.trim(), '[["a","b c"],["d"]]')
  assert.equal(r.stderr, '')
})

test('the tokenizer lives in shell-words.mjs and secret-guard re-exports the same function', async () => {
  const words = await import(SHELL_WORDS)
  const guard = await import(SCRIPT)
  assert.equal(guard.splitCommands, words.splitCommands)
})

test('executed directly it still guards', () => {
  const r = spawnSync('node', [SCRIPT], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rm -rf /' }, cwd: '/' }), encoding: 'utf8' })
  assert.match(r.stdout, /"permissionDecision":"deny"/)
})
