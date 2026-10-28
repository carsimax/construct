// Re-injects the active ODD feature state after compaction or resume.
// Read-only and fail-open: any problem produces no output and exit code 0.
// Usage: node feature-state.mjs  (SessionStart hook JSON on stdin)
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_DOCS = 3
const MAX_TOTAL = 2500
const MAX_CELL = 160
const MAX_LINE = 200
const FINISHED = new Set(['done', 'dropped'])
// A Status cell is finished when its first word is done or dropped (`done (evidence)`, `Done.`).
const isFinished = (cell) => FINISHED.has(cell.toLowerCase().match(/^[a-z]+/)?.[0] ?? '')

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

// This parser is kept apart from hooks/status/tasks.js on purpose: that file is a
// plain .js the mod loads, and importing it here breaks on Node versions that read
// a .js file without a package "type" as CommonJS. Keep the two in step by hand.
function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').trim())
}

// Returns { rows, taskSpecs } for the `## Tasks` table (rows: unfinished only; taskSpecs: every row's
// [id, Specs cell, Status cell], or null without a `Specs` column), or null when the table is missing or malformed.
export function unfinishedRows(lines) {
  // A Tasks heading of any level 2-6, as publication-gate.mjs reads it; a heading of the same or a higher level ends it.
  const start = lines.findIndex((l) => /^#{2,6}\s+Tasks\b/i.test(l))
  if (start < 0) return null
  const level = lines[start].match(/^#+/)[0].length
  let i = start + 1
  while (i < lines.length && !lines[i].trim().startsWith('|')) {
    if ((lines[i].match(/^(#{1,6})\s/)?.[1].length ?? 7) <= level) return null
    i++
  }
  if (i >= lines.length) return null
  const header = splitRow(lines[i]).map((c) => c.toLowerCase())
  const status = header.indexOf('status')
  const id = header.indexOf('id')
  const task = header.indexOf('task')
  if (status < 0 || id < 0 || task < 0) return null
  if (!/^\|?\s*:?-{3,}/.test(lines[i + 1] ?? '')) return null
  const specs = header.indexOf('specs')
  const rows = []
  const taskSpecs = specs < 0 ? null : []
  for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
    const cells = splitRow(lines[i])
    if (cells.length < header.length) return null
    // An unescaped `|` in the task cell shifts the columns: join the surplus back into it.
    if (cells.length > header.length) cells.splice(task, cells.length - header.length + 1, cells.slice(task, task + cells.length - header.length + 1).join('|'))
    taskSpecs?.push([cells[id], cells[specs] ?? '', cells[status]])
    if (!isFinished(cells[status])) rows.push(`${clip(cells[id], MAX_CELL)} — ${clip(cells[task], MAX_CELL)}`)
  }
  return { rows, taskSpecs }
}

// Spec ids named in a cell: `S1`, `S3, S4`, `S3-S4`, `S3–S4`.
export function specIds(cell) {
  const ids = new Set()
  for (const [, a, b] of cell.matchAll(/S(\d+)\s*[-–]\s*S?(\d+)/g)) for (let n = +a; n <= Math.min(+b, +a + 99); n++) ids.add(n)
  for (const [, n] of cell.replace(/S\d+\s*[-–]\s*S?\d+/g, '').matchAll(/S(\d+)/g)) ids.add(+n)
  return ids
}

// One warning line, or undefined when the document has no `## Specs` or `Specs` column or is fully covered.
function coverageWarning(lines, taskSpecs) {
  const at = lines.findIndex((l) => /^##\s+Specs\s*$/.test(l))
  if (at < 0 || !taskSpecs) return undefined
  const end = lines.findIndex((l, n) => n > at && /^##\s/.test(l))
  const defined = new Set(lines.slice(at + 1, end < 0 ? undefined : end).flatMap((l) => (/^- \*\*S(\d+)/.exec(l) ?? []).slice(1).map(Number)))
  const used = new Set()
  const unknown = []
  for (const [id, cell] of taskSpecs) {
    const bad = [...specIds(cell)].filter((n) => (used.add(n), !defined.has(n)))
    if (bad.length) unknown.push(`${id} names ${bad.map((n) => `S${n}`).join(', ')}`)
  }
  const orphans = [...defined].filter((n) => !used.has(n)).map((n) => `S${n}`)
  const parts = [orphans.length && `no task for ${orphans.join(', ')}`, ...(unknown.length ? [`unknown spec: ${unknown.join('; ')}`] : [])].filter(Boolean)
  return parts.length ? clip(`Coverage: ${parts.join('; ')}`, MAX_LINE) : undefined
}

// The `## Specs` bullets as [id, text] (`- **S2 — ...`, one line each); [] without the section.
function specBullets(lines) {
  const at = lines.findIndex((l) => /^##\s+Specs\s*$/.test(l))
  if (at < 0) return []
  const end = lines.findIndex((l, n) => n > at && /^##\s/.test(l))
  return lines.slice(at + 1, end < 0 ? undefined : end).flatMap((l) => {
    const m = /^- \*\*S(\d+)/.exec(l)
    return m ? [[`S${m[1]}`, l]] : []
  })
}

// Open clarifications: [{ id: 'S2', question }] for each spec bullet carrying `NEEDS CLARIFICATION: <question>`.
// shortcut: the question ends at the end of its bullet line, upgrade if a spec spans lines.
export function openClarifications(lines) {
  return specBullets(lines).flatMap(([id, text]) => {
    // Inline code (`NEEDS CLARIFICATION: <question>`) names the marker; only plain text opens a clarification.
    const m = /NEEDS CLARIFICATION:\s*(.*)$/.exec(text.replace(/`[^`]*`/g, ''))
    return m ? [{ id, question: m[1].trim() }] : []
  })
}

const MAX_OPEN = 3
const squash = (t) => t.replace(/\s+/g, ' ').trim()

// S3 (warn only): a spec passes with `Assumption` or a double-quoted span found, whitespace-normalized, in the `## Log` section.
function unquotedSpecs(lines) {
  const at = lines.findIndex((l) => /^##\s+Log\s*$/.test(l))
  const end = lines.findIndex((l, n) => n > at && /^##\s/.test(l))
  const log = squash(at < 0 ? '' : lines.slice(at + 1, end < 0 ? undefined : end).join('\n'))
  return specBullets(lines).filter(([, text]) => !/\bAssumption\b/.test(text) && ![...text.matchAll(/"([^"]+)"|“([^”]+)”/g)].some((m) => log.includes(squash(m[1] ?? m[2])))).map(([id]) => id)
}

function specLines(lines) {
  const open = openClarifications(lines)
  const bad = unquotedSpecs(lines)
  return [
    ...open.map((c) => clip(`Open clarification ${c.id}: ${c.question}`, MAX_LINE)),
    ...(open.length > MAX_OPEN ? [`Warning: ${open.length} open clarifications, more than ${MAX_OPEN}: ask the user before adding more.`] : []),
    ...(bad.length ? [clip(`Quote warning: ${bad.join(', ')} have no quote found in the Log and no Assumption.`, MAX_LINE)] : []),
  ]
}

// S3: finished feature documents with a `## Specs` section and no `.vault/specs/<feature>.md`.
// Without .vault/specs/README.md (it holds `Started:`), or for a document whose L1 date is before its `Started:` line, there is no warning.
function livingSpecLines(root) {
  let spec
  try {
    spec = readFileSync(join(root, '.vault', 'specs', 'README.md'), 'utf8')
  } catch {
    return []
  }
  const started = /^Started:\s*(\d{4}-\d{2}-\d{2})/m.exec(spec)?.[1]
  const missing = []
  for (const name of readdirSync(join(root, '.vault', 'tasks')).sort()) {
    try {
      if (!name.endsWith('.md')) continue
      const lines = readFileSync(join(root, '.vault', 'tasks', name), 'utf8').split(/\r?\n/)
      const table = unfinishedRows(lines)
      const feature = basename(name, '.md')
      if (!table || table.rows.length > 0 || !lines.some((l) => /^##\s+Specs\s*$/.test(l)) || existsSync(join(root, '.vault', 'specs', name))) continue
      // `**L1 (2026-10-22, user):**` counts; a document with no L1 date predates the rule and is skipped.
      const l1 = /\*\*L1 \((\d{4}-\d{2}-\d{2})[^)]*\)/.exec(lines.join('\n'))?.[1]
      if (started && (!l1 || l1 < started)) continue
      missing.push(feature)
    } catch {
      // unreadable document: skip it
    }
  }
  return [...missing.slice(0, 3).map((f) => clip(`Living spec: ${f} is finished but .vault/specs/${f}.md is missing; write its S# with their quotes.`, MAX_LINE)), ...(missing.length > 3 ? [`Living spec: ${missing.length - 3} more finished documents have no file in .vault/specs/.`] : [])]
}

// `Branch: x` inside the header line (before the first `##`), reduced to `Branch: x`.
function headerBranch(lines) {
  const end = lines.findIndex((l) => /^##\s/.test(l))
  for (const l of end < 0 ? lines : lines.slice(0, end)) {
    const m = /\bBranch:\s*`?([^\s`]+?)`?\.?(?:\s|$)/.exec(l)
    if (m) return `Branch: ${m[1]}`
  }
  return undefined
}

function parseDoc(root, path) {
  const text = readFileSync(join(root, path), 'utf8')
  const lines = text.split(/\r?\n/)
  const table = unfinishedRows(lines)
  if (!table || table.rows.length === 0) return null
  const { rows, taskSpecs } = table
  const logAt = lines.findIndex((l) => /^##\s+Log\s*$/.test(l))
  const next = logAt < 0 ? undefined : lines.slice(logAt + 1).reverse().find((l) => l.includes('Next step:'))
  const title = lines.find((l) => l.startsWith('# '))
  const branch = lines.find((l) => /^(Tracker branch|Branch):/.test(l)) ?? headerBranch(lines)
  const warning = coverageWarning(lines, taskSpecs)
  return {
    path,
    feature: basename(path, '.md'),
    head: [path, title && clip(title.trim(), MAX_LINE), branch && clip(branch.trim(), MAX_LINE), warning, ...specLines(lines)].filter(Boolean),
    rows,
    next: next && clip(next.trim().replace(/^[-*]\s+/, ''), MAX_LINE),
  }
}

function render(docs, living) {
  const footer = 'Read the full document before continuing.'
  const intro = 'Active ODD feature state (re-injected after compaction or resume):'
  const fixed = docs.map((d) => [...d.head, ...(d.next ? [d.next] : [])].join('\n'))
  const used = [intro, footer, living, ...fixed].join('\n\n').length + docs.length * 2
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
  const text = [intro, ...blocks, ...(living ? [living] : []), footer].join('\n\n')
  return text.length <= MAX_TOTAL ? text : `${text.slice(0, MAX_TOTAL - footer.length - 2)}\n\n${footer}`.slice(0, MAX_TOTAL)
}

// projectRoot is the git top level of cwd, or cwd itself outside a repository.
export function projectRoot(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || cwd
  } catch {
    return cwd
  }
}

// activeDocuments returns the feature documents under <root>/.vault/tasks with an
// unfinished task, newest first: { doc, mtime }. A missing directory throws.
// delegation-admission.mjs reuses it, so "an unfinished feature document
// exists" means the same thing there as for the re-injection.
export function activeDocuments(root) {
  const dir = join(root, '.vault', 'tasks')
  const docs = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue
    const path = `.vault/tasks/${name}`
    try {
      const doc = parseDoc(root, path)
      if (doc) docs.push({ doc, mtime: statSync(join(root, path)).mtimeMs })
    } catch {
      // unreadable document: skip it
    }
  }
  return docs.sort((a, b) => b.mtime - a.mtime)
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
  const root = projectRoot(cwd)
  const docs = activeDocuments(root)
  let living = ''
  try {
    living = livingSpecLines(root).join('\n')
  } catch {
    // fail open: no living-spec warning
  }
  if (docs.length === 0 && !living) return
  const text = docs.length === 0 ? `ODD living spec:\n${living}` : render(docs.slice(0, MAX_DOCS).map((d) => d.doc), living)
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }))
}

// Run only as a script; delegation-admission.mjs imports the helpers above.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  try {
    main()
  } catch {
    // fail open
  }
  process.exit(0)
}
