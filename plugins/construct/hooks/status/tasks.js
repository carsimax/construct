// Active ODD feature, by the rule of hooks/scripts/feature-state.mjs: a document
// counts when its `## Tasks` table is well formed and holds a row whose status
// is not `done` or `dropped`.
const FINISHED = new Set(['done', 'dropped'])

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').trim())
}

// Finished when the first word is done or dropped (`done (evidence)`, `Done.`).
const isFinished = (cell) => FINISHED.has(cell.toLowerCase().match(/^[a-z]+/)?.[0] ?? '')

// { open, first } of the Tasks table: the unfinished row count and the first
// unfinished row's { id, title } (null when none), or null when the table is
// missing or malformed.
function scanTasks(markdown) {
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
  const idCol = header.indexOf('id')
  const titleCol = header.indexOf('task')
  if (status < 0 || idCol < 0 || titleCol < 0) return null
  if (!/^\|?\s*:?-{3,}/.test(lines[i + 1] ?? '')) return null
  let open = 0
  let first = null
  const tasks = []
  for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
    const cells = splitRow(lines[i])
    if (cells.length < header.length) return null
    // An unescaped `|` in the task cell shifts the columns: join the surplus cells into it.
    const extra = cells.length - header.length
    if (extra > 0) cells.splice(titleCol, extra + 1, cells.slice(titleCol, titleCol + extra + 1).join('|'))
    tasks.push({ id: cells[idCol], done: isFinished(cells[status]) })
    if (!isFinished(cells[status])) {
      open++
      first ??= { id: cells[idCol], title: cells[titleCol] }
    }
  }
  return { open, first, tasks }
}

function newest(docs) {
  let best = null
  for (const doc of docs) {
    if (typeof doc?.name !== 'string' || !doc.name.endsWith('.md')) continue
    let scan
    try {
      scan = scanTasks(doc.text)
    } catch {
      continue
    }
    if (!scan?.open) continue
    if (best === null || doc.mtimeMs > best.mtimeMs) best = { mtimeMs: doc.mtimeMs, feature: doc.name.slice(0, -3), open: scan.open, task: scan.first, tasks: scan.tasks.map(({ id, done }) => ({ id, done })) }
  }
  return best
}

// The newest document (by mtime) that still has unfinished tasks, with its first unfinished
// task and every task row, as
// { feature, open, task: { id, title }, tasks: [{ id, done }] }, or null.
export function activeWork(docs) {
  const best = newest(docs)
  return best ? { feature: best.feature, open: best.open, task: best.task, tasks: best.tasks } : null
}
