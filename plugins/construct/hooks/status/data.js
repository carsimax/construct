// Pure parsers for the command output the band reads, and the review-state reduction.

function json(text) {
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

// `git status --porcelain=v2 --branch`: branch, dirty entry count, ahead and behind.
export function parseGitStatus(text) {
  if (typeof text !== 'string' || !text.includes('# branch.')) return null
  let oid = ''
  let head = ''
  let ahead = 0
  let behind = 0
  let dirty = 0
  for (const line of text.split('\n')) {
    if (line === '') continue
    if (!line.startsWith('#')) {
      dirty++
    } else if (line.startsWith('# branch.oid ')) {
      oid = line.slice(13).trim()
    } else if (line.startsWith('# branch.head ')) {
      head = line.slice(14).trim()
    } else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      if (m) [ahead, behind] = [Number(m[1]), Number(m[2])]
    }
  }
  const branch = head === '(detached)' || head === '' ? oid.slice(0, 7) : head
  return branch ? { branch, dirty, ahead, behind } : null
}

const base = (path) => path.replace(/\/+$/, '').split('/').pop()

// `git rev-parse --show-toplevel --git-dir --git-common-dir`: the root, and a worktree name when linked.
export function parseRevParse(text) {
  if (typeof text !== 'string') return null
  const [root, gitDir, common] = text.split('\n').map((l) => l.trim())
  if (!root) return null
  return { root, worktree: gitDir && common && gitDir !== common ? base(root) : null }
}

export function parseMode(text) {
  const mode = json(text)?.mode
  return mode === 'on' || mode === 'off' ? mode : null
}

export function parseBoundary(text) {
  const value = json(text)
  return typeof value?.commit === 'string' && typeof value?.source === 'string' ? { commit: value.commit, source: value.source } : null
}

// One odd-assess result. An empty candidate is clear, not a failure; any other
// `unassessable` result is unknown and the caller leaves it out.
export function parseAssess(text) {
  const value = json(text)
  if (!value) return null
  const failure = Array.isArray(value.reasons) ? value.reasons.find((r) => r?.code === 'unassessable') : undefined
  if (failure) {
    const empty = typeof failure.detail === 'string' && /no pending changes/.test(failure.detail)
    return { due: false, consumed: false, unassessable: !empty }
  }
  const consumed = value.candidate?.consumed === true || value.review_due_reason === 'already_reviewed'
  return { due: value.review_due === true && !consumed, consumed, unassessable: false }
}

// Reduces the assessed candidates: due beats reviewed, reviewed beats clear; null when none is known.
export function reviewState(results) {
  const known = results.filter((r) => r && !r.unassessable)
  if (known.length === 0) return null
  if (known.some((r) => r.due)) return 'review due'
  return known.some((r) => r.consumed) ? 'reviewed' : 'clear'
}
