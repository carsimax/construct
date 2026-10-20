// Re-injects the active ODD feature state after compaction or resume.
// Read-only and fail-open: any problem produces no output and exit code 0.
// Usage: node feature-state.mjs  (SessionStart hook JSON on stdin)
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

const MAX_DOCS = 3
const MAX_TOTAL = 2500
const MAX_CELL = 160
const MAX_LINE = 200
const FINISHED = new Set(['done', 'dropped'])

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').trim())
}

// Returns the unfinished rows of the `## Tasks` table, or null when the table is missing or malformed.
function unfinishedRows(lines) {
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
  const id = header.indexOf('id')
  const task = header.indexOf('task')
  if (status < 0 || id < 0 || task < 0) return null
  if (!/^\|?\s*:?-{3,}/.test(lines[i + 1] ?? '')) return null
  const rows = []
  for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
    const cells = splitRow(lines[i])
    if (cells.length < header.length) return null
    if (!FINISHED.has(cells[status].toLowerCase())) rows.push(`${clip(cells[id], MAX_CELL)} — ${clip(cells[task], MAX_CELL)}`)
  }
  return rows
}

function parseDoc(root, path) {
  const text = readFileSync(join(root, path), 'utf8')
  const lines = text.split(/\r?\n/)
  const rows = unfinishedRows(lines)
  if (!rows || rows.length === 0) return null
  const logAt = lines.findIndex((l) => /^##\s+Log\s*$/.test(l))
  const next = logAt < 0 ? undefined : lines.slice(logAt + 1).reverse().find((l) => l.includes('Next step:'))
  const title = lines.find((l) => l.startsWith('# '))
  const branch = lines.find((l) => /^(Tracker branch|Branch):/.test(l))
  return {
    path,
    feature: basename(path, '.md'),
    head: [path, title && clip(title.trim(), MAX_LINE), branch && clip(branch.trim(), MAX_LINE)].filter(Boolean),
    rows,
    next: next && clip(next.trim().replace(/^[-*]\s+/, ''), MAX_LINE),
  }
}

function render(docs) {
  const topics = docs.map((d) => `\`odd/${d.feature}/tasks\``).join(', ')
  const footer = `Read the full document before continuing; the engram mirror is under topic ${topics}.`
  const intro = 'Active ODD feature state (re-injected after compaction or resume):'
  const fixed = docs.map((d) => [...d.head, ...(d.next ? [d.next] : [])].join('\n'))
  const used = [intro, footer, ...fixed].join('\n\n').length + docs.length * 2
  const budget = Math.max(0, Math.floor((MAX_TOTAL - used) / docs.length))
  const blocks = docs.map((d, n) => {
    const kept = []
    let size = 0
    for (const row of d.rows) {
      const line = `- ${row}`
      if (size + line.length + 1 > budget - 20) break
      kept.push(line)
      size += line.length + 1
    }
    const hidden = d.rows.length - kept.length
    if (hidden > 0) kept.push(`- (+${hidden} more unfinished)`)
    return [...d.head, ...kept, ...(d.next ? [d.next] : [])].join('\n')
  })
  const text = [intro, ...blocks, footer].join('\n\n')
  return text.length <= MAX_TOTAL ? text : `${text.slice(0, MAX_TOTAL - footer.length - 2)}\n\n${footer}`.slice(0, MAX_TOTAL)
}

function main() {
  let input
  try {
    input = JSON.parse(readFileSync(0, 'utf8') || '{}')
  } catch {
    return
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd()
  let root = cwd
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || cwd
  } catch {
    // not a repository: fall back to cwd
  }
  const dir = join(root, 'odd', 'tasks')
  const docs = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue
    const path = `odd/tasks/${name}`
    try {
      const doc = parseDoc(root, path)
      if (doc) docs.push({ doc, mtime: statSync(join(root, path)).mtimeMs })
    } catch {
      // unreadable document: skip it
    }
  }
  if (docs.length === 0) return
  docs.sort((a, b) => b.mtime - a.mtime)
  const text = render(docs.slice(0, MAX_DOCS).map((d) => d.doc))
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }))
}

try {
  main()
} catch {
  // fail open
}
process.exit(0)
