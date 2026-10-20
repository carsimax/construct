// odd-assess command: argument handling and orchestration.
import { parseArgs } from 'node:util'
import { assessSnapshotRisk } from './classify.mjs'
import { UsageError, escalateRisk, parseEscalation } from './escalation.mjs'
import { createIsolation, freezeWorkingTree, hasDirtyTrackedChanges, repositoryRoot, resolveTree } from './git.mjs'
import { receiptExists } from '../review/store.mjs'
import { targetOf } from '../review/identity.mjs'
import { buildResult, failClosedResult, humanSummary, publicReasons, publicRisk } from './output.mjs'

export const USAGE = `Usage: odd-assess [--cwd DIR] [--base-ref REF] [--committed-only]
                  [--escalate-item N --escalate-reason TEXT] [--json]

Print the deterministic risk tier of a candidate change.
  --cwd DIR            repository path (default: current directory)
  --base-ref REF       assess REF..HEAD (committed changes only); without it the
                       candidate is the current working state against HEAD
  --committed-only     acknowledge that --base-ref ignores dirty tracked changes
                       (requires --base-ref)
  --escalate-item N    raise the tier to high by citing high-risk item 1-6
  --escalate-reason T  one-line reason for --escalate-item (at most 500 bytes)
  --json               print the construct.review-assessment/v1 JSON object

Signals that make a change high include verifier_weakening: an added suppression
(@ts-ignore, @ts-expect-error, @ts-nocheck, eslint-disable, # noqa, # type: ignore,
//nolint) in a source or test file, or an added skip/focus marker (.skip(, .only(,
xit(, xdescribe(, test.todo(, { skip: } / { todo: } unless the value is a number, @pytest.mark.skip, t.Skip()
in a test file.
`

const OPTIONS = {
  cwd: { type: 'string' },
  'base-ref': { type: 'string' },
  'committed-only': { type: 'boolean' },
  'escalate-item': { type: 'string' },
  'escalate-reason': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
}

// requireBaseRefForCommittedOnly: --committed-only only qualifies --base-ref, so
// passing it alone is a usage error instead of being silently ignored.
export function requireBaseRefForCommittedOnly(baseRef, committedOnly) {
  if (committedOnly && (baseRef ?? '').trim() === '') throw new UsageError('--committed-only requires --base-ref')
}

// resolveCandidate freezes the candidate selection into two tree ids: REF..HEAD
// (committed changes only) with --base-ref, otherwise the working state against
// HEAD through a temporary index. Shared by odd-assess and odd-review.
export function resolveCandidate({ cwd, baseRef, committedOnly }) {
  const trimmedBaseRef = (baseRef ?? '').trim()
  const root = repositoryRoot(cwd)
  if (!trimmedBaseRef) return { root, kind: 'current-changes', ...freezeWorkingTree(root) }
  const baseTree = resolveTree(root, trimmedBaseRef)
  if (hasDirtyTrackedChanges(root) && !committedOnly) {
    throw new Error(`--base-ref omits dirty tracked changes; rerun with --committed-only to acknowledge committed-only scope`)
  }
  return { root, kind: 'base-diff', baseRef: trimmedBaseRef, baseTree, candidateTree: resolveTree(root, 'HEAD') }
}

// assess computes the public result for a repository and candidate selection.
export function assess({ cwd, baseRef, committedOnly, escalation }) {
  const trimmedBaseRef = (baseRef ?? '').trim()
  const candidate = trimmedBaseRef ? { kind: 'base-diff', baseRef: trimmedBaseRef } : { kind: 'current-changes' }
  let isolation = null
  try {
    const { root, baseTree, candidateTree } = resolveCandidate({ cwd, baseRef, committedOnly })
    isolation = createIsolation(root)
    const assessment = assessSnapshotRisk({ root, baseTree, candidateTree, isolation })
    if (assessment.changedPaths === 0) {
      throw new Error('the candidate has no pending changes; assess committed work with --base-ref <commit>')
    }
    const escalated = escalateRisk(publicRisk(assessment.level), publicReasons(assessment.reasons), escalation)
    return buildResult({
      risk: escalated.risk,
      reasons: escalated.reasons,
      changedPaths: assessment.changedPaths,
      changedLines: assessment.changedLines,
      candidate,
      consumed: receiptExists(root, targetOf(baseTree, candidateTree, assessment.manifest)),
    })
  } catch (error) {
    return failClosedResult(error, candidate)
  } finally {
    isolation?.cleanup()
  }
}

export function run(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
  let values
  let positionals
  try {
    ;({ values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true }))
    if (positionals.length > 0) throw new UsageError(`unexpected argument ${JSON.stringify(positionals[0])}`)
    if (values.help) {
      stdout.write(USAGE)
      return 0
    }
    const escalation = parseEscalation(values['escalate-item'], values['escalate-reason'])
    requireBaseRefForCommittedOnly(values['base-ref'], values['committed-only'] === true)
    const result = assess({
      cwd: values.cwd ?? '.',
      baseRef: values['base-ref'],
      committedOnly: values['committed-only'] === true,
      escalation,
    })
    stdout.write(values.json ? `${JSON.stringify(result, null, 2)}\n` : humanSummary(result))
    return 0
  } catch (error) {
    stderr.write(`odd-assess: ${error.message}\n\n${USAGE}`)
    return 2
  }
}
