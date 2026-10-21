// odd-review command line: argument handling, exit codes, and output.
//   exit 0  success; JSON on stdout (context prints the evidence text)
//   exit 1  refused transition; {"error":{code,message},"next":[...]} on stderr
//   exit 2  bad usage; message and usage on stderr
import { parseArgs } from 'node:util'
import { repositoryRoot } from '../assess/git.mjs'
import { requireBaseRefForCommittedOnly } from '../assess/cli.mjs'
import { UsageError, parseEscalation } from '../assess/escalation.mjs'
import { goTrimSpace } from '../assess/text.mjs'
import * as commands from './commands.mjs'
import { reviewBoundary } from './boundary.mjs'
import { GATES, validateGate } from './gate.mjs'
import { readMode, readScope, writeMode } from './mode.mjs'
import { DEFAULT_CONTEXT_BYTES } from './evidence.mjs'
import { Refusal } from './errors.mjs'
import { CANONICAL_LENSES, canonicalLens, canonicalLenses } from './identity.mjs'

export const USAGE = `Usage: odd-review [--cwd DIR] <command> [options]

Review lifecycle. State lives under the git common directory (odd-review/), never
in the worktree. Each command prints JSON that names the exact next command.

  start [--lenses LIST --lenses-reason TEXT | --focus LENS | --escalate-item N --escalate-reason TEXT]
        [--base-ref REF [--committed-only]]
        freeze the candidate and open a transaction (LIST: risk,resilience,
        readability,reliability or the review-* names); without --lenses, the
        lenses odd-assess assigns (all four for high risk). --escalate-item
        (1-6, with --escalate-reason) raises the tier to high first, as in
        odd-assess; it cannot be combined with --lenses. --focus LENS gives a
        medium candidate that one lens (a high one keeps all four); it cannot
        be combined with --lenses
  context --lineage L --lens LENS [--max-bytes N]
        print the binding and evidence for one lens (also review-refuter and
        review-validator in their states); default budget ${DEFAULT_CONTEXT_BYTES} bytes
  capture --lineage L --lens LENS --input FILE|-
  capture-refuter --lineage L --input FILE|-
  capture-unachievable --lineage L --lens LENS --reason TEXT
        a selected lens cannot run: the review escalates to a human decision
  correct --lineage L [--base-ref REF]       the one bounded correction (budget
        min(200, ceil(lines/2)), at least 2); a second one escalates
  capture-validation --lineage L --input FILE|-
        an inconclusive outcome may be captured again, up to 3 attempts; unresolved,
        a regression, or the 3rd inconclusive escalates
  status --lineage L                         also counters and, once
        acknowledged, receipt_check (ok, mismatch, legacy, missing, unreadable)
  abandon --lineage L [--reason TEXT]        close an open review for good
  invalidate --lineage L --reason TEXT       close a review no lens has touched
  acknowledge --lineage L                    needs approved; writes the receipt
  boundary                                   last reviewed boundary: {commit, source}
  validate --gate pre-push|pre-pr|release [--base-ref REF] [--head-ref REF] [--tag NAME]
        the publication gate: exit 1 (review_required, JSON on stderr) when RDD
        is on and the committed range being published is review-due (high risk)
        without an approved receipt for its tree whose hashes still match; exit 0
        with {"ok":true,"result":"ok","reason":...} when RDD is off, nothing is
        due (not_due, empty, no_base), or a receipt covers it. The range is
        merge-base(base, head)..head, committed work only: the head is HEAD or
        --head-ref; the base is --base-ref, else the upstream branch (pre-push),
        else the nearest tag before --tag (release), else the default branch
        (origin/HEAD, main, master). A sound receipt inside the range moves its
        start up. There is no pre-commit gate
  mode enable|disable|status [--scope global|clone]
        the RDD switch (clone, then global, then default on)

Counters full_reviews, refuter_batches, fix_batches, scoped_fix_validations, and
final_verifications are one-shot: asking for a second batch of a kind in a live
review makes it escalated. The lifecycle has no final verification step, so that
counter stays 0.

Exit codes: 0 success, 1 refused transition (JSON on stderr), 2 bad usage.
`

const OPTIONS = {
  cwd: { type: 'string' },
  lineage: { type: 'string' },
  lens: { type: 'string' },
  lenses: { type: 'string' },
  'lenses-reason': { type: 'string' },
  'base-ref': { type: 'string' },
  'committed-only': { type: 'boolean' },
  'escalate-item': { type: 'string' },
  'escalate-reason': { type: 'string' },
  focus: { type: 'string' },
  reason: { type: 'string' },
  input: { type: 'string' },
  'max-bytes': { type: 'string' },
  scope: { type: 'string' },
  gate: { type: 'string' },
  'head-ref': { type: 'string' },
  tag: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
}

// Options each command accepts besides --cwd; required ones are checked by the command.
const ACCEPTS = {
  start: ['lenses', 'lenses-reason', 'base-ref', 'committed-only', 'escalate-item', 'escalate-reason', 'focus'],
  context: ['lineage', 'lens', 'max-bytes'],
  capture: ['lineage', 'lens', 'input'],
  'capture-refuter': ['lineage', 'input'],
  correct: ['lineage', 'base-ref'],
  'capture-validation': ['lineage', 'input'],
  'capture-unachievable': ['lineage', 'lens', 'reason'],
  abandon: ['lineage', 'reason'],
  invalidate: ['lineage', 'reason'],
  status: ['lineage'],
  acknowledge: ['lineage'],
  boundary: [],
  validate: ['gate', 'base-ref', 'head-ref', 'tag'],
  mode: ['scope'],
}

const need = (values, ...names) => {
  for (const name of names) if (values[name] === undefined) throw new UsageError(`--${name} is required`)
}

function parseBytes(value) {
  if (value === undefined) return DEFAULT_CONTEXT_BYTES
  if (!/^\d+$/.test(value) || Number(value) === 0) throw new UsageError('--max-bytes must be a positive integer')
  return Number(value)
}

function reasonOf(values) {
  if (goTrimSpace(values.reason) === '') throw new UsageError('--reason must not be blank')
  return values.reason
}

function modeCommand(action, values, root) {
  const scope = values.scope ?? 'global'
  if (!['global', 'clone'].includes(scope)) throw new UsageError('--scope must be global or clone')
  if (!['enable', 'disable', 'status'].includes(action)) throw new UsageError('mode needs enable, disable, or status')
  if (scope === 'clone' && !root) throw new Refusal('not_a_repository', 'the clone scope needs a git repository')
  if (action === 'status') {
    // Without --scope, report the effective switch; with it, report that scope's own setting.
    if (values.scope === undefined) return { json: readMode(root) }
    return { json: { ...readScope(scope, root), effective: readMode(root) } }
  }
  const file = writeMode(scope, action === 'enable' ? 'on' : 'off', { root })
  return { json: { ...readMode(root), scope, file } }
}

function dispatch(command, values, root) {
  const cwd = values.cwd
  const common = { root, cwd, lineage: values.lineage }
  switch (command) {
    case 'start': {
      // Both or neither: without them, start takes the assessment's lenses.
      if (values.lenses !== undefined || values['lenses-reason'] !== undefined) need(values, 'lenses', 'lenses-reason')
      const escalation = parseEscalation(values['escalate-item'], values['escalate-reason'])
      if (escalation && values.lenses !== undefined) throw new UsageError('--escalate-item cannot be combined with --lenses')
      if (values.focus !== undefined && values.lenses !== undefined) throw new UsageError('--focus cannot be combined with --lenses')
      let focus = null
      if (values.focus !== undefined) {
        focus = canonicalLens(values.focus)
        if (!focus) throw new UsageError(`unknown focus ${JSON.stringify(values.focus)}; use ${CANONICAL_LENSES.join(', ')} or the short names`)
      }
      requireBaseRefForCommittedOnly(values['base-ref'], values['committed-only'] === true)
      let lenses = null
      if (values.lenses !== undefined) {
        if (goTrimSpace(values['lenses-reason']) === '') throw new UsageError('--lenses-reason must not be blank')
        const parsed = canonicalLenses(values.lenses)
        if (parsed.error) throw new UsageError(parsed.error)
        lenses = parsed.lenses
      }
      return { json: commands.start({ root, cwd, baseRef: values['base-ref'], committedOnly: values['committed-only'] === true, lenses, lensesReason: values['lenses-reason'], escalation, focus }) }
    }
    case 'context':
      need(values, 'lineage', 'lens')
      return { text: commands.context({ ...common, lens: values.lens, maxBytes: parseBytes(values['max-bytes']) }) }
    case 'capture':
      need(values, 'lineage', 'lens', 'input')
      return { json: commands.capture({ ...common, lens: values.lens, input: values.input }) }
    case 'capture-refuter':
      need(values, 'lineage', 'input')
      return { json: commands.captureRefuter({ ...common, input: values.input }) }
    case 'correct':
      need(values, 'lineage')
      return { json: commands.correct({ ...common, baseRef: values['base-ref'] }) }
    case 'capture-validation':
      need(values, 'lineage', 'input')
      return { json: commands.captureValidation({ ...common, input: values.input }) }
    case 'capture-unachievable':
      need(values, 'lineage', 'lens', 'reason')
      return { json: commands.captureUnachievable({ ...common, lens: values.lens, reason: reasonOf(values) }) }
    case 'abandon':
      need(values, 'lineage')
      return { json: commands.abandon({ ...common, reason: values.reason }) }
    case 'invalidate':
      need(values, 'lineage', 'reason')
      return { json: commands.invalidate({ ...common, reason: reasonOf(values) }) }
    case 'validate':
      need(values, 'gate')
      if (!GATES.includes(values.gate)) throw new UsageError(`--gate must be one of ${GATES.join(', ')}; there is no pre-commit gate`)
      if (values.tag !== undefined && values.gate !== 'release') throw new UsageError('--tag applies to the release gate only')
      return { json: validateGate({ root, gate: values.gate, baseRef: values['base-ref'], headRef: values['head-ref'], tag: values.tag }) }
    case 'boundary':
      return { json: reviewBoundary(root) }
    case 'status':
      need(values, 'lineage')
      return { json: commands.status(common) }
    default:
      need(values, 'lineage')
      return { json: commands.acknowledge(common) }
  }
}

export function run(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
  let parsed
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true })
  } catch (error) {
    stderr.write(`odd-review: ${error.message}\n\n${USAGE}`)
    return 2
  }
  const { values, positionals } = parsed
  if (values.help) {
    stdout.write(USAGE)
    return 0
  }
  try {
    const [command, ...rest] = positionals
    if (!command || !Object.hasOwn(ACCEPTS, command)) {
      throw new UsageError(command ? `unknown command ${JSON.stringify(command)}` : 'a command is required')
    }
    if (command === 'mode') {
      if (rest.length > 1) throw new UsageError(`unexpected argument ${JSON.stringify(rest[1])}`)
    } else if (rest.length > 0) {
      throw new UsageError(`unexpected argument ${JSON.stringify(rest[0])}`)
    }
    for (const name of Object.keys(values)) {
      if (name !== 'cwd' && !ACCEPTS[command].includes(name)) throw new UsageError(`--${name} does not apply to ${command}`)
    }
    let root
    try {
      root = repositoryRoot(values.cwd ?? '.')
    } catch (error) {
      // The global switch works anywhere; every other command needs a repository.
      if (command !== 'mode') throw new Refusal('not_a_repository', error.message)
      root = null
    }
    const out = command === 'mode' ? modeCommand(rest[0], values, root) : dispatch(command, values, root)
    stdout.write(out.text ?? `${JSON.stringify(out.json, null, 2)}\n`)
    return 0
  } catch (error) {
    if (error instanceof UsageError) {
      stderr.write(`odd-review: ${error.message}\n\n${USAGE}`)
      return 2
    }
    const refusal = error instanceof Refusal ? error : new Refusal('internal_error', error.message)
    stderr.write(`${JSON.stringify({ error: { code: refusal.code, message: refusal.message, ...refusal.extra } }, null, 2)}\n`)
    return 1
  }
}
