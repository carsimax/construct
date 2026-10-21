// Pure parsers for the command output the band reads.

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

// `git rev-parse --show-toplevel`: the root.
export function parseRevParse(text) {
  if (typeof text !== 'string') return null
  const root = text.split('\n')[0].trim()
  return root ? { root } : null
}
