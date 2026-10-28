// PreToolUse hook on Agent: a construct:review-* lens gets its whole context
// from here, so the orchestrator never pastes evidence. The prompt names the
// subject with one line, `Review subject: <base>` (the head is HEAD). The hook builds the binding, name-status, numstat, per-path
// patches (a deleted or vendored path is listed with a marker, not its content; plus the
// security checklist for review-risk) from the two trees, replaces the
// prompt with it, and records the pending lens for review-capture.mjs. A review
// agent it cannot prepare is denied; other agents pass untouched, errors for
// them fail open.
// Usage: node review-context.mjs   (hook JSON on stdin)
import { readFileSync } from 'node:fs'
import { git, repositoryRoot } from './git-tree.mjs'
import { readInput } from './hook-io.mjs'
import { lensOf } from './roles.mjs'
import { subjectHash, writePending } from './review-store.mjs'

const SUBJECT_LINE = /^Review subject: (\S+)[ \t]*$/m
const CHECKLIST = new URL('../../skills/review/references/security-checklist.md', import.meta.url)
const MAX_CONTEXT_BYTES = 400 * 1024
const DIFF_FLAGS = ['--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--ignore-submodules=none']
const FORM = 'Review subject: <base>'
// Paths from `git diff -z` are repository-relative, so an exact prefix match is enough.
const VENDOR_DIR = 'plugins/construct/hooks/vendor/'

const decide = (permissionDecision, extra) =>
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, ...extra } })}\n`)
const deny = (reason) => decide('deny', { permissionDecisionReason: reason })
const out = (root, args) => git(root, args).toString('utf8')
const withNewline = (text) => (text.endsWith('\n') ? text : `${text}\n`)

async function buildContext(root, lens, base, head) {
  const baseTree = out(root, ['rev-parse', '--verify', `${base}^{tree}`]).trim()
  const headTree = out(root, ['rev-parse', '--verify', `${head}^{tree}`]).trim()
  const subject = subjectHash(baseTree, headTree)
  const records = out(root, ['diff', '--name-status', '-z', ...DIFF_FLAGS, baseTree, headTree, '--']).split('\0')
  const nameStatus = []
  for (let i = 0; i + 1 < records.length; i += 2) nameStatus.push({ status: records[i], path: records[i + 1] })
  const manifest = nameStatus.map((entry) => entry.path)
  if (manifest.length === 0) throw new Error(`${base} and ${head} have the same tree: nothing to review`)
  const numstat = out(root, ['diff', '--numstat', '-z', ...DIFF_FLAGS, baseTree, headTree, '--'])
    .split('\0')
    .filter(Boolean)
    .map((line) => line.split('\t').slice(0, 3).join('\t'))
  const binding = { lens, subject_hash: subject, artifact_subject: { subject_hash: subject, base_tree: baseTree, candidate_tree: headTree, changed_path_manifest: manifest } }
  let text = [
    `ODD_REVIEW_BINDING ${JSON.stringify(binding)}`,
    'ODD_REVIEW_CONTEXT',
    `base_tree: ${baseTree}`,
    `candidate_tree: ${headTree}`,
    'name-status:',
    ...nameStatus.map((entry) => `${entry.status}\t${entry.path}`),
    'numstat:',
    ...numstat,
  ].join('\n') + '\n'
  const SPLIT = 'split the delivery into smaller pull requests, each under the budget'
  let bytes = Buffer.byteLength(text)
  for (const [index, path] of manifest.entries()) {
    // A deleted file's body is noise to a reviewer and can alone exceed the budget.
    const patch = nameStatus[index].status.startsWith('D')
      ? 'deleted; content omitted\n'
      : path.startsWith(VENDOR_DIR)
        ? 'vendored; content omitted; its sha256 is pinned by tests/band-license.test.mjs\n'
        : withNewline(out(root, ['diff', ...DIFF_FLAGS, baseTree, headTree, '--', `:(literal)${path}`]))
    const chunk = `ODD_REVIEW_PATH ${JSON.stringify({ index, path })}\n${patch}ODD_REVIEW_PATH_END ${index}\n`
    text += chunk
    bytes += Buffer.byteLength(chunk)
    // Stop at the first path past the budget: one diff per path is what makes a huge subject slow.
    if (bytes > MAX_CONTEXT_BYTES) throw new Error(`the review context passed the ${MAX_CONTEXT_BYTES} byte budget at path ${index + 1} of ${manifest.length}; ${SPLIT}`)
  }
  if (lens === 'review-risk') text += `ODD_REVIEW_CHECKLIST_BEGIN\n${withNewline(readFileSync(CHECKLIST, 'utf8'))}ODD_REVIEW_CHECKLIST_END\n`
  text += 'ODD_REVIEW_CONTEXT_END\n'
  bytes = Buffer.byteLength(text)
  if (bytes > MAX_CONTEXT_BYTES) throw new Error(`the review context is ${bytes} bytes, above the ${MAX_CONTEXT_BYTES} byte budget; ${SPLIT}`)
  return { text, subject, manifest, baseTree, headTree }
}

async function main() {
  const input = readInput()
  const toolInput = input?.tool_input
  if (input?.tool_name !== 'Agent' || typeof toolInput?.prompt !== 'string') return
  const lens = lensOf(toolInput.subagent_type)
  if (!lens) return
  const agent = toolInput.subagent_type
  const base = SUBJECT_LINE.exec(toolInput.prompt)?.[1]
  const head = 'HEAD'
  if (base?.includes('..')) {
    deny(`${agent} was given a range (${base}): the \`<base>..<head>\` form was removed. Review the whole branch from the merge-base with the default branch, with one line \`${FORM}\`.`)
    return
  }
  if (!base || base.startsWith('-')) {
    deny(`${agent} needs its subject: put one line \`${FORM}\` in the prompt (the head is HEAD), and this hook injects the evidence.`)
    return
  }
  try {
    const root = repositoryRoot(input.cwd)
    git(root, ['rev-parse', '--verify', '-q', `${base}^{commit}`])
    git(root, ['rev-parse', '--verify', '-q', `${head}^{commit}`])
    const { text, subject, manifest, baseTree, headTree } = await buildContext(root, lens, base, head)
    writePending(root, { lens, subject_hash: subject, base_tree: baseTree, head_tree: headTree, manifest, session_id: input.session_id, attempts: 0, at: Date.now() })
    decide('allow', { permissionDecisionReason: `construct: injected the review context for ${lens}`, updatedInput: { ...toolInput, prompt: text } })
  } catch (error) {
    deny(`${agent} could not be prepared: ${error.message}. Use \`${FORM}\` naming a ref that resolves in this repository, with at least one commit on HEAD.`)
  }
}

try {
  await main()
} catch {
  // Fail open for anything that is not a review agent: no output, exit 0.
}
process.exitCode = 0
