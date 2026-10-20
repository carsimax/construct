// The odd-skills.review-assessment/v1 envelope and its human summary.
export const SCHEMA = 'odd-skills.review-assessment/v1'

export const CANONICAL_LENSES = ['review-risk', 'review-resilience', 'review-readability', 'review-reliability']

const PUBLIC_RISK = { low: 'passive', medium: 'medium', high: 'high' }

export function publicRisk(level) {
  if (!Object.hasOwn(PUBLIC_RISK, level)) throw new Error(`unsupported risk level ${JSON.stringify(level)}`)
  return PUBLIC_RISK[level]
}

// publicReasons folds the signal and mode-change evidence into a detail string.
export function publicReasons(reasons) {
  return reasons.map((reason) => {
    const detail = []
    if (reason.signal) detail.push(`signal: ${reason.signal}`)
    if (reason.oldMode || reason.newMode) detail.push(`mode ${reason.oldMode ?? ''} -> ${reason.newMode ?? ''}`)
    const out = { code: reason.code }
    if (reason.path) out.path = reason.path
    if (detail.length > 0) out.detail = detail.join('; ')
    else if (reason.detail) out.detail = reason.detail
    return out
  })
}

// reviewDue: automatic review is for high risk only. Medium is covered by
// verification and passive needs none. already_reviewed is never produced until
// receipts exist.
export function reviewDue(risk) {
  if (risk === 'high') return { review_due: true, review_due_reason: 'high_risk' }
  if (risk === 'medium') return { review_due: false, review_due_reason: 'under_budget' }
  return { review_due: false, review_due_reason: 'passive' }
}

// lensesFor: zero lenses for passive, the agent picks one for medium, all four
// canonical lenses for high.
export const lensesFor = (risk) => (risk === 'high' ? [...CANONICAL_LENSES] : [])

export function buildResult({ risk, reasons, changedPaths, changedLines, candidate }) {
  return {
    schema: SCHEMA,
    risk,
    reasons,
    changed_paths: changedPaths,
    changed_lines: changedLines,
    candidate: { kind: candidate.kind, ...(candidate.baseRef ? { base_ref: candidate.baseRef } : {}), consumed: false },
    ...reviewDue(risk),
    lenses: lensesFor(risk),
  }
}

// failClosedResult is the answer for any internal error: the caller must treat
// an unassessable candidate exactly like a high one.
export function failClosedResult(error, candidate) {
  const message = String(error?.message ?? error).split('\n')[0].slice(0, 500)
  return buildResult({ risk: 'high', reasons: [{ code: 'unassessable', detail: message }], changedPaths: 0, changedLines: 0, candidate })
}

export function humanSummary(result) {
  const candidate = result.candidate.base_ref ? `${result.candidate.kind} (base-ref ${result.candidate.base_ref})` : result.candidate.kind
  const lines = [
    `Risk: ${result.risk}`,
    `Candidate: ${candidate}`,
    `Changed paths: ${result.changed_paths}`,
    `Changed lines: ${result.changed_lines}`,
    `review due: ${result.review_due ? 'yes' : 'no'} (${result.review_due_reason})`,
  ]
  if (result.lenses.length > 0) lines.push(`Lenses: ${result.lenses.join(', ')}`)
  if (result.reasons.length > 0) {
    lines.push('Reasons:')
    for (const reason of result.reasons) {
      lines.push(`  - ${reason.code}${reason.path ? ` (${reason.path})` : ''}${reason.detail ? `: ${reason.detail}` : ''}`)
    }
  }
  return `${lines.join('\n')}\n`
}
