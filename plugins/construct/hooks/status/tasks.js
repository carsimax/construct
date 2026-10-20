// Active ODD feature, by the rule of hooks/scripts/feature-state.mjs: a document
// counts when its `## Tasks` table is well formed and holds a row whose status
// is not `done` or `dropped`. A mod cannot import that script (it needs Node),
// so the rule is restated here.
const FINISHED = new Set(['done', 'dropped'])

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').trim())
}

// Number of unfinished rows, or null when the table is missing or malformed.
export function unfinishedCount(markdown) {
  const lines = String(markdown).split(/\r?\n/)
  const start = lines.findIndex((l) => /^##\s+Tasks\s*$/.test(l))
  if (start < 0) return null
  let i = start + 1
  while (i < lines.length && !lines[i].trim().startsWith('|')) {
    if (/^##\s/.test(lines[i])) return null
    i++
  }
  if (i >= lines.length) return null
  const header = splitRow(lines[i]).map((c) => c.toLowerCase())
  const status = header.indexOf('status')
  if (status < 0 || header.indexOf('id') < 0 || header.indexOf('task') < 0) return null
  if (!/^\|?\s*:?-{3,}/.test(lines[i + 1] ?? '')) return null
  let open = 0
  for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
    const cells = splitRow(lines[i])
    if (cells.length < header.length) return null
    if (!FINISHED.has(cells[status].toLowerCase())) open++
  }
  return open
}

// The newest document (by mtime) that still has unfinished tasks: { feature, open }, or null.
export function activeFeature(docs) {
  let best = null
  for (const doc of docs) {
    if (typeof doc?.name !== 'string' || !doc.name.endsWith('.md')) continue
    let open
    try {
      open = unfinishedCount(doc.text)
    } catch {
      continue
    }
    if (!open) continue
    if (best === null || doc.mtimeMs > best.mtimeMs) best = { mtimeMs: doc.mtimeMs, feature: doc.name.slice(0, -3), open }
  }
  return best ? { feature: best.feature, open: best.open } : null
}
