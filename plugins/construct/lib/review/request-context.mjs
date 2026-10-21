// The request or spec text a review freezes at start, so every lens sees what the change was meant to do.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Refusal } from './errors.mjs'

// shortcut: fixed 32 KiB cap, a spec block is a few KiB and the 400 KiB context budget must stay for patches; raise it if real specs outgrow it.
export const MAX_REQUEST_CONTEXT_BYTES = 32 * 1024

export function readRequestContext(file) {
  let raw
  try {
    raw = readFileSync(file)
  } catch (error) {
    throw new Refusal('request_context_unreadable', `cannot read the request context from ${file}: ${error.message}`)
  }
  if (raw.length > MAX_REQUEST_CONTEXT_BYTES) {
    throw new Refusal('request_context_too_large', `the request context is ${raw.length} bytes, above the ${MAX_REQUEST_CONTEXT_BYTES} byte cap; pass only the relevant specs`, { bytes: raw.length, max_bytes: MAX_REQUEST_CONTEXT_BYTES })
  }
  const text = raw.toString('utf8')
  if (text.trim() === '') throw new Refusal('request_context_empty', `the request context ${file} is blank`)
  // Patches cannot forge framing (every git diff line starts with a diff marker); raw spec text can, so a line-initial sentinel is refused.
  if (/^ODD_REVIEW_/m.test(text)) throw new Refusal('request_context_framing', `the request context ${file} has a line starting with ODD_REVIEW_, which could forge the review framing; reword or indent that line`)
  return { text, sha256: createHash('sha256').update(raw).digest('hex') }
}
