// Pure parsers for the command output the band reads, and the review-state reduction.

function json(text) {
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

// A git path as plain text: C-style quotes undone (quotes and backslashes; octal escapes stay as
// written) and control characters dropped, so a path cannot move the cursor or inject escapes.
function cleanPath(raw) {
  let path = raw
  if (path.length >= 2 && path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1).replace(/\\(["\\])/g, '$1')
  // eslint-disable-next-line no-control-regex
  return path.replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
}

// `git status --porcelain=v2 --branch`: branch, dirty entry count, ahead and behind, and the
// untracked paths (`? <path>` entries; a directory ends in `/`).
export function parseGitStatus(text) {
  if (typeof text !== 'string' || !text.includes('# branch.')) return null
  let oid = ''
  let head = ''
  let ahead = 0
  let behind = 0
  let dirty = 0
  const untracked = []
  for (const line of text.split('\n')) {
    if (line === '') continue
    if (!line.startsWith('#')) {
      dirty++
      if (line.startsWith('? ')) {
        const path = cleanPath(line.slice(2))
        if (path !== '') untracked.push(path)
      }
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
  return branch ? { branch, dirty, ahead, behind, untracked } : null
}

// `git diff --numstat`: one `<added>\t<removed>\t<path>` row per file; a binary file is `-\t-`.
// Rows that do not have that shape are skipped. Use `--no-renames` so every path is one name.
export function parseNumstat(text) {
  if (typeof text !== 'string') return []
  const files = []
  for (const line of text.split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line)
    if (!m) continue
    const path = cleanPath(m[3])
    if (path === '') continue
    const binary = m[1] === '-' || m[2] === '-'
    files.push({ path, added: binary ? null : Number(m[1]), removed: binary ? null : Number(m[2]), binary })
  }
  return files
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
