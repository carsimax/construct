// T2 of odd/tasks/shell-parser.md: publication-gate and review-store-guard on the shell shapes that
// hid a command from the heuristic parser, and on the common idioms that must keep passing.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { applyFiles, commitAll, git, makeRepo, scratchDir } from '../helpers/repo.mjs'
import { allowIdioms, CAPTURE, dataShapes, denyShapes, PUSH, unparseable } from './shell-parser-cases.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const GATE = join(PLUGIN, 'hooks/scripts/publication-gate.mjs')
const STORE_GUARD = join(PLUGIN, 'hooks/scripts/review-store-guard.mjs')
const table = (risk) => `# F\n\n## Tasks\n\n| ID | Specs | Task | Route | Risk | Status | Commit |\n|---|---|---|---|---|---|---|\n| T1 | S1 | w | worker | ${risk} | done | \`abc\` |\n\n## Log\n\n- 1 | none | x\n`

// A branch whose feature document names Risk 2 and has no verdicts: any publication is denied.
function repoWith(risk) {
  const repo = makeRepo({ 'src/app.js': 'a\n' })
  git(repo, 'checkout', '-q', '-b', 'feat')
  applyFiles(repo, { 'odd/tasks/f.md': table(risk), 'src/app.js': 'b\n' })
  commitAll(repo, 'unit')
  return repo
}
const risky = repoWith('2')
const calm = repoWith('none')

function out(script, command, cwd, env = {}) {
  const r = spawnSync('node', [script], { encoding: 'utf8', input: JSON.stringify({ session_id: 's1', cwd, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }), env: { ...process.env, CLAUDE_PLUGIN_DATA: scratchDir('odd-sp-data-'), XDG_CONFIG_HOME: scratchDir('odd-sp-xdg-'), ...env } })
  const json = r.stdout ? JSON.parse(r.stdout) : null
  return { status: r.status, stdout: r.stdout, decision: json?.hookSpecificOutput?.permissionDecision, reason: json?.hookSpecificOutput?.permissionDecisionReason }
}

describe('publication-gate denies a hidden publication', () => {
  const [plain, spelled] = PUSH
  for (const command of denyShapes(plain, spelled)) {
    test(JSON.stringify(command), () => {
      const r = out(GATE, command, risky)
      assert.equal(r.status, 0)
      assert.equal(r.decision, 'deny', r.stdout)
      // Two shapes (`echo esac)` as a case body and `esac` as a pattern) are syntax errors in bash and
      // zsh, so they are denied as unparseable instead of by the review state.
      assert.match(r.reason, /publication-gate: .*(review-risk|could not be parsed)/)
    })
  }
})

describe('publication-gate lets the common idioms pass', () => {
  for (const command of allowIdioms) {
    test(JSON.stringify(command), () => {
      const r = out(GATE, command, calm)
      assert.equal(r.status, 0)
      // The pr create idiom is a publication: it passes because the branch names no Risk item.
      assert.equal(r.stdout, '')
    })
  }
  test('the same pr create is denied on a risky branch, so the idiom is parsed, not skipped', () => {
    const r = out(GATE, allowIdioms[1], risky)
    assert.equal(r.decision, 'deny', r.stdout)
  })
})

describe('publication-gate lets a command that is only text pass', () => {
  for (const command of dataShapes(PUSH[0])) {
    test(JSON.stringify(command), () => {
      const r = out(GATE, command, risky)
      assert.equal(r.stdout, '')
    })
  }
})

describe('publication-gate denies what it cannot parse', () => {
  for (const command of unparseable) {
    test(JSON.stringify(command), () => {
      const r = out(GATE, command, calm)
      assert.equal(r.status, 0)
      assert.equal(r.decision, 'deny', r.stdout)
      assert.match(r.reason, /publication-gate: .*could not be parsed/)
    })
  }
})

describe('review-store-guard lets a command that is only text pass', () => {
  for (const command of dataShapes(CAPTURE[0].replace('node ', 'cat '))) {
    test(JSON.stringify(command), () => assert.equal(out(STORE_GUARD, command, calm).stdout, ''))
  }
})

describe('review-store-guard denies a hidden review hook run', () => {
  const [plain, spelled] = CAPTURE
  for (const command of denyShapes(plain, spelled)) {
    test(JSON.stringify(command), () => {
      const r = out(STORE_GUARD, command, calm)
      assert.equal(r.status, 0)
      assert.equal(r.decision, 'deny', r.stdout)
      assert.match(r.reason, /review-store-guard/)
    })
  }
  for (const command of allowIdioms) {
    test(`allows ${JSON.stringify(command)}`, () => {
      const r = out(STORE_GUARD, command, calm)
      assert.equal(r.status, 0)
      assert.equal(r.stdout, '')
    })
  }
  for (const command of unparseable) {
    test(`denies the unparseable ${JSON.stringify(command)}`, () => {
      const r = out(STORE_GUARD, command, calm)
      assert.equal(r.decision, 'deny', r.stdout)
      assert.match(r.reason, /review-store-guard: .*could not be parsed/)
    })
  }
})
