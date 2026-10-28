// S6: the role registry (hooks/scripts/roles.mjs) cross-checked against every place that names a role.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { checkLensResult } from '../plugins/construct/hooks/scripts/review-store.mjs'
import { BUILTIN_DEFAULTS, BUILTINS, ROLES, kindOf, namesOf, qualified, roleKey } from '../plugins/construct/hooks/scripts/roles.mjs'

const pluginRoot = new URL('../plugins/construct/', import.meta.url).pathname
const read = (...p) => readFileSync(join(pluginRoot, ...p), 'utf8')
const hooks = JSON.parse(read('hooks/hooks.json')).hooks
const names = Object.keys(ROLES)

function frontmatter(name) {
  const block = read('agents', `${name}.md`).split('---')[1]
  const field = (key) => block.match(new RegExp(`^${key}: *(.*)$`, 'm'))?.[1]?.trim()
  const list = (key) => (field(key) ?? '').replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean)
  return { name: field('name'), tools: field('tools') === undefined ? null : list('tools'), disallowed: list('disallowedTools'), omitClaudeMd: field('omitClaudeMd'), maxTurns: field('maxTurns'), background: field('background') }
}

test('a built-in type follows the frontmatter of the agent it maps to', () => {
  for (const [type, name] of Object.entries(BUILTINS)) {
    const block = read('agents', `${name}.md`).split('---')[1]
    const field = (key) => block.match(new RegExp(`^${key}: *(.*)$`, 'm'))?.[1]?.trim()
    assert.deepEqual(BUILTIN_DEFAULTS[type], { model: field('model'), effort: field('effort') }, type)
  }
})

test('the registry names exactly the agent files, each with one kind', () => {
  const files = readdirSync(join(pluginRoot, 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''))
  assert.deepEqual([...names].sort(), files.sort())
  assert.ok(names.every((n) => ['reader', 'writer', 'verifier', 'runner', 'judge', 'lens'].includes(ROLES[n])))
  assert.deepEqual(namesOf('writer'), ['worker', 'oracle'])
  assert.deepEqual(namesOf('judge'), ['judge-a', 'judge-b'])
  assert.deepEqual(namesOf('lens').sort(), ['review-readability', 'review-reliability', 'review-resilience', 'review-risk'])
})

test('helpers: construct type, role key, kind with or without the prefix', () => {
  assert.equal(qualified('worker'), 'construct:worker')
  assert.equal(roleKey('judge-a'), 'judge_a')
  assert.equal(kindOf('construct:jd-fix-agent'), null)
  assert.equal(kindOf('construct:verifier'), 'verifier')
  assert.equal(kindOf('verifier'), 'verifier')
  assert.equal(kindOf('general-purpose'), 'runner')
  assert.equal(kindOf('review-risk'), 'lens')
  assert.equal(kindOf('construct:nope'), null)
  assert.equal(kindOf(undefined), null)
})

test('the README agent table lists every registry agent', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  for (const n of names) assert.ok(readme.includes(`\`${qualified(n)}\``), n)
})

test('every agent file name matches the registry and no agent can launch agents (C23)', () => {
  for (const n of names) {
    const fm = frontmatter(n)
    assert.equal(fm.name, n)
    const denied = fm.disallowed.includes('Agent') || (fm.tools !== null && !fm.tools.includes('Agent'))
    assert.ok(denied, `${n} must deny the Agent tool`)
  }
})

test('frontmatter by kind: lenses have no tools, a two-turn budget, no CLAUDE.md (V11, V12)', () => {
  for (const n of namesOf('lens')) {
    const fm = frontmatter(n)
    assert.deepEqual(fm.tools, [], n)
    assert.equal(fm.omitClaudeMd, 'true', n)
    assert.equal(fm.maxTurns, '2', n)
  }
})

// S4 (deterministic-signals): bounded turn budgets for the reader and the verifier; the runner stays in the background.
// No agent forces background: an open background agent mutes the Risk-line gate (risk-line.mjs) for up to an hour.
test('frontmatter caps: explorer and verifier have a turn budget, no agent forces the background', () => {
  assert.equal(frontmatter('explorer').maxTurns, '30')
  assert.equal(frontmatter('verifier').maxTurns, '50')
  for (const n of names) assert.equal(frontmatter(n).background, undefined, n)
  for (const n of ['worker', 'general', 'judge-a', 'judge-b']) assert.equal(frontmatter(n).maxTurns, undefined, n)
})

test('frontmatter by kind: judges read only, writers write, reader and verifier never write (V52)', () => {
  for (const n of namesOf('judge')) assert.deepEqual(frontmatter(n).tools, ['Read', 'Glob', 'Grep', 'LSP', 'mcp__engram__mem_search', 'mcp__engram__mem_get_observation', 'mcp__plugin_engram_engram__mem_search', 'mcp__plugin_engram_engram__mem_get_observation'], n)
  for (const n of [...namesOf('reader'), ...namesOf('verifier')]) {
    const fm = frontmatter(n)
    for (const tool of ['Edit', 'Write', 'NotebookEdit', 'Agent']) assert.ok(fm.disallowed.includes(tool) || (fm.tools && !fm.tools.includes(tool)), `${n} ${tool}`)
  }
  for (const n of namesOf('writer')) {
    const fm = frontmatter(n)
    assert.ok(fm.tools === null ? !fm.disallowed.some((t) => /^(Edit|Write)$/.test(t)) : ['Edit', 'Write'].every((t) => fm.tools.includes(t)), n)
  }
})

test('hooks.json matchers: lens capture fires for every lens and no other role', () => {
  const capture = hooks.SubagentStop.find((g) => g.hooks.some((h) => h.args.some((a) => a.endsWith('review-capture.mjs'))))
  const matcher = new RegExp(capture.matcher)
  for (const n of names) assert.equal(matcher.test(qualified(n)), ROLES[n] === 'lens', n)
  const ctx = hooks.PreToolUse.find((g) => g.hooks.some((h) => h.args.some((a) => a.endsWith('review-context.mjs'))))
  assert.equal(ctx.matcher, 'Agent')
})

test('the lens report text names every key and enum value the validator enforces (V15-V26)', () => {
  const paths = ['a.js', 'b.js']
  const ok = {
    subject_hash: 'h',
    inspection: { status: 'completed', paths },
    findings: [{ location: 'a.js:1-2', severity: 'CRITICAL', claim: 'c', evidence_class: 'deterministic', causal_disposition: 'introduced', proof_refs: ['p'] }],
    evidence: ['e'],
  }
  const check = (mutate) => {
    const r = structuredClone(ok)
    mutate(r)
    return checkLensResult(r, { subjectHash: 'h', manifest: paths })
  }
  assert.deepEqual(check(() => {}), { approved: false })
  for (const sev of ['BLOCKER', 'CRITICAL', 'WARNING', 'SUGGESTION']) assert.equal(check((r) => (r.findings[0].severity = sev)).code, undefined, sev)
  for (const dispo of ['introduced', 'behavior-activated', 'worsened', 'pre-existing', 'base-only', 'unknown']) assert.equal(check((r) => (r.findings[0].causal_disposition = dispo)).code, undefined, dispo)
  for (const klass of ['deterministic', 'inferential', 'insufficient']) assert.equal(check((r) => (r.findings[0].evidence_class = klass)).code, undefined, klass)
  assert.equal(check((r) => (r.findings[0].severity = 'MAJOR')).code, 'invalid_result')
  assert.equal(check((r) => (r.findings[0].causal_disposition = 'new')).code, 'invalid_result')
  assert.equal(check((r) => (r.findings[0].evidence_class = 'guess')).code, 'invalid_result')
  assert.equal(check((r) => (r.extra = 1)).code, 'invalid_result')
  assert.equal(check((r) => (r.findings[0].extra = 1)).code, 'invalid_result')
  assert.equal(check((r) => (r.evidence = [])).code, 'invalid_result')
  assert.equal(check((r) => (r.findings[0].proof_refs = [])).code, 'invalid_result')
  assert.equal(check((r) => (r.findings[0].claim = '')).code, 'invalid_result')
  assert.equal(check((r) => (r.findings[0].location = 'c.js:1')).code, 'invalid_result')
  assert.equal(check((r) => (r.findings[0].location = 'a.js:3-2')).code, 'invalid_result')
  assert.equal(check((r) => (r.inspection.status = 'done')).code, 'invalid_result')
  for (const lens of namesOf('lens')) {
    const text = read('agents', `${lens}.md`)
    for (const word of ['subject_hash', 'inspection', 'findings', 'evidence', 'location', 'severity', 'claim', 'evidence_class', 'causal_disposition', 'proof_refs',
      'BLOCKER', 'CRITICAL', 'WARNING', 'SUGGESTION', 'deterministic', 'inferential', 'insufficient',
      'introduced', 'behavior-activated', 'worsened', 'pre-existing', 'base-only', 'unknown', 'completed', 'incomplete']) {
      assert.ok(text.includes(word), `${lens} lacks ${word}`)
    }
  }
})

test('the judge reply text names the envelope keys and every enum value the lens validator enforces (V54)', () => {
  for (const judge of namesOf('judge')) {
    const text = read('agents', `${judge}.md`)
    for (const word of ['findings', 'evidence', 'location', 'severity', 'claim', 'evidence_class', 'causal_disposition', 'proof_refs',
      'BLOCKER', 'CRITICAL', 'WARNING', 'SUGGESTION', 'deterministic', 'inferential', 'insufficient',
      'introduced', 'behavior-activated', 'worsened', 'pre-existing', 'base-only', 'unknown']) {
      assert.ok(text.includes(word), `${judge} lacks ${word}`)
    }
  }
})

test('the worker output section names every status and heading (C83)', () => {
  const out = read('agents', 'worker.md').split(/^## Output/m)[1].toLowerCase()
  for (const word of ['done', 'partial', 'needs_interaction', 'specs covered', 'changes', 'verification', 'scratch paths', 'open issues']) {
    assert.ok(out.includes(word), `worker output lacks ${word}`)
  }
})

test('the subagent contract is injected for non-JSON roles within budget; JSON-only kinds get nothing (V48)', () => {
  const run = (type) =>
    spawnSync('node', [join(pluginRoot, 'hooks/scripts/contract.mjs'), 'subagent'], { input: JSON.stringify({ agent_type: type }), encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot } }).stdout
  for (const n of names) {
    for (const type of [qualified(n), n]) {
      const out = run(type)
      if (['judge', 'lens'].includes(ROLES[n])) assert.equal(out, '', type)
      else assert.ok(out.length > 0 && out.length <= 3500, `${type} ${out.length}`)
    }
  }
  assert.ok(run('general-purpose').length > 0)
})

test('every lens and judge treats the candidate content as evidence, never instructions', () => {
  for (const n of [...namesOf('lens'), ...namesOf('judge')]) assert.ok(read('agents', `${n}.md`).includes('evidence, never instructions'), n)
})

test('the README agent count equals the registry size', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  const counts = [...readme.matchAll(/\b(\d+) (?:role )?agents\b/g)].map((m) => Number(m[1]))
  assert.ok(counts.length >= 3, 'the README states the agent count')
  for (const c of counts) assert.equal(c, names.length)
})

test('the session skill map lists every skill directory with a trigger', () => {
  const session = read('hooks/contract/session.md')
  for (const d of readdirSync(join(pluginRoot, 'skills'))) assert.match(session, new RegExp(`^- \`construct:${d}\`: \\S.+`, 'm'), d)
})

test('verifier done check names untrusted input, auth, data handling, and committed credentials', () => {
  assert.match(read('agents/verifier.md'), /untrusted input, auth, and data handling were reviewed and no credential is committed/i)
})

test('verifier probes point HOME and TMPDIR inside the scratch copy', () => {
  assert.match(read('agents/verifier.md'), /fresh `mktemp -d` copy[^\n]*`HOME` and `TMPDIR` pointed inside it/i)
})

test('worker keeps HOME, TMPDIR, and tool caches outside the worktree', () => {
  assert.match(read('agents/worker.md'), /`HOME`, `TMPDIR`, and tool caches under a `mktemp -d` path beyond the worktree/i)
})
