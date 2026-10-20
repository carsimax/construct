// Agent escalation: the agent that made a change may cite one high-risk item to
// raise the assessed tier to high. It never lowers a tier.
export const HIGH_RISK_ITEMS = {
  1: 'data or irreversible effects',
  2: 'security',
  3: 'contracts others consume',
  4: 'concurrency',
  5: 'delivery or environment',
  6: 'no test would catch a regression',
}

export const ESCALATION_REASON_MAX_BYTES = 500

export class UsageError extends Error {}

// parseEscalation validates --escalate-item and --escalate-reason: both or
// neither, an integer item from 1 to 6, a non-blank reason of at most 500 bytes.
export function parseEscalation(item, reason) {
  const itemGiven = item !== undefined
  const reasonGiven = reason !== undefined
  if (!itemGiven && !reasonGiven) return null
  if (!itemGiven || !reasonGiven) {
    throw new UsageError('--escalate-item and --escalate-reason must be passed together')
  }
  const trimmed = item.trim()
  const number = /^[+-]?\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : Number.NaN
  if (!Object.hasOwn(HIGH_RISK_ITEMS, number)) {
    throw new UsageError(`--escalate-item ${JSON.stringify(item)} must be an integer from 1 to 6 naming a high-risk item`)
  }
  if (reason.trim() === '' || Buffer.byteLength(reason) > ESCALATION_REASON_MAX_BYTES) {
    throw new UsageError(`--escalate-reason must be non-empty and at most ${ESCALATION_REASON_MAX_BYTES} bytes`)
  }
  return { item: number, reason }
}

// escalateRisk raises passive or medium to high and appends the agent_escalation
// reason. A tier is never lowered.
export function escalateRisk(risk, reasons, escalation) {
  if (!escalation) return { risk, reasons }
  return {
    risk: risk === 'passive' || risk === 'medium' ? 'high' : risk,
    reasons: [
      ...reasons,
      { code: 'agent_escalation', detail: `item ${escalation.item} (${HIGH_RISK_ITEMS[escalation.item]}): ${escalation.reason}` },
    ],
  }
}
