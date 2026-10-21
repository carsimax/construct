// The review hooks, driven as real hooks: review-context.mjs (PreToolUse on Agent)
// and review-capture.mjs (SubagentStop), with the hook JSON on stdin, a real
// two-commit repository, and scratch CLAUDE_PLUGIN_DATA and XDG_CONFIG_HOME.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyFiles, commitAll, git, makeRepo, scratchDir } from '../helpers/repo.mjs'
import { requiredLenses } from '../../plugins/construct/hooks/scripts/review-lenses.mjs'
import { readVerdicts, subjectHash } from '../../plugins/construct/hooks/scripts/review-store.mjs'

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
    assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /Review subject: <base-ref>/)
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

  test('a diff over the size limit is denied with a split instruction', () => {
    const repo = makeRepo({ 'a.txt': 'x\n' })
    applyFiles(repo, { 'big.txt': 'y'.repeat(500 * 1024) + '\n' })
    commitAll(repo, 'big')
    const r = hook(CONTEXT_HOOK, spawnInput(repo, 'Review subject: HEAD~1'))
    assert.equal(r.json.hookSpecificOutput.permissionDecision, 'deny')
    assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /split the change/)
  })

  test('other agents pass through untouched', () => {
    const r = hook(CONTEXT_HOOK, spawnInput(reviewed(), 'no subject here', 'construct:odd-worker'))
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

  test('a malformed reply blocks, at most twice, and records nothing', () => {
    const repo = reviewed()
    const binding = prepare(repo)
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = hook(CAPTURE_HOOK, stopInput(repo, 'not json'))
      assert.equal(r.json.decision, 'block')
      assert.match(r.json.reason, /malformed_result/)
    }
    assert.equal(hook(CAPTURE_HOOK, stopInput(repo, 'not json')).stdout, '')
    assert.deepEqual(readVerdicts(repo, binding.subject_hash), {})
  })

  test('an invalid result blocks with the validator message', () => {
    const repo = reviewed()
    const binding = prepare(repo)
    const r = hook(CAPTURE_HOOK, stopInput(repo, JSON.stringify(result(binding, [{ ...critical, evidence_class: 'static-analysis' }]))))
    assert.equal(r.json.decision, 'block')
    assert.match(r.json.reason, /invalid_result/)
    assert.match(r.json.reason, /evidence_class/)
  })

  test('a result for another subject is refused and recorded nowhere', () => {
    const repo = reviewed()
    const binding = prepare(repo)
    const r = hook(CAPTURE_HOOK, stopInput(repo, JSON.stringify({ ...result(binding), subject_hash: 'f'.repeat(64) })))
    assert.equal(r.json.decision, 'block')
    assert.match(r.json.reason, /does not match the bound subject/)
    assert.deepEqual(readVerdicts(repo, binding.subject_hash), {})
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
