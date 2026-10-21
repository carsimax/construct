// Finding admission against the frozen candidate diff
// (upstream reviewtransaction/artifact_admission.go:505-682).
import { git } from '../assess/git.mjs'

// changedRanges maps each changed path to the [start, end] new-side line ranges
// of the frozen base->candidate diff. A path with no hunk (binary, mode-only)
// maps to null: its lines cannot be derived, so a claim there is never downgraded
// (upstream refuses instead when derivation is degraded, :640-655).
export function changedRanges(root, baseTree, candidateTree, isolation) {
  const out = git(root, ['diff', '-U0', '--no-ext-diff', '--no-textconv', '--no-renames', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', baseTree, candidateTree, '--'], { env: isolation.env }).toString('utf8')
  const ranges = new Map()
  let current = null
  for (const raw of out.split('\n')) {
    // shortcut: a path containing " b/" or quoted by git (odd bytes) is mis-parsed, so its lines read as unknown; upgrade with -z parsing if that matters.
    const header = /^diff --git a\/(.*) b\/(.*)$/.exec(raw)
    if (header) {
      current = header[2]
      ranges.set(current, null)
      continue
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(raw)
    if (hunk && current !== null) {
      const start = Number(hunk[1])
      const count = hunk[2] === undefined ? 1 : Number(hunk[2])
      // shortcut: a pure deletion counts as touching the line it leaves behind and the next one.
      const range = count === 0 ? [start, start + 1] : [start, start + count - 1]
      ranges.set(current, [...(ranges.get(current) ?? []), range])
    }
  }
  return ranges
}

// touchesChange is true when the finding's location overlaps a changed line, or
// when the changed lines of its path are unknown.
export function touchesChange(location, ranges) {
  const [, path, from, to] = /^(.+):(\d+)(?:-(\d+))?$/.exec(location)
  const list = ranges.get(path)
  if (list === null || list === undefined) return true
  const start = Number(from)
  const end = Number(to ?? from)
  return list.some(([a, b]) => start <= b && end >= a)
}
