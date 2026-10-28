// The review hooks, driven as real hooks: review-context.mjs (PreToolUse on Agent)
// and review-capture.mjs (SubagentStop), with the hook JSON on stdin, a real
// two-commit repository, and scratch CLAUDE_PLUGIN_DATA and XDG_CONFIG_HOME.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyFiles, commitAll, git, makeRepo, scratchDir } from '../helpers/repo.mjs'
import { requiredLenses } from '../../plugins/construct/hooks/scripts/review-lenses.mjs'
import { readVerdicts, subjectHash, writeVerdict } from '../../plugins/construct/hooks/scripts/review-store.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const CONTEXT_HOOK = join(PLUGIN, 'hooks/scripts/review-context.mjs')
const CAPTURE_HOOK = join(PLUGIN, 'hooks/scripts/review-capture.mjs')

function hook(script, input) {
  const result = spawnSync('node', [script], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_DATA: scratchDir('review-hooks-data-'), XDG_CONFIG_HOME: scratchDir('review-hooks-xdg-') },
  })
  let json = null
  try {
    json = JSON.parse(result.stdout)
  } catch {
    // No output.
  }
  return { status: result.status, stdout: result.stdout, json }
}

const spawnInput = (repo, prompt, agent = 'construct:review-risk') => ({
  session_id: 's1',
  cwd: repo,
  hook_event_name: 'PreToolUse',
  tool_name: 'Agent',
  tool_input: { description: 'RDD risk lens', prompt, subagent_type: agent },
})

const stopInput = (repo, message, agent = 'construct:review-risk', extra = {}) => ({
  session_id: 's1',
  cwd: repo,
  hook_event_name: 'SubagentStop',
  agent_type: agent,
  agent_id: 'a1',
  last_assistant_message: message,
  stop_hook_active: false,
  ...extra,
})

// reviewed is a two-commit repository: base on main, one change on top.
function reviewed() {
  const repo = makeRepo({ 'src/a.js': 'export const a = 1\n' })
  applyFiles(repo, { 'src/a.js': 'export const a = 2\n', 'src/b.js': 'export const b = 1\n' })
  commitAll(repo, 'change')
  return repo
}

const prepare = (repo, agent = 'construct:review-risk') => {
  const r = hook(CONTEXT_HOOK, spawnInput(repo, 'Please review.\nReview subject: HEAD~1\n', agent))
  const prompt = r.json.hookSpecificOutput.updatedInput.prompt
  return JSON.parse(prompt.split('\n')[0].slice('ODD_REVIEW_BINDING '.length))
}

const result = (binding, findings = []) => ({
  subject_hash: binding.subject_hash,
  inspection: { status: 'completed', paths: binding.artifact_subject.changed_path_manifest },
  findings,
  evidence: ['read every patch'],
})
const critical = { location: 'src/a.js:1', severity: 'CRITICAL', claim: 'breaks callers', evidence_class: 'deterministic', causal_disposition: 'introduced', proof_refs: ['patch of src/a.js'] }

describe('lens mapping', () => {
  test('requiredLenses gives the sorted unique lenses and never readability', () => {
    assert.deepEqual(requiredLenses([2, 4]), ['review-reliability', 'review-resilience', 'review-risk'])
    assert.deepEqual(requiredLenses(new Set([3, 6])), ['review-reliability'])
    assert.deepEqual(requiredLenses([]), [])
    assert.ok(!requiredLenses([1, 2, 3, 4, 5, 6]).includes('review-readability'))
  })
})

describe('registration', () => {
  test('hooks.json wires the context hook on Agent and the capture hook on review agents', () => {
    const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks/hooks.json'), 'utf8')).hooks
    const pre = hooks.PreToolUse.find((entry) => entry.matcher === 'Agent')
    assert.deepEqual(pre.hooks[0], { type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/review-context.mjs'], timeout: 30 })
    const stop = hooks.SubagentStop.find((entry) => entry.matcher === '^construct:review-')
    assert.deepEqual(stop.hooks[0], { type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/scripts/review-capture.mjs'], timeout: 30 })
  })
})

describe('context hook', () => {
  test('a subject line yields the binding, manifest, patches and checklist for the lens', () => {
    const repo = reviewed()
    const r = hook(CONTEXT_HOOK, spawnInput(repo, 'Review subject: HEAD~1'))
    assert.equal(r.status, 0)
    const out = r.json.hookSpecificOutput
    assert.equal(out.permissionDecision, 'allow')
    assert.equal(out.updatedInput.subagent_type, 'construct:review-risk')
    assert.equal(out.updatedInput.description, 'RDD risk lens')
    const prompt = out.updatedInput.prompt
    const binding = JSON.parse(prompt.split('\n')[0].slice('ODD_REVIEW_BINDING '.length))
    const base = git(repo, 'rev-parse', 'HEAD~1^{tree}').trim()
    const head = git(repo, 'rev-parse', 'HEAD^{tree}').trim()
    assert.equal(binding.lens, 'review-risk')
    assert.equal(binding.subject_hash, subjectHash(base, head))
    assert.deepEqual(binding.artifact_subject, { subject_hash: binding.subject_hash, base_tree: base, candidate_tree: head, changed_path_manifest: ['src/a.js', 'src/b.js'] })
    assert.match(prompt, /ODD_REVIEW_CONTEXT\nbase_tree: /)
    assert.match(prompt, /name-status:\nM\tsrc\/a\.js\nA\tsrc\/b\.js\nnumstat:\n1\t1\tsrc\/a\.js\n1\t0\tsrc\/b\.js\n/)
    assert.match(prompt, /ODD_REVIEW_PATH \{"index":0,"path":"src\/a\.js"\}\n[\s\S]*\+export const a = 2\nODD_REVIEW_PATH_END 0\n/)
    assert.match(prompt, /ODD_REVIEW_CHECKLIST_BEGIN\n[\s\S]+ODD_REVIEW_CHECKLIST_END\nODD_REVIEW_CONTEXT_END\n$/)
  })

  test('only review-risk gets the checklist', () => {
    const r = hook(CONTEXT_HOOK, spawnInput(reviewed(), 'Review subject: HEAD~1', 'construct:review-reliability'))
    assert.doesNotMatch(r.json.hookSpecificOutput.updatedInput.prompt, /ODD_REVIEW_CHECKLIST/)
  })

  test('a prompt without a subject line is denied with the expected form', () => {
    const r = hook(CONTEXT_HOOK, spawnInput(reviewed(), 'please review my change'))
    assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny')
    assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /Review subject: <base>`/)
  })

  test('a ref that does not resolve is denied', () => {
    const r = hook(CONTEXT_HOOK, spawnInput(reviewed(), 'Review subject: no-such-ref'))
    assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny')
    assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /could not be prepared/)
  })

  test('a ref equal to HEAD (nothing to review) is denied', () => {
    const r = hook(CONTEXT_HOOK, spawnInput(reviewed(), 'Review subject: HEAD'))
    assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny')
  })

  test('a diff over the size limit is denied with a range instruction', () => {
    const repo = makeRepo({ 'a.txt': 'x\n' })
    applyFiles(repo, { 'big.txt': 'y'.repeat(500 * 1024) + '\n' })
    commitAll(repo, 'big')
    const r = hook(CONTEXT_HOOK, spawnInput(repo, 'Review subject: HEAD~1'))
    assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny')
    assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /smaller pull requests/)
  })

  test('other agents pass through untouched', () => {
    const r = hook(CONTEXT_HOOK, spawnInput(reviewed(), 'no subject here', 'construct:worker'))
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '')
  })
})

describe('capture hook', () => {
  test('a clean fenced result is recorded as an approved verdict and the stop is allowed', () => {
    const repo = reviewed()
    const binding = prepare(repo)
    const r = hook(CAPTURE_HOOK, stopInput(repo, `\`\`\`json\n${JSON.stringify(result(binding))}\n\`\`\``))
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '')
    const verdict = readVerdicts(repo, binding.subject_hash)['review-risk']
    assert.equal(verdict.approved, true)
    assert.equal(verdict.subject_hash, binding.subject_hash)
    assert.deepEqual(verdict.result, result(binding))
  })

  test('a CRITICAL finding is recorded as not approved', () => {
    const repo = reviewed()
    const binding = prepare(repo)
    hook(CAPTURE_HOOK, stopInput(repo, JSON.stringify(result(binding, [critical]))))
    assert.equal(readVerdicts(repo, binding.subject_hash)['review-risk'].approved, false)
  })

  test('a WARNING finding still approves', () => {
    const repo = reviewed()
    const binding = prepare(repo)
    hook(CAPTURE_HOOK, stopInput(repo, JSON.stringify(result(binding, [{ ...critical, severity: 'WARNING' }]))))
    assert.equal(readVerdicts(repo, binding.subject_hash)['review-risk'].approved, true)
  })

  test('the lens reply in a SubagentHandback transcript is captured', () => {
    const repo = reviewed()
    const binding = prepare(repo)
    const file = join(scratchDir('review-hooks-transcript-'), 'agent.jsonl')
    const entry = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'SubagentHandback', input: { message: JSON.stringify(result(binding)) } }] } }
    writeFileSync(file, `${JSON.stringify(entry)}\n`)
    const r = hook(CAPTURE_HOOK, stopInput(repo, '', 'construct:review-risk', { agent_transcript_path: file }))
    assert.equal(r.stdout, '')
    assert.equal(readVerdicts(repo, binding.subject_hash)['review-risk'].approved, true)
  })

  test('a prose reply with one pending record of the same session retries, then clears only that record (S5)', () => {
    const repo = reviewed()
    const binding = prepare(repo)
    const dir = join(repo, '.git', 'construct-review', 'pending')
    const file = join(dir, `review-risk.${binding.subject_hash}.json`)
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = hook(CAPTURE_HOOK, stopInput(repo, 'not json'))
      assert.equal(r.json.decision, 'block')
      assert.match(r.json.reason, /review-capture rejected/)
      assert.equal(JSON.parse(readFileSync(file, 'utf8')).attempts, attempt + 1)
    }
    assert.equal(hook(CAPTURE_HOOK, stopInput(repo, 'not json')).stdout, '')
    assert.equal(existsSync(file), false)
    assert.deepEqual(readVerdicts(repo, binding.subject_hash), {})
  })

  test('a prose reply never touches another session\'s pending record (F9)', () => {
    const repo = reviewed()
    const binding = prepare(repo)
    const dir = join(repo, '.git', 'construct-review', 'pending')
    const file = join(dir, `review-risk.${binding.subject_hash}.json`)
    const before = readFileSync(file, 'utf8')
    for (let attempt = 0; attempt < 3; attempt++) assert.equal(hook(CAPTURE_HOOK, { ...stopInput(repo, 'not json'), session_id: 's2' }).stdout, '')
    assert.equal(readFileSync(file, 'utf8'), before)
  })

  test('a prose reply retries its own session and leaves a second session\'s record untouched', () => {
    const repo = reviewed()
    const mine = prepare(repo)
    applyFiles(repo, { 'src/c.js': 'export const c = 1\n' })
    commitAll(repo, 'more')
    hook(CONTEXT_HOOK, { ...spawnInput(repo, 'Review subject: HEAD~2'), session_id: 's2' })
    const dir = join(repo, '.git', 'construct-review', 'pending')
    const other = readdirSync(dir).find((name) => !name.includes(mine.subject_hash))
    const otherBefore = readFileSync(join(dir, other), 'utf8')
    for (let attempt = 0; attempt < 2; attempt++) assert.equal(hook(CAPTURE_HOOK, stopInput(repo, 'not json')).json.decision, 'block')
    assert.equal(hook(CAPTURE_HOOK, stopInput(repo, 'not json')).stdout, '')
    assert.deepEqual(readdirSync(dir), [other])
    assert.equal(readFileSync(join(dir, other), 'utf8'), otherBefore)
  })

  test('a record without session_id is never chosen by the fallback', () => {
    const repo = reviewed()
    const binding = prepare(repo)
    const file = join(repo, '.git', 'construct-review', 'pending', `review-risk.${binding.subject_hash}.json`)
    const { session_id, ...old } = JSON.parse(readFileSync(file, 'utf8'))
    writeFileSync(file, `${JSON.stringify(old)}\n`)
    const before = readFileSync(file, 'utf8')
    assert.equal(hook(CAPTURE_HOOK, stopInput(repo, 'not json')).stdout, '')
    assert.equal(readFileSync(file, 'utf8'), before)
  })

  test('the pending record stores the hook input session_id', () => {
    const repo = reviewed()
    const binding = prepare(repo)
    const file = join(repo, '.git', 'construct-review', 'pending', `review-risk.${binding.subject_hash}.json`)
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).session_id, 's1')
  })

  test('a malformed reply with two pending subjects leaves both records (F9)', () => {
    const repo = reviewed()
    const first = prepare(repo)
    applyFiles(repo, { 'src/c.js': 'export const c = 1\n' })
    commitAll(repo, 'more')
    const second = hook(CONTEXT_HOOK, spawnInput(repo, 'Review subject: HEAD~2'))
    assert.notEqual(JSON.parse(second.json.hookSpecificOutput.updatedInput.prompt.split('\n')[0].slice(19)).subject_hash, first.subject_hash)
    const dir = join(repo, '.git', 'construct-review', 'pending')
    assert.equal(readdirSync(dir).length, 2)
    assert.equal(hook(CAPTURE_HOOK, stopInput(repo, 'not json')).stdout, '')
    assert.equal(readdirSync(dir).length, 2)
  })

  test('a consumed pending record is removed after the verdict is written (F20)', () => {
    const repo = reviewed()
    const binding = prepare(repo)
    const file = join(repo, '.git', 'construct-review', 'pending', `review-risk.${binding.subject_hash}.json`)
    assert.ok(existsSync(file))
    hook(CAPTURE_HOOK, stopInput(repo, JSON.stringify(result(binding))))
    assert.ok(!existsSync(file))
  })

  test('a context over the byte budget is denied at the first path past it, without diffing the rest', () => {
    const big = 'x'.repeat(300 * 1024) + '\n'
    const repo = makeRepo({ 'src/a.js': 'a\n' })
    applyFiles(repo, { 'src/p1.txt': big, 'src/p2.txt': big, 'src/p3.txt': big })
    commitAll(repo, 'big')
    const r = hook(CONTEXT_HOOK, spawnInput(repo, 'Review subject: HEAD~1'))
    assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny')
    assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /byte budget at path 2 of 3/)
  })

  test('pending and verdict records older than 30 days are pruned when capture runs (F20)', () => {
    const repo = reviewed()
    const binding = prepare(repo)
    const store = join(repo, '.git', 'construct-review')
    const old = join(store, 'pending', 'review-risk.old.json')
    writeFileSync(old, '{}')
    mkdirSync(join(store, 'verdicts', 'oldsubject'), { recursive: true })
    const verdict = join(store, 'verdicts', 'oldsubject', 'review-risk.json')
    writeFileSync(verdict, '{}')
    const past = new Date(Date.now() - 31 * 24 * 3600 * 1000)
    utimesSync(old, past, past)
    utimesSync(verdict, past, past)
    utimesSync(join(store, 'verdicts', 'oldsubject'), past, past)
    // A subject directory another capture just created, before it writes its verdict, stays.
    mkdirSync(join(store, 'verdicts', 'newsubject'))
    hook(CAPTURE_HOOK, stopInput(repo, 'not json'))
    assert.ok(!existsSync(old))
    assert.ok(!existsSync(verdict))
    assert.ok(!existsSync(join(store, 'verdicts', 'oldsubject')))
    assert.ok(existsSync(join(store, 'verdicts', 'newsubject')))
    assert.ok(existsSync(join(store, 'pending', `review-risk.${binding.subject_hash}.json`)))
  })

  test('an invalid result blocks with the validator message', () => {
    const repo = reviewed()
    const binding = prepare(repo)
    const r = hook(CAPTURE_HOOK, stopInput(repo, JSON.stringify(result(binding, [{ ...critical, evidence_class: 'static-analysis' }]))))
    assert.equal(r.json.decision, 'block')
    assert.match(r.json.reason, /invalid_result/)
    assert.match(r.json.reason, /evidence_class/)
  })

  test('a result for another subject from another session matches no pending record: ignored, nothing recorded (F9)', () => {
    const repo = reviewed()
    const binding = prepare(repo)
    const r = hook(CAPTURE_HOOK, { ...stopInput(repo, JSON.stringify({ ...result(binding), subject_hash: 'f'.repeat(64) })), session_id: 's2' })
    assert.equal(r.stdout, '')
    assert.deepEqual(readVerdicts(repo, binding.subject_hash), {})
    assert.ok(existsSync(join(repo, '.git', 'construct-review', 'pending', `review-risk.${binding.subject_hash}.json`)))
  })

  test('inspection paths that differ from the manifest are refused', () => {
    const repo = reviewed()
    const binding = prepare(repo)
    const bad = { ...result(binding), inspection: { status: 'completed', paths: ['src/a.js'] } }
    assert.match(hook(CAPTURE_HOOK, stopInput(repo, JSON.stringify(bad))).json.reason, /changed-path manifest/)
  })

  test('an incomplete inspection records nothing and does not block', () => {
    const repo = reviewed()
    const binding = prepare(repo)
    const incomplete = { ...result(binding), inspection: { status: 'incomplete', paths: [] } }
    assert.equal(hook(CAPTURE_HOOK, stopInput(repo, JSON.stringify(incomplete))).stdout, '')
    assert.deepEqual(readVerdicts(repo, binding.subject_hash), {})
  })

  test('an agent the context hook did not prepare is left alone', () => {
    const repo = reviewed()
    const binding = prepare(repo)
    const r = hook(CAPTURE_HOOK, stopInput(repo, JSON.stringify(result(binding)), 'construct:review-reliability'))
    assert.equal(r.stdout, '')
    assert.deepEqual(readVerdicts(repo, binding.subject_hash), {})
  })

  test('the verdict store lives under the git common dir in construct-review', () => {
    const repo = reviewed()
    const binding = prepare(repo)
    hook(CAPTURE_HOOK, stopInput(repo, JSON.stringify(result(binding))))
    const file = join(repo, '.git', 'construct-review', 'verdicts', binding.subject_hash, 'review-risk.json')
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).lens, 'review-risk')
  })
})

describe('ranges, deleted paths, and verdict records (T8)', () => {
  const treeOf = (repo, ref) => git(repo, 'rev-parse', `${ref}^{tree}`).trim()
  const bindingOf = (r) => JSON.parse(r.json.hookSpecificOutput.updatedInput.prompt.split('\n')[0].slice('ODD_REVIEW_BINDING '.length))

  // three is main plus two commits on top.
  function three() {
    const repo = makeRepo({ 'src/a.js': 'export const a = 1\n', 'src/gone.js': 'SECRET_REMOVED_BODY\n' })
    applyFiles(repo, { 'src/a.js': 'export const a = 2\n' })
    commitAll(repo, 'one')
    applyFiles(repo, { 'src/gone.js': null, 'src/c.js': 'export const c = 1\n' })
    commitAll(repo, 'two')
    return repo
  }

  test('the subject is the base tree against HEAD: both trees bound, recorded as pending', () => {
    const repo = three()
    const binding = bindingOf(hook(CONTEXT_HOOK, spawnInput(repo, 'Review subject: HEAD~2')))
    assert.equal(binding.subject_hash, subjectHash(treeOf(repo, 'HEAD~2'), treeOf(repo, 'HEAD')))
    assert.equal(binding.artifact_subject.candidate_tree, treeOf(repo, 'HEAD'))
  })

  test('the <base>..<head> form is gone (F17): it is denied', () => {
    const repo = three()
    for (const subject of ['HEAD~2..HEAD~1', 'HEAD~2..HEAD', 'HEAD~2..']) {
      assert.equal(hook(CONTEXT_HOOK, spawnInput(repo, `Review subject: ${subject}`)).json.hookSpecificOutput.permissionDecision, 'deny', subject)
    }
  })

  test('the range denial says the form was removed and to review from the merge-base', () => {
    const r = hook(CONTEXT_HOOK, spawnInput(three(), 'Review subject: HEAD~2..HEAD'))
    assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /form was removed.*merge-base/)
  })

  test('a deleted path stays in the manifest and the name-status, its removed body is omitted', () => {
    const repo = three()
    const r = hook(CONTEXT_HOOK, spawnInput(repo, 'Review subject: HEAD~1'))
    const prompt = r.json.hookSpecificOutput.updatedInput.prompt
    assert.ok(bindingOf(r).artifact_subject.changed_path_manifest.includes('src/gone.js'))
    assert.match(prompt, /^D\tsrc\/gone\.js$/m)
    assert.match(prompt, /deleted; content omitted/)
    assert.doesNotMatch(prompt, /SECRET_REMOVED_BODY/)
    assert.match(prompt, /export const c = 1/)
  })

  test('a vendored path stays in the manifest and the name-status, its content is omitted', () => {
    const repo = makeRepo({ 'src/a.js': 'export const a = 1\n' })
    applyFiles(repo, { 'plugins/construct/hooks/vendor/lib.cjs': 'VENDORED_BODY\n', 'src/a.js': 'export const a = 2\n' })
    commitAll(repo, 'vendor')
    const r = hook(CONTEXT_HOOK, spawnInput(repo, 'Review subject: HEAD~1'))
    const prompt = r.json.hookSpecificOutput.updatedInput.prompt
    assert.ok(bindingOf(r).artifact_subject.changed_path_manifest.includes('plugins/construct/hooks/vendor/lib.cjs'))
    assert.match(prompt, /^A\tplugins\/construct\/hooks\/vendor\/lib\.cjs$/m)
    assert.match(prompt, /^1\t0\tplugins\/construct\/hooks\/vendor\/lib\.cjs$/m)
    assert.match(prompt, /vendored; content omitted; its sha256 is pinned by tests\/band-license\.test\.mjs/)
    assert.doesNotMatch(prompt, /VENDORED_BODY/)
    assert.match(prompt, /export const a = 2/)
  })

  test('only the exact vendor directory is omitted: other paths containing vendor keep their diff', () => {
    const repo = makeRepo({ 'src/a.js': 'export const a = 1\n' })
    const paths = ['plugins/construct/hooks/scripts/vendor-x.mjs', 'tests/hooks/vendor/a.mjs', 'plugins/construct/hooks/vendorx/b.mjs', 'plugins/construct/hooks/scripts/vendor/c.mjs']
    applyFiles(repo, Object.fromEntries(paths.map((p, i) => [p, `KEEP_BODY_${i}\n`])))
    commitAll(repo, 'near misses')
    const prompt = hook(CONTEXT_HOOK, spawnInput(repo, 'Review subject: HEAD~1')).json.hookSpecificOutput.updatedInput.prompt
    paths.forEach((_, i) => assert.match(prompt, new RegExp(`\\+KEEP_BODY_${i}`)))
    assert.doesNotMatch(prompt, /vendored; content omitted/)
  })

  test('a lens can approve a context with a deleted path: the manifest still matches', () => {
    const repo = three()
    const binding = bindingOf(hook(CONTEXT_HOOK, spawnInput(repo, 'Review subject: HEAD~1')))
    assert.equal(hook(CAPTURE_HOOK, stopInput(repo, JSON.stringify(result(binding)))).stdout, '')
    assert.equal(readVerdicts(repo, binding.subject_hash)['review-risk'].approved, true)
  })

  test('the verdict record stores base_tree and head_tree', () => {
    const repo = three()
    const binding = bindingOf(hook(CONTEXT_HOOK, spawnInput(repo, 'Review subject: HEAD~2')))
    hook(CAPTURE_HOOK, stopInput(repo, JSON.stringify(result(binding))))
    const verdict = readVerdicts(repo, binding.subject_hash)['review-risk']
    assert.equal(verdict.base_tree, treeOf(repo, 'HEAD~2'))
    assert.equal(verdict.head_tree, treeOf(repo, 'HEAD'))
  })

  test('a rejected verdict is never replaced by an approval of the same subject', () => {
    const repo = reviewed()
    const record = (approved) => ({ lens: 'review-risk', subject_hash: 's1', base_tree: 'a', head_tree: 'b', approved, at: Date.now(), result: {} })
    writeVerdict(repo, record(false))
    writeVerdict(repo, record(true))
    assert.equal(readVerdicts(repo, 's1')['review-risk'].approved, false)
  })

  test('an approval written after a rejection loses even when it was prepared first (F13)', () => {
    const repo = reviewed()
    const record = (approved, at) => ({ lens: 'review-risk', subject_hash: 's1', approved, at, result: {} })
    writeVerdict(repo, record(true, 1))
    writeVerdict(repo, record(false, 2))
    assert.equal(readVerdicts(repo, 's1')['review-risk'].approved, false)
    writeVerdict(repo, record(true, 3))
    assert.equal(readVerdicts(repo, 's1')['review-risk'].approved, false)
  })

  test('the first approval stands: a later approval never replaces it (F13)', () => {
    const repo = reviewed()
    const record = (at) => ({ lens: 'review-risk', subject_hash: 's1', approved: true, at, result: {} })
    writeVerdict(repo, record(1))
    writeVerdict(repo, record(2))
    assert.equal(readVerdicts(repo, 's1')['review-risk'].at, 1)
  })
})
