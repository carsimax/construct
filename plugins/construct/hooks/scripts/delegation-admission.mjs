// Delegation admission. PreToolUse on Agent denies a launch that breaks a rule,
// with a reason naming what is missing and the expected form:
//   - construct:odd-worker and construct:jd-fix-agent need a `## Allowed edit
//     surfaces` section of narrow repository-relative entries, a `Spec:
//     odd/tasks/<f>.md, T<n>` line naming an existing regular file when an
//     unfinished feature document exists, and surfaces that do not overlap those
//     of a writer still open;
//   - construct:odd-verify needs a `Risk: item N` line (N 1-6).
// Other agents pass untouched, and an admitted launch prints nothing, so it never
// conflicts with review-context.mjs (the hooks run in parallel; deny wins).
// `stop` (SubagentStop) clears the stopped writer's record: it hashes the first
// user row of agent_transcript_path (the subagent's prompt) and removes the record
// with that hash. Records live under ${CLAUDE_PLUGIN_DATA}/delegation-admission/<session>/
// and expire after SUBAGENT_MAX_IDLE_MS (one hour), like subagent-count.mjs entries.
// The check-then-record of open writers runs under an mkdir lock (withLock), so parallel
// launches in one batch cannot both pass. Fails open on unreadable input, any internal
// error, or a lock that cannot be taken.
// Ported from gentle-shell lib/bounded-writer-admission.ts, lib/verifier-admission.ts
// and lib/writer-surfaces.ts; the Spec rule is adapted (see S2 of odd/tasks/gentle-parity.md).
// Usage: node delegation-admission.mjs [stop]   (hook JSON on stdin)
import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { activeDocuments, projectRoot } from './feature-state.mjs'
import { dataDir, readInput, safeName, SUBAGENT_MAX_IDLE_MS } from './hook-io.mjs'

export const WRITERS = new Set(['construct:odd-worker', 'construct:jd-fix-agent'])
const VERIFIER = 'construct:odd-verify'

const HEADING = /^## Allowed edit surfaces[ \t]*$/gim
const MD_HEADING = /^ {0,3}#{1,6} /
const LIST_MARKER = /^(?:[-*+]|\d+[.)]) +/
const CONTROL = /\p{Cc}|\p{Zl}|\p{Zp}/u
const SPEC_LINE = /^[ \t]*(?:[-*+][ \t]+)?Spec:[ \t]*`?(odd\/tasks\/[^\s,`()]+\.md)`?[^\n]*?\bT\d+\b/gm
const RISK_LINE = /^[ \t]*(?:[-*+][ \t]+)?Risk:[ \t]*item[ \t]+[1-6](?!\d)/m

const SURFACES_FORM =
  'Add the exact heading `## Allowed edit surfaces` with narrow repository-relative paths or globs, one per line (for example `src/parser.js`), wrapping a path with whitespace in backticks; put prose under the next heading.'
const SPEC_FORM =
  'An unfinished feature document exists, so add a line `Spec: odd/tasks/<feature>.md, T<n>` (and the S# it covers) naming an existing regular file (not a symlink) under odd/tasks/.'
const RISK_FORM =
  'Add a line `Risk: item N` (N from 1 to 6, the Task Size high-risk list), for example `Risk: item 3 (shared parser)`. `Risk: none` does not admit a verifier: run the checks inline instead.'

const deny = (reason) =>
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })}\n`)

function narrowPath(value, backticked) {
  const normalized = value.replace(/\\/g, '/')
  if (!normalized || isAbsolute(value) || /^(?:[A-Za-z]:|\/|~)/.test(normalized) || CONTROL.test(normalized)) return false
  if (/\s/u.test(normalized) && !backticked) return false
  const path = normalized.replace(/^(?:\.\/)+/, '')
  if (!path || path === '.' || path.startsWith('/') || path.split('/').includes('..')) return false
  return !/[?*[\]{}]/.test(path.split('/')[0])
}

// parseSurfaces returns { paths } (sorted, unique) or { problem }.
export function parseSurfaces(prompt) {
  let expected
  for (const heading of prompt.matchAll(HEADING)) {
    const lines = prompt.slice(heading.index + heading[0].length).split(/\r?\n/)
    const end = lines.findIndex((line) => MD_HEADING.test(line))
    const entries = (end === -1 ? lines : lines.slice(0, end)).map((line) => line.replace(/ +$/, '')).filter(Boolean)
    if (entries.length === 0) return { problem: 'The section has no entries.' }
    const paths = []
    for (const source of entries) {
      const line = source.replace(/^ {0,3}/, '')
      const unlisted = line.replace(LIST_MARKER, '')
      const quoted = unlisted.match(/^`([^`]+)`$/)
      const path = quoted?.[1] ?? unlisted
      if (/^(?:[-*+]|\d+[.)])$/.test(line) || (unlisted.includes('`') && !quoted) || CONTROL.test(source) || !narrowPath(path, Boolean(quoted))) {
        const prose = /^(?:[-*+]|\d+[.)])$/.test(line) || (!quoted && /\s/u.test(unlisted))
        const quotable = prose && !quoted && !unlisted.includes('`') && !CONTROL.test(source) && narrowPath(unlisted, true)
        const shown = (prose ? source.trim() : path).replace(/\p{Cc}|\p{Zl}|\p{Zp}/gu, ' ')
        const bounded = shown.length > 120 ? `${shown.slice(0, 120)}...` : shown
        return {
          problem: quotable
            ? `Line "${bounded}" is not a valid surface entry; if it is a path, wrap the whole entry in backticks, otherwise move it under a following Markdown heading.`
            : prose
              ? `Line "${bounded}" is not a valid surface entry; move prose under a following Markdown heading.`
              : `Entry "${bounded}" is not a narrow repository-relative path; remove absolute paths, \`..\` segments, root globs (a bare \`*\` or \`**\` included), and stray backticks.`,
        }
      }
      paths.push(path)
    }
    const unique = [...new Set(paths)].sort()
    if (expected && (expected.length !== unique.length || expected.some((p, i) => p !== unique[i]))) return { problem: 'Repeated sections list different surfaces.' }
    expected = unique
  }
  return expected ? { paths: expected } : { problem: 'No `## Allowed edit surfaces` heading was found.' }
}

// namesFeatureDocument: a Spec line naming a regular file (not a symlink) that
// really sits under <root>/odd/tasks.
function namesFeatureDocument(prompt, root) {
  for (const match of prompt.matchAll(SPEC_LINE)) {
    try {
      const realRoot = realpathSync(resolve(root))
      const tasks = realpathSync(resolve(realRoot, 'odd', 'tasks'))
      const file = resolve(realRoot, match[1])
      const stat = lstatSync(file)
      if (stat.isSymbolicLink() || !stat.isFile()) continue
      const inside = relative(tasks, realpathSync(file))
      if (inside && !inside.startsWith('..') && !isAbsolute(inside)) return true
    } catch {
      // missing or unreadable: not a document
    }
  }
  return false
}

// The same "unfinished feature document" rule feature-state.mjs re-injects by.
function hasUnfinishedDocument(root) {
  try {
    return activeDocuments(root).length > 0
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false
    throw error
  }
}

// Overlap, as upstream: an entry covers every path it matches and what is under
// it; anything this code cannot reason about overlaps everything.
const SPECIAL = /[*?{}]/

function normalizeEntry(entry) {
  let value = entry.trim().replace(/^(?:[-*+]|\d+[.)]) +/, '')
  const quoted = value.match(/^`([^`]*)`$/)
  if (quoted) value = quoted[1]
  value = value.normalize('NFC')
  if (!value || /^(?:\/|~|[A-Za-z]:)/.test(value)) return undefined
  const segments = value.split('/').filter((s) => s !== '' && s !== '.')
  if (segments.length === 0 || segments.includes('..')) return undefined
  return segments.join('/').toLowerCase()
}

function uninterpretable(entry) {
  if (/[[\]()\\]/.test(entry)) return true
  return entry.split('/').some((segment) => {
    let depth = 0
    for (const char of segment) {
      if (char === '{' && ++depth > 1) return true
      if (char === '}' && --depth < 0) return true
    }
    return depth !== 0
  })
}

function segmentRegExp(pattern) {
  let source = ''
  let braces = false
  for (const char of pattern) {
    if (char === '*') source += '[^/]*'
    else if (char === '?') source += '[^/]'
    else if (char === '{') {
      braces = true
      source += '(?:'
    } else if (char === '}') {
      braces = false
      source += ')'
    } else if (char === ',' && braces) source += '|'
    else source += char.replace(/[.+^$|\\/()[\]{}]/g, '\\$&')
  }
  return new RegExp(`^${source}$`)
}

function affixesCompatible(a, b) {
  const prefix = (v) => {
    const i = v.search(SPECIAL)
    return i < 0 ? v : v.slice(0, i)
  }
  const suffix = (v) => {
    let i = v.length - 1
    while (i >= 0 && !SPECIAL.test(v[i])) i -= 1
    return v.slice(i + 1)
  }
  const [pa, pb, sa, sb] = [prefix(a), prefix(b), suffix(a), suffix(b)]
  return (pa.startsWith(pb) || pb.startsWith(pa)) && (sa.endsWith(sb) || sb.endsWith(sa))
}

function segmentsCompatible(a, b) {
  const aGlob = SPECIAL.test(a)
  const bGlob = SPECIAL.test(b)
  if (!aGlob && !bGlob) return a === b
  if (/[^\x00-\x7f]/.test(a + b)) return true
  if (!aGlob || !bGlob) {
    const [literal, pattern] = aGlob ? [b, a] : [a, b]
    return segmentRegExp(pattern).test(literal)
  }
  return affixesCompatible(a, b)
}

export function surfacesOverlap(a, b) {
  const left = normalizeEntry(a)
  const right = normalizeEntry(b)
  if (left === undefined || right === undefined || uninterpretable(left) || uninterpretable(right)) return true
  const as = left.split('/')
  const bs = right.split('/')
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    if (as[i] === '**' || bs[i] === '**') return true
    if (!segmentsCompatible(as[i], bs[i])) return false
  }
  return true
}

const recordDir = (session) => join(dataDir(), 'delegation-admission', safeName(session))
// A record never marked started (SubagentStart) after this long belongs to a declined or failed launch.
const START_GRACE_MS = 2 * 60 * 1000
const qualify = (type) => (typeof type === 'string' && !type.includes(':') ? `construct:${type}` : type)
const promptKey = (text) => createHash('sha256').update(text.trim()).digest('hex')

// openWriters lists the live records of the session in this repository; a stale
// record (older than SUBAGENT_MAX_IDLE_MS, a crashed writer) is removed.
function openWriters(session, root, now = Date.now()) {
  const dir = recordDir(session)
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const live = []
  for (const name of names) {
    if (name.startsWith('.')) continue
    try {
      if (now - statSync(join(dir, name)).mtimeMs > SUBAGENT_MAX_IDLE_MS) {
        rmSync(join(dir, name), { force: true })
        continue
      }
      const entry = JSON.parse(readFileSync(join(dir, name), 'utf8'))
      if (entry.started === false && now - Date.parse(entry.at) > START_GRACE_MS) continue
      if (entry.root === root && Array.isArray(entry.surfaces)) live.push(entry)
    } catch {
      // unreadable record: ignore it (fail open)
    }
  }
  return live
}

function record(session, root, prompt, surfaces, type) {
  const dir = recordDir(session)
  mkdirSync(dir, { recursive: true })
  const key = promptKey(prompt)
  const temporary = join(dir, `.${key}.${process.pid}.tmp`)
  try {
    writeFileSync(temporary, `${JSON.stringify({ root, surfaces, type, started: false, at: new Date().toISOString() })}\n`)
    renameSync(temporary, join(dir, key))
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

const LOCK_WAIT_MS = 3000
const LOCK_STALE_MS = 10_000

// withLock runs fn while holding an mkdir lock next to the session's records (mkdir
// is atomic across processes). A lock older than LOCK_STALE_MS belonged to a crashed
// hook and is broken. If the lock cannot be taken within LOCK_WAIT_MS, or the state
// directory is unusable, fn runs without it (fail open, as before the lock existed).
function withLock(session, fn) {
  const lock = `${recordDir(session)}.lock`
  let held = false
  const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  try {
    mkdirSync(join(lock, '..'), { recursive: true })
    for (const start = Date.now(); !held && Date.now() - start < LOCK_WAIT_MS; ) {
      try {
        mkdirSync(lock)
        held = true
      } catch (error) {
        if (error.code !== 'EEXIST') break
        try {
          if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) rmSync(lock, { recursive: true, force: true })
          else sleep(10)
        } catch {
          // the holder released it between the two calls: try again
        }
      }
    }
  } catch {
    // no usable state directory: run unlocked
  }
  try {
    fn()
  } finally {
    if (held) rmSync(lock, { recursive: true, force: true })
  }
}

function admit(input) {
  const tool = input.tool_input
  if (input.tool_name !== 'Agent' || !tool || typeof tool !== 'object' || Array.isArray(tool)) return
  const raw = tool.subagent_type
  // The prefix is optional: the agent registry accepts both spellings.
  const type = qualify(raw)
  const prompt = typeof tool.prompt === 'string' ? tool.prompt : ''
  if (type === VERIFIER) {
    if (!RISK_LINE.test(prompt)) deny(`${VERIFIER} needs a high-risk item declared in its prompt. ${RISK_FORM}`)
    return
  }
  if (!WRITERS.has(type)) return

  const parsed = parseSurfaces(prompt)
  if (!('paths' in parsed)) {
    deny(`${type} needs scoped edit surfaces. ${parsed.problem} ${SURFACES_FORM} Resend the same task text, changing only that section.`)
    return
  }
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd()
  const root = projectRoot(cwd)
  if (hasUnfinishedDocument(root) && !namesFeatureDocument(prompt, root)) {
    deny(`${type} needs a Spec line: no \`Spec:\` line in the prompt names an existing regular file under odd/tasks/. ${SPEC_FORM}`)
    return
  }
  withLock(input.session_id, () => {
    const pairs = []
    for (const open of openWriters(input.session_id, root)) {
      for (const mine of parsed.paths) for (const theirs of open.surfaces) if (surfacesOverlap(mine, theirs)) pairs.push(`${mine} / ${theirs}`)
    }
    if (pairs.length > 0) {
      deny(
        `${type} edit surfaces overlap those of a writer still open (${[...new Set(pairs)].slice(0, 5).join('; ')}). Wait for that writer to finish, or give each writer disjoint surfaces; an entry this check cannot interpret counts as overlapping.`,
      )
      return
    }
    record(input.session_id, root, prompt, parsed.paths, type)
  })
}

// firstUserPrompt reads the subagent's prompt: the first user row of its transcript.
export function firstUserPrompt(file) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (row?.type !== 'user') continue
    const content = row.message?.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) return content.map((b) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('')
    return undefined
  }
  return undefined
}

function clear(input) {
  if (typeof input.agent_transcript_path !== 'string' || input.agent_transcript_path === '') return
  const prompt = firstUserPrompt(input.agent_transcript_path)
  if (prompt) rmSync(join(recordDir(input.session_id), promptKey(prompt)), { force: true })
}

// start marks the oldest unstarted record of the agent type as started. SubagentStart input
// carries no prompt, so the match is session plus agent type (shortcut: two same-type
// launches in flight may swap records, upgrade if the host adds the prompt to the input).
function start(input) {
  const type = qualify(input.agent_type)
  if (!WRITERS.has(type)) return
  const dir = recordDir(input.session_id)
  withLock(input.session_id, () => {
    const unstarted = []
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.')) continue
      try {
        const entry = JSON.parse(readFileSync(join(dir, name), 'utf8'))
        if (entry.started === false && entry.type === type) unstarted.push({ name, entry })
      } catch {
        // unreadable record: ignore it
      }
    }
    const oldest = unstarted.sort((a, b) => a.entry.at.localeCompare(b.entry.at))[0]
    if (!oldest) return
    const temporary = join(dir, `.${oldest.name}.${process.pid}.start.tmp`)
    try {
      writeFileSync(temporary, `${JSON.stringify({ ...oldest.entry, started: true })}\n`)
      renameSync(temporary, join(dir, oldest.name))
    } catch (error) {
      rmSync(temporary, { force: true })
      throw error
    }
  })
}

function main() {
  const input = readInput()
  if (!input || typeof input !== 'object' || Array.isArray(input)) return
  const mode = process.argv[2]
  if (mode === 'stop') clear(input)
  else if (mode === 'start') start(input)
  else admit(input)
}

// Run only as a script; the helpers above are importable.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  try {
    main()
  } catch {
    // Fail open: no output, exit 0.
  }
  process.exitCode = 0
}
