// Reduction of the captured lens findings. Only a finding that is BLOCKER or
// CRITICAL and introduced by the candidate is severe; everything else is
// advisory. Deterministic severe findings need a correction; inferential ones
// go to the refuter first.
const SEVERE = ['BLOCKER', 'CRITICAL']

export function reduceLenses(findings) {
  const severe = findings.filter((finding) => SEVERE.includes(finding.severity) && finding.causal_disposition === 'introduced')
  const deterministic = severe.filter((finding) => finding.evidence_class === 'deterministic')
  const inferential = severe.filter((finding) => finding.evidence_class !== 'deterministic')
  const advisory = findings.filter((finding) => !severe.includes(finding))
  if (deterministic.length > 0) {
    // A deterministic blocker needs no refuter; unrefuted inferential findings
    // stay on record as advisory so the receipt shows them.
    return {
      state: 'correction_required',
      to_correct: deterministic,
      refutation_batch: [],
      advisory: [...advisory, ...inferential.map((finding) => ({ ...finding, refuter_outcome: 'not_refuted' }))],
    }
  }
  if (inferential.length > 0) {
    return {
      state: 'refutation_required',
      to_correct: [],
      refutation_batch: inferential.map((finding) => ({ id: finding.id, location: finding.location, severity: finding.severity, claim: finding.claim, proof_refs: finding.proof_refs })),
      advisory,
    }
  }
  return { state: 'approved', to_correct: [], refutation_batch: [], advisory }
}
