// Reduction of the captured lens findings.
// - A BLOCKER or CRITICAL with unknown causality cannot be judged by the tool:
//   the review escalates to a human before anything else happens.
// - A severe finding is BLOCKER or CRITICAL introduced by the candidate. All
//   severe findings share one flow: inferential ones go to one refuter batch
//   while deterministic ones are held as confirmed; with no inferential finding
//   the confirmed ones go straight to correction.
// - Everything else (WARNING, SUGGESTION, pre-existing, base-only) is advisory.
const SEVERE = ['BLOCKER', 'CRITICAL']

export const neutral = (finding) => ({ id: finding.id, location: finding.location, severity: finding.severity, claim: finding.claim, proof_refs: finding.proof_refs })

export function reduceLenses(findings) {
  const unknown = findings.filter((finding) => SEVERE.includes(finding.severity) && finding.causal_disposition === 'unknown')
  if (unknown.length > 0) {
    return {
      state: 'escalated',
      confirmed: [],
      to_correct: [],
      refutation_batch: [],
      advisory: findings.filter((finding) => !unknown.includes(finding)),
      escalation: { reason: 'unknown_causality', finding_ids: unknown.map((finding) => finding.id) },
    }
  }
  const severe = findings.filter((finding) => SEVERE.includes(finding.severity) && finding.causal_disposition === 'introduced')
  const confirmed = severe.filter((finding) => finding.evidence_class === 'deterministic')
  const inferential = severe.filter((finding) => finding.evidence_class !== 'deterministic')
  const advisory = findings.filter((finding) => !severe.includes(finding))
  if (inferential.length > 0) {
    return { state: 'refutation_required', confirmed, to_correct: [], refutation_batch: inferential.map(neutral), advisory }
  }
  if (confirmed.length > 0) return { state: 'correction_required', confirmed, to_correct: confirmed, refutation_batch: [], advisory }
  return { state: 'approved', confirmed: [], to_correct: [], refutation_batch: [], advisory }
}
