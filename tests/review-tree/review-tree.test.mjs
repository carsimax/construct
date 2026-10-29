// S1: review-context reviews a snapshot of the working tree, not HEAD; the publication gate keys on trees,
// so a later commit with the same content keeps the approval and any other content does not.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { applyFiles, commitAll, git, makeRepo, scratchDir } from '../helpers/repo.mjs'
import { readVerdicts, subjectHash } from '../../plugins/construct/hooks/scripts/review-store.mjs'

const PLUGIN = new URL('../../plugins/construct/', import.meta.url).pathname
const script = (name) => join(PLUGIN, 'hooks/scripts', name)
const env = { ...process.env, CLAUDE_PLUGIN_DATA: scratchDir('review-tree-data-'), XDG_CONFIG_HOME: scratchDir('review-tree-xdg-') }

function run(name, input) {
  const r = spawnSync('node', [script(name)], { input: JSON.stringify(input), encoding: 'utf8', env })
  let json = null
  try {
    json = JSON.parse(r.stdout)
  } catch {
    // No output.
  }
  return { json, stdout: r.stdout, decision: json?.hookSpecificOutput?.permissionDecision, reason: json?.hookSpecificOutput?.permissionDecisionReason }
}

const TABLE = '# Feature\n\n## Tasks\n\n| ID | Specs | Task | Route | Risk | Status | Commit |\n|---|---|---|---|---|---|---|\n| T1 | S1 | work | worker | 2 | done | `abc` |\n\n## Log\n\n- 1 | none | x\n'

// feat holds a committed unit (Risk 2); the working tree then adds uncommitted changes.
function dirty() {
  const repo = makeRepo({ 'src/app.js': 'export const a = 1\n' })
  const bare = join(scratchDir('review-tree-remote-'), 'origin.git')
  git(repo, 'clone', '-q', '--bare', repo, bare)
  git(repo, 'remote', 'add', 'origin', bare)
  git(repo, 'fetch', '-q', 'origin')
  git(repo, 'remote', 'set-head', 'origin', 'main')
  git(repo, 'checkout', '-q', '-b', 'feat')
  applyFiles(repo, { '.vault/tasks/f.md': TABLE })
  commitAll(repo, 'doc')
  applyFiles(repo, { 'src/app.js': 'export const a = 2\n', 'src/new.js': 'export const n = 1\n' })
  return repo
}

const spawn = (repo) => run('review-context.mjs', {
  session_id: 's1', cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Agent',
  tool_input: { description: 'lens', prompt: 'Review subject: main', subagent_type: 'construct:review-risk' },
})
const bindingOf = (r) => JSON.parse(r.json.hookSpecificOutput.updatedInput.prompt.split('\n')[0].slice('ODD_REVIEW_BINDING '.length))
const approveWorkingTree = (repo) => {
  const binding = bindingOf(spawn(repo))
  const reply = JSON.stringify({ subject_hash: binding.subject_hash, inspection: { status: 'completed', paths: binding.artifact_subject.changed_path_manifest }, findings: [], evidence: ['read every patch'] })
  run('review-capture.mjs', { session_id: 's1', cwd: repo, hook_event_name: 'SubagentStop', agent_type: 'construct:review-risk', agent_id: 'a1', last_assistant_message: `\`\`\`json\n${reply}\n\`\`\``, stop_hook_active: false })
  return binding
}
const push = (repo) => run('publication-gate.mjs', { session_id: 's1', cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git push origin feat' } })

describe('review of the working tree (S1)', () => {
  test('an uncommitted change is reviewed: its patch is in the context and head_tree is the snapshot', () => {
    const repo = dirty()
    const r = spawn(repo)
    assert.equal(r.decision, 'allow', r.reason)
    const prompt = r.json.hookSpecificOutput.updatedInput.prompt
    const binding = bindingOf(r)
    assert.match(prompt, /\+export const a = 2\n/)
    assert.match(prompt, /\+export const n = 1\n/)
    assert.deepEqual(binding.artifact_subject.changed_path_manifest, ['.vault/tasks/f.md', 'src/app.js', 'src/new.js'])
    git(repo, 'add', '-A')
    const snapshot = git(repo, 'write-tree').trim()
    assert.equal(binding.artifact_subject.candidate_tree, snapshot)
    assert.equal(binding.subject_hash, subjectHash(git(repo, 'rev-parse', 'main^{tree}').trim(), snapshot))
    assert.notEqual(snapshot, git(repo, 'rev-parse', 'HEAD^{tree}').trim())
  })

  test('committing the exact reviewed content keeps the approval: the gate allows the push', () => {
    const repo = dirty()
    assert.equal(push(repo).decision, 'deny')
    const binding = approveWorkingTree(repo)
    assert.equal(readVerdicts(repo, binding.subject_hash)["review-risk"].approved, true)
    commitAll(repo, 'unit')
    assert.equal(git(repo, 'rev-parse', 'HEAD^{tree}').trim(), binding.artifact_subject.candidate_tree)
    assert.equal(push(repo).stdout, '')
  })

  test('committing different content after approval is denied', () => {
    const repo = dirty()
    approveWorkingTree(repo)
    applyFiles(repo, { 'src/app.js': 'export const a = 3\n' })
    commitAll(repo, 'unit')
    assert.equal(push(repo).decision, 'deny')
  })
})
