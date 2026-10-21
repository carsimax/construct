// The lenses each Risk item requires: the single source the publication gate
// and the rdd-review skill quote. review-readability is never required.
export const LENSES_BY_RISK = {
  1: ['review-risk', 'review-resilience'],
  2: ['review-risk'],
  3: ['review-reliability'],
  4: ['review-reliability', 'review-resilience'],
  5: ['review-risk', 'review-resilience'],
  6: ['review-reliability'],
}

// requiredLenses returns the sorted unique lenses for an iterable of risk item numbers; unknown items add none.
export const requiredLenses = (items) => [...new Set([...items].flatMap((item) => LENSES_BY_RISK[item] ?? []))].sort()
