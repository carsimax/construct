// odd-assess command: argument handling and orchestration.
import { parseArgs } from 'node:util'
import { assessSnapshotRisk } from './classify.mjs'
import { UsageError, escalateRisk, parseEscalation } from './escalation.mjs'
import { createIsolation, freezeWorkingTree, hasDirtyTrackedChanges, repositoryRoot, resolveTree } from './git.mjs'
import { buildResult, failClosedResult, humanSummary, publicReasons, publicRisk } from './output.mjs'

export const USAGE = `Usage: odd-assess [--cwd DIR] [--base-ref REF] [--committed-only]
                  [--escalate-item N --escalate-reason TEXT] [--json]

Print the deterministic risk tier of a candidate change.
  --cwd DIR            repository path (default: current directory)
  --base-ref REF       assess REF..HEAD (committed changes only); without it the
                       candidate is the current working state against HEAD
  --committed-only     acknowledge that --base-ref ignores dirty tracked changes
  --escalate-item N    raise the tier to high by citing high-risk item 1-6
  --escalate-reason T  one-line reason for --escalate-item (at most 500 bytes)
  --json               print the odd-skills.review-assessment/v1 JSON object
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

// assess computes the public result for a repository and candidate selection.
export function assess({ cwd, baseRef, committedOnly, escalation }) {
  const trimmedBaseRef = (baseRef ?? '').trim()
  const candidate = trimmedBaseRef ? { kind: 'base-diff', baseRef: trimmedBaseRef } : { kind: 'current-changes' }
  let isolation = null
  try {
    const root = repositoryRoot(cwd)
    let baseTree
    let candidateTree
    if (trimmedBaseRef) {
      baseTree = resolveTree(root, trimmedBaseRef)
      if (hasDirtyTrackedChanges(root) && !committedOnly) {
        throw new Error(`--base-ref omits dirty tracked changes; rerun with --committed-only to acknowledge committed-only scope`)
      }
      candidateTree = resolveTree(root, 'HEAD')
    } else {
      ;({ baseTree, candidateTree } = freezeWorkingTree(root))
    }
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
