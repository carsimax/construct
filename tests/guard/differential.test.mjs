// Differential test: the guard must give the same verdict as main 548b47d on every
// corpus command (deny stays deny, allow stays allow). Main's verdicts are recorded
// statically in differential-corpus.mjs; nothing shells out to git. Protected names are
// built at runtime from placeholders.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { scratchDir } from '../assess/helpers.mjs'
import { corpus } from './differential-corpus.mjs'

const SCRIPT = new URL('../../plugins/construct/hooks/scripts/secret-guard.mjs', import.meta.url).pathname
const home = scratchDir('guard-diff-home-')

const subst = (s) =>
  s.replaceAll('@E@', '.' + 'env').replaceAll('@S@', '~/.' + 'ssh').replaceAll('@K@', 'server.' + 'key').replaceAll('@R@', 'rm' + ' -rf')

function verdict(command) {
  const p = spawnSync('node', [SCRIPT], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: home }),
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  })
  assert.equal(p.status, 0, p.stderr)
  return p.stdout.includes('"deny"') ? 'DENY' : 'allow'
}

test('every corpus command gets the verdict main 548b47d recorded', () => {
  assert.ok(corpus.length > 100)
  const diffs = []
  for (const [id, raw, main] of corpus) {
    const got = verdict(subst(raw))
    if (got !== main) diffs.push(`${id}: main ${main}, candidate ${got}`)
  }
  assert.deepEqual(diffs, [])
})

test('the L29 final-verify bypass shapes are in the corpus and denied as on main', () => {
  for (const id of ['l29-q1', 'l29-q2', 'l29-q3', 'l29-q4', 'l29-crlf', 'l29-param', 'l29-shell', 'l29-stdbuf', 'l29-while']) {
    const [, raw, main] = corpus.find((r) => r[0] === id)
    assert.equal(main, 'DENY', id)
    assert.equal(verdict(subst(raw)), 'DENY', id)
  }
})
