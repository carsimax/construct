// Living spec (.vault/tasks/living-spec.md), S1-S5: the clarification state blocks publication,
// feature-state.mjs shows open clarifications, unquoted specs, and finished features with no .vault/specs/<feature>.md.
// S1 drives the real publication gate as a PreToolUse hook on Bash; S2-S5 drive the real
// feature-state SessionStart hook with stdin JSON. Wording is the implementation's: tests match stable parts.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { applyFiles, commitAll, git, makeRepo, scratchDir, write } from '../helpers/repo.mjs'
import { subjectHash, writeVerdict } from '../../plugins/construct/hooks/scripts/review-store.mjs'

const SCRIPTS = new URL('../../plugins/construct/hooks/scripts/', import.meta.url).pathname
const GATE = join(SCRIPTS, 'publication-gate.mjs')
const FEATURE_STATE = join(SCRIPTS, 'feature-state.mjs')

const QUESTION = 'Which region hosts the bucket?'

// featureDoc renders a feature document. specs: bullet bodies; rows: [id, specs cell, risk, status]; log: Log lines.
function featureDoc({ title = 'Feature', specs, rows, log }) {
  const table = rows.map(([id, cell, risk, status]) => `| ${id} | ${cell} | work ${id} | worker | ${risk} | ${status} | — |`).join('\n')
  return `# ${title}\n\nObjective: x. Branch: feat/x. Baseline: abc.\n\n## Specs\n\n${specs.map((s) => `- ${s}`).join('\n')}\n\n## Tasks\n\n| ID | Specs | Task | Route | Risk | Status | Commit |\n|---|---|---|---|---|---|---|\n${table}\n\n## Log\n\n${log.map((l) => `- ${l}`).join('\n')}\n`
}

// ---------------------------------------------------------------- S1: the publication gate

const gateEnv = () => ({ CLAUDE_PLUGIN_DATA: scratchDir('ls-pub-data-'), XDG_CONFIG_HOME: scratchDir('ls-pub-xdg-') })

function gate(command, cwd, env = gateEnv()) {
  const r = spawnSync('node', [GATE], {
    input: JSON.stringify({ session_id: 's1', cwd, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  let json = null
  try {
    json = JSON.parse(r.stdout)
  } catch {
    // No output: the gate allows.
  }
  return { status: r.status, stdout: r.stdout, decision: json?.hookSpecificOutput?.permissionDecision, reason: json?.hookSpecificOutput?.permissionDecisionReason ?? '' }
}

const silent = (r) => {
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
}

// clarificationDenied: denied, naming the doc, the task, the S#, the question, and the way out.
function clarificationDenied(r, { task = 'T1', spec = 'S2', question = QUESTION } = {}) {
  assert.equal(r.status, 0)
  assert.equal(r.decision, 'deny', r.stdout)
  assert.ok(r.reason.includes('.vault/tasks/f.md'), r.reason)
  assert.match(r.reason, new RegExp(`\\b${task}\\b`))
  assert.match(r.reason, new RegExp(`\\b${spec}\\b`))
  assert.ok(r.reason.includes(question), r.reason)
  assert.match(r.reason, /\bask\b/i)
  assert.match(r.reason, /\bLog\b/)
}

const S1_SPEC = '**S1 — Store.** "keep the cache" in the store.'
const S2_MARKED = `**S2 — Region.** "pick a region" for the bucket. NEEDS CLARIFICATION: ${QUESTION}`
const S2_CLEAR = '**S2 — Region.** "pick a region" for the bucket: eu-west-1.'
const LOG = ['**L1 (2026-10-01):** "keep the cache" and "pick a region"']

// gateRepo: main holds the base commit; branch feat commits the feature document .vault/tasks/f.md.
function gateRepo(doc) {
  const repo = makeRepo({ 'src/app.js': 'export const a = 1\n' })
  git(repo, 'checkout', '-q', '-b', 'feat')
  applyFiles(repo, { '.vault/tasks/f.md': doc, 'src/app.js': 'export const a = 2\n' })
  commitAll(repo, 'unit')
  return repo
}

describe('S1: an open clarification on a done task blocks publication', () => {
  test('a done task naming a marked S# is denied, naming doc, task, S#, question, ask the user, and the Log', () => {
    const repo = gateRepo(featureDoc({ specs: [S1_SPEC, S2_MARKED], rows: [['T1', 'S1, S2', 'none', 'done']], log: LOG }))
    clarificationDenied(gate('git push', repo))
  })

  test('the deny names the task whose Specs cell carries the marked S#', () => {
    const repo = gateRepo(featureDoc({ specs: [S1_SPEC, S2_MARKED], rows: [['T1', 'S1', 'none', 'done'], ['T2', 'S2', 'none', 'done']], log: LOG }))
    const r = gate('git push', repo)
    clarificationDenied(r, { task: 'T2' })
  })

  test('clarified specs and pending tasks on a marked spec publish as before', () => {
    // Control: the marked spec on a done task denies.
    clarificationDenied(gate('git push', gateRepo(featureDoc({ specs: [S1_SPEC, S2_MARKED], rows: [['T1', 'S1', 'none', 'done'], ['T2', 'S2', 'none', 'done']], log: LOG }))), { task: 'T2' })
    // A done task naming only clarified specs, while the marked spec's task is still pending.
    silent(gate('git push', gateRepo(featureDoc({ specs: [S1_SPEC, S2_MARKED], rows: [['T1', 'S1', 'none', 'done'], ['T2', 'S2', 'none', 'pending']], log: LOG }))))
    // The marker is gone: the done task publishes.
    silent(gate('git push', gateRepo(featureDoc({ specs: [S1_SPEC, S2_CLEAR], rows: [['T1', 'S1, S2', 'none', 'done']], log: LOG }))))
  })

  test('the document is read at the ref: an uncommitted fix does not lift the deny', () => {
    const repo = gateRepo(featureDoc({ specs: [S1_SPEC, S2_MARKED], rows: [['T1', 'S1, S2', 'none', 'done']], log: LOG }))
    write(repo, '.vault/tasks/f.md', featureDoc({ specs: [S1_SPEC, S2_CLEAR], rows: [['T1', 'S1, S2', 'none', 'done']], log: LOG }))
    clarificationDenied(gate('git push', repo))
    commitAll(repo, 'clarify S2')
    silent(gate('git push', repo))
  })

  test('approved review lenses do not lift the clarification deny', () => {
    const repo = gateRepo(featureDoc({ specs: [S1_SPEC, S2_MARKED], rows: [['T1', 'S1, S2', '2', 'done']], log: LOG }))
    const subject = subjectHash(git(repo, 'rev-parse', 'main^{tree}').trim(), git(repo, 'rev-parse', 'HEAD^{tree}').trim())
    writeVerdict(repo, { lens: 'review-risk', subject_hash: subject, approved: true, at: Date.now(), result: {} })
    clarificationDenied(gate('git push', repo))
  })
})

// ---------------------------------------------------------------- S2-S5: feature-state

function featureState(cwd) {
  const r = spawnSync('node', [FEATURE_STATE], {
    input: JSON.stringify({ cwd, hook_event_name: 'SessionStart', source: 'compact' }),
    encoding: 'utf8',
    cwd: scratchDir('ls-fs-run-'),
  })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

function context(r) {
  assert.equal(r.status, 0, r.stderr)
  assert.notEqual(r.stdout, '', 'expected additionalContext, got no output')
  const out = JSON.parse(r.stdout)
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart')
  return out.hookSpecificOutput.additionalContext
}

const lines = (text) => text.split('\n')
const has = (line, ...parts) => parts.every((p) => (p instanceof RegExp ? p.test(line) : line.includes(p)))
const anyLine = (text, ...parts) => lines(text).some((l) => has(l, ...parts))
const word = (id) => new RegExp(`\\b${id}\\b`)

describe('S2: open clarifications are visible', () => {
  const marked = (id, q) => `**${id} — Spec ${id}.** "do ${id}" now. NEEDS CLARIFICATION: ${q}`
  const logFor = (ids) => [`**L1 (2026-10-01):** ${ids.map((id) => `"do ${id}"`).join(' ')}`]
  const OVER_CAP = /(more than|over|above|exceeds?|exceeding|>)\s*3\b|(cap|limit|max(imum)?)( of)?:? 3\b/i

  test('each open clarification of an active document is listed with its S# and question', () => {
    const repo = makeRepo()
    write(repo, '.vault/tasks/a.md', featureDoc({
      specs: [marked('S1', 'Which cache backend applies?'), '**S2 — Plain.** "do S2" now.', marked('S3', 'How long do entries live?')],
      rows: [['T1', 'S1, S2, S3', 'none', 'pending']],
      log: logFor(['S1', 'S2', 'S3']),
    }))
    const text = context(featureState(repo))
    assert.ok(anyLine(text, word('S1'), 'Which cache backend applies?'), text)
    assert.ok(anyLine(text, word('S3'), 'How long do entries live?'), text)
    assert.doesNotMatch(text, OVER_CAP)
  })

  test('more than 3 open clarifications in one document is warned; 3 is not', () => {
    const ids = ['S1', 'S2', 'S3', 'S4']
    const four = makeRepo()
    write(four, '.vault/tasks/a.md', featureDoc({ specs: ids.map((id) => marked(id, `Question about ${id}?`)), rows: [['T1', 'S1-S4', 'none', 'pending']], log: logFor(ids) }))
    const text = context(featureState(four))
    for (const id of ids) assert.ok(anyLine(text, word(id), `Question about ${id}?`), text)
    assert.ok(anyLine(text, OVER_CAP), text)

    const three = makeRepo()
    const specs = [...ids.slice(0, 3).map((id) => marked(id, `Question about ${id}?`)), '**S4 — Plain.** "do S4" now.']
    write(three, '.vault/tasks/a.md', featureDoc({ specs, rows: [['T1', 'S1-S4', 'none', 'pending']], log: logFor(ids) }))
    const text3 = context(featureState(three))
    assert.ok(anyLine(text3, word('S3'), 'Question about S3?'), text3)
    assert.doesNotMatch(text3, OVER_CAP)
  })
})

describe('S3: quote provenance', () => {
  // quoteWarned: a line about quotes naming the spec id.
  const quoteWarned = (text, id) => anyLine(text, /quot/i, word(id))

  test('an S# whose quote is not in the Log and has no Assumption is warned; quoted, curly-quoted, whitespace-different, and Assumption specs are not', () => {
    const repo = makeRepo()
    write(repo, '.vault/tasks/a.md', featureDoc({
      specs: [
        '**S1 — Quoted.** "keep the cache warm" on start.',
        '**S2 — Not in the Log.** "drop stale rows" nightly.',
        '**S3 — Curly.** “serve from the edge” first.',
        '**S4 — Spacing.** "retry  three   times" then fail.',
        '**S5 — Assumed.** No quote here. Assumption: one region.',
        '**S6 — Unquoted.** No quote and nothing assumed.',
      ],
      rows: [['T1', 'S1-S6', 'none', 'pending']],
      log: ['**L1 (2026-10-01):** "keep the cache warm", "serve from the edge", and "retry three times".'],
    }))
    const text = context(featureState(repo))
    assert.ok(quoteWarned(text, 'S2'), text)
    assert.ok(quoteWarned(text, 'S6'), text)
    for (const id of ['S1', 'S3', 'S4', 'S5']) assert.ok(!quoteWarned(text, id), `${id} warned:\n${text}`)
  })

  test('a quote found outside the Log section does not count', () => {
    const repo = makeRepo()
    const doc = featureDoc({
      specs: ['**S1 — Elsewhere.** "only in the objective" here.', '**S2 — Fine.** "in the log" here.'],
      rows: [['T1', 'S1, S2', 'none', 'pending']],
      log: ['**L1 (2026-10-01):** "in the log"'],
    }).replace('Objective: x.', 'Objective: only in the objective.')
    write(repo, '.vault/tasks/a.md', doc)
    const text = context(featureState(repo))
    assert.ok(quoteWarned(text, 'S1'), text)
    assert.ok(!quoteWarned(text, 'S2'), text)
  })

  test('the warning is per document: each document names its own failing S#', () => {
    const repo = makeRepo()
    write(repo, '.vault/tasks/a.md', featureDoc({ specs: ['**S1 — Ok.** "alpha words"', '**S2 — Bad.** "missing alpha"'], rows: [['T1', 'S1, S2', 'none', 'pending']], log: ['"alpha words"'] }))
    write(repo, '.vault/tasks/b.md', featureDoc({ specs: ['**S7 — Bad.** "missing beta"', '**S8 — Ok.** "beta words"'], rows: [['T1', 'S7, S8', 'none', 'pending']], log: ['"beta words"'] }))
    const text = context(featureState(repo))
    assert.ok(quoteWarned(text, 'S2'), text)
    assert.ok(quoteWarned(text, 'S7'), text)
    assert.ok(!quoteWarned(text, 'S1') && !quoteWarned(text, 'S8'), text)
  })
})

describe('S3: finished features land in .vault/specs/<feature>.md', () => {
  const finished = (date = '2026-10-01', status = 'done') => featureDoc({
    specs: ['**S1 — Cache.** "keep the cache"'],
    rows: [['T1', 'S1', 'none', status]],
    log: [`**L1 (${date}):** "keep the cache"`],
  })
  const SPEC = (started = '2026-09-01') => `Started: ${started}\n\n# Living spec\n`
  const livingSpec = (repo, feature) => write(repo, `.vault/specs/${feature}.md`, `# ${feature}\n\n- **S1 — X.** "x"\n`)
  // livingWarned: a line naming the feature and its .vault/specs/<feature>.md.
  const livingWarned = (text, feature) => anyLine(text, feature, `.vault/specs/${feature}.md`)

  test('a finished document with no specs file is warned even when no document is unfinished', () => {
    const repo = makeRepo()
    write(repo, '.vault/specs/README.md', SPEC())
    livingSpec(repo, 'other-feature')
    write(repo, '.vault/tasks/cache-layer.md', finished())
    const text = context(featureState(repo))
    assert.ok(livingWarned(text, 'cache-layer'), text)
  })

  test('dropped tasks count as finished; a file that only starts with the name does not count', () => {
    const repo = makeRepo()
    write(repo, '.vault/specs/README.md', SPEC())
    livingSpec(repo, 'cache-layer-old')
    write(repo, '.vault/tasks/cache-layer.md', finished('2026-10-01', 'dropped'))
    assert.ok(livingWarned(context(featureState(repo)), 'cache-layer'))
  })

  test('no warning when the specs file exists, and the warning names only the missing feature', () => {
    const repo = makeRepo()
    write(repo, '.vault/specs/README.md', SPEC())
    livingSpec(repo, 'cache-layer')
    write(repo, '.vault/tasks/cache-layer.md', finished())
    write(repo, '.vault/tasks/search-index.md', finished())
    const text = context(featureState(repo))
    assert.ok(livingWarned(text, 'search-index'), text)
    assert.ok(!livingWarned(text, 'cache-layer'), text)
  })

  test('an unfinished document and a finished one without ## Specs are not warned', () => {
    const repo = makeRepo()
    write(repo, '.vault/specs/README.md', SPEC())
    write(repo, '.vault/tasks/search-index.md', finished())
    write(repo, '.vault/tasks/open-work.md', finished('2026-10-01', 'pending'))
    write(repo, '.vault/tasks/no-specs.md', finished().replace('## Specs', '## Notes'))
    const text = context(featureState(repo))
    assert.ok(livingWarned(text, 'search-index'), text)
    assert.ok(!livingWarned(text, 'open-work'), text)
    assert.ok(!livingWarned(text, 'no-specs'), text)
  })

  test('S5: a document whose L1 date is before Started is skipped; the same day or later is warned', () => {
    const repo = makeRepo()
    write(repo, '.vault/specs/README.md', SPEC('2026-10-15'))
    write(repo, '.vault/tasks/old-feature.md', finished('2026-10-14'))
    write(repo, '.vault/tasks/same-day.md', finished('2026-10-15'))
    write(repo, '.vault/tasks/later.md', finished('2026-10-20'))
    const text = context(featureState(repo))
    assert.ok(!livingWarned(text, 'old-feature'), text)
    assert.ok(livingWarned(text, 'same-day'), text)
    assert.ok(livingWarned(text, 'later'), text)
  })

  test('S5: no living-spec warning while .vault/specs/README.md does not exist', () => {
    // Control: with .vault/specs/README.md the finished document is warned.
    const withSpec = makeRepo()
    write(withSpec, '.vault/specs/README.md', SPEC())
    write(withSpec, '.vault/tasks/cache-layer.md', finished())
    assert.ok(livingWarned(context(featureState(withSpec)), 'cache-layer'))

    const without = makeRepo()
    write(without, '.vault/tasks/cache-layer.md', finished())
    const r = featureState(without)
    assert.equal(r.status, 0)
    assert.ok(!r.stdout.includes('.vault/specs/'), r.stdout)
  })
})
