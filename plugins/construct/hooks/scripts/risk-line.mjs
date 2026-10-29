// Risk line gate. `mark` (UserPromptSubmit) records a fingerprint of the working state at the
// start of a turn (kept across repeated events of the same prompt_id) and prints nothing, because stdout
// would enter the model's context. The fingerprint is `git status --porcelain=v1 -z --untracked-files=all`
// plus the size and mtime of each listed path (a missing path is recorded as deleted), so no file is hashed.
// `check` (Stop) blocks the stop once per turn when paths outside .vault/tasks/ changed (entries that
// differ between the mark and now, or exist in only one) and the final message has no Risk line, or
// when the changed paths add a skipped, focused, or stub test marker or a TODO comment (whole-line or
// trailing after code; `git diff` over the changed paths only, untracked files read directly).
// It fails open: any error, and every uncertain state (an old record with `tree` and no
// fingerprint included), means no output and exit 0.
// shortcut: a same-size rewrite with a restored mtime of a path already dirty at the mark is missed, upgrade by hashing the listed paths if it bites.
// Usage: node risk-line.mjs mark|check   (hook JSON on stdin)
import { lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataDir, hasOpenSubagents, pruneState, readInput, safeName } from './hook-io.mjs'

const MAX_PATHS = 3
// Code-shaped markers of a weakened verifier, matched on one added line. The test markers and a
// whole-line TODO are anchored to the line start, so a string literal in a fixture does not match them;
// a trailing TODO is not anchored, so a string literal containing ` // TODO` can match (see the TODO shortcut).
// shortcut: a template-literal fixture whose line starts with a marker still matches, upgrade with a real parser if it bites.
const MARKERS = [
  /^\s*(?:it|test|describe|context)\.(?:skip|only|todo)\(/,
  /^\s*x(?:it|describe)\(/,
  /^\s*(?:it|test|describe)\(.*\{\s*[^}]*\b(?:skip|only|todo)\s*:\s*true/,
  /^\s*@pytest\.mark\.skip(?!if)/,
  /^\s*t\.(?:Skip\(|Skipf\(|SkipNow\()/,
  /^\s*raise NotImplementedError/,
  /^\s*throw new Error\(['"`]Not implemented/,
]
// A comment-line TODO, or a trailing one: code, whitespace, `//` or `#`, then TODO (so `http://x`, `a#TODO` stay silent).
// shortcut: a string literal containing ` // TODO` may match, upgrade with a real parser if it bites.
const TODO = /^\s*(?:\/\/|#|\/\*|\*|--)\s*TODO\b|\S\s+(?:\/\/|#)\s*TODO\b/
// Optional list marker (-, *, +, 1., 1)) and emphasis around the label and the
// value, then `none`, `item 1-6`, or `items 2, 5` that ends the line or is followed by
// whitespace or `(`; the space after the colon is optional.
const RISK_LINE = /^[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)?[*_`]*Risk[*_`]*:[*_`]*[ \t]*[*_`]*(?:none|items? [1-6](?:,[ \t]*[1-6])*)[*_`]*(?=$|\s|\()/m

// A path whose marker scan reads the file (untracked) is skipped above this size.
const MAX_SCAN_BYTES = 1024 * 1024

// fingerprint maps each path git status lists to `<XY> <size> <mtimeMs>` (`<XY> deleted` when it is gone).
// A rename or copy lists its source too, so both ends count as changed.
function fingerprint(git, root, timeout) {
  const out = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { timeout }).toString('utf8').split('\0')
  const map = {}
  const stat = (path, code) => {
    try {
      const st = lstatSync(join(root, path))
      map[path] = `${code} ${st.size} ${st.mtimeMs}`
    } catch {
      map[path] = `${code} deleted`
    }
  }
  for (let i = 0; i < out.length; i++) {
    const entry = out[i]
    if (entry.length < 4) continue
    const code = entry.slice(0, 2)
    stat(entry.slice(3), code)
    if (/[RC]/.test(code)) stat(out[++i] ?? '', `${code}<`)
  }
  return map
}

const recordFile = (session) => {
  const dir = join(dataDir(), 'risk-line')
  return { dir, file: join(dir, `${safeName(session)}.json`) }
}

// readRecord returns the turn's record or null when none exists; a corrupt file throws (fail open).
function readRecord(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  const parsed = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object') throw new Error('unexpected record file')
  return parsed
}

// markerHits returns `path:line` for each added line of a -U0 diff that carries a marker,
// skipping .vault/tasks/ and Markdown.
function markerHits(diff) {
  const hits = []
  let path = null
  let line = 0
  for (const text of diff.split('\n')) {
    if (text.startsWith('+++ ')) {
      // git ends the header of a path with a space with a tab
      path = text.startsWith('+++ b/') ? text.slice(6).replace(/\t$/, '') : null
    } else if (text.startsWith('@@')) {
      line = Number(/\+(\d+)/.exec(text)?.[1] ?? 0)
    } else if (text.startsWith('+') && path !== null) {
      const code = text.slice(1)
      if (!path.startsWith('.vault/tasks/') && !path.endsWith('.md') && (MARKERS.some((m) => m.test(code)) || TODO.test(code))) {
        hits.push(`${path}:${line}`)
      }
      line++
    }
  }
  return hits
}

// untrackedDiff renders an untracked text file as an all-added -U0 diff, so markerHits reads it like a tracked one.
function untrackedDiff(root, path) {
  try {
    const st = lstatSync(join(root, path))
    if (!st.isFile() || st.size > MAX_SCAN_BYTES) return ''
    const text = readFileSync(join(root, path), 'utf8')
    if (text.includes('\0')) return ''
    return `+++ b/${path}\n@@ -0,0 +1 @@\n${text.split('\n').map((l) => `+${l}`).join('\n')}\n`
  } catch {
    return ''
  }
}

async function main() {
  const mode = process.argv[2]
  const input = readInput()
  if (!input || typeof input.cwd !== 'string' || (mode !== 'mark' && mode !== 'check')) return
  if (mode === 'check' && (input.stop_hook_active === true || typeof input.last_assistant_message !== 'string')) return
  // Subagents may still be writing; the first Stop after they finish runs the check.
  if (mode === 'check' && hasOpenSubagents(input.session_id)) return

  const { dir, file } = recordFile(input.session_id)
  // Cheap exit first: a spent block needs no git. A Risk line no longer does, because markers
  // are blocked whatever the reply says.
  let record = null
  if (mode === 'check') {
    record = readRecord(file)
    if (!record || record.blocked === true) return
  }

  const { repositoryRoot, git, headCommit, atomicWrite, DIFF_BUDGET_MS } = await import('./git-tree.mjs')

  let root
  try {
    root = repositoryRoot(input.cwd)
  } catch {
    return
  }
  if (!headCommit(root)) return

  const write = (record) => {
    mkdirSync(dir, { recursive: true })
    atomicWrite(file, `${JSON.stringify(record)}\n`)
  }

  if (mode === 'mark') {
    try {
      pruneState()
    } catch {
      // Best effort.
    }
    // A task notification repeats UserPromptSubmit within one turn with the same prompt_id; the
    // turn's baseline (and its spent block) must survive it. Without a prompt_id every mark re-marks.
    const promptId = typeof input.prompt_id === 'string' && input.prompt_id !== '' ? input.prompt_id : null
    let previous = null
    try {
      previous = readRecord(file)
    } catch {
      // A corrupt record is replaced.
    }
    if (promptId && previous && previous.fp && previous.root === root && previous.prompt_id === promptId) return
    write({ root, fp: fingerprint(git, root, DIFF_BUDGET_MS), blocked: false, ...(promptId ? { prompt_id: promptId } : {}) })
    return
  }

  // A record from another repository, an old one without a root, or one from before the fingerprint (`tree`) is not this turn's.
  if (record.root !== root || !record.fp) return
  const now = fingerprint(git, root, DIFF_BUDGET_MS)
  const changed = [...new Set([...Object.keys(record.fp), ...Object.keys(now)])].filter((path) => record.fp[path] !== now[path])
  const paths = changed.filter((path) => path !== '' && !path.startsWith('.vault/tasks/'))
  if (paths.length === 0) return
  const riskMissing = !RISK_LINE.test(input.last_assistant_message)
  let hits = []
  try {
    const untracked = paths.filter((path) => now[path]?.startsWith('?? '))
    const tracked = paths.filter((path) => !untracked.includes(path)).slice(0, 500)
    const diff = tracked.length === 0 ? '' : git(root, ['--literal-pathspecs', '-c', 'core.quotepath=off', 'diff', '-U0', 'HEAD', '--', ...tracked], { timeout: DIFF_BUDGET_MS }).toString('utf8')
    hits = markerHits(diff + untracked.map((path) => untrackedDiff(root, path)).join(''))
  } catch {
    // Fail open on the marker scan.
  }
  if (!riskMissing && hits.length === 0) return

  // One block per turn: the next Stop of this turn finds the record spent.
  write({ ...record, blocked: true })
  const list = (items) => items.slice(0, MAX_PATHS).join(', ') + (items.length > MAX_PATHS ? `, and ${items.length - MAX_PATHS} more` : '')
  const reasons = []
  if (riskMissing) {
    reasons.push(
      `Risk line missing: this turn changed ${list(paths)}. ` +
        'End the final message with one line, `Risk: item N (reason)` (or `Risk: items 2, 5 (reason)`) for high-risk items 1-6, or `Risk: none`.',
    )
  }
  if (hits.length > 0) {
    reasons.push(`Verifier-weakening marker added: ${list(hits)}. Remove the marker, or explain in the final message why it must stay.`)
  }
  const reason = reasons.join(' ')
  process.stdout.write(`${JSON.stringify({ decision: 'block', reason })}\n`)
}

// Run only as a script.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  try {
    await main()
  } catch {
    // Fail open: no output, exit 0.
  }
  process.exitCode = 0
}
