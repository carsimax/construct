// Delegation admission. PreToolUse on Agent denies a launch that breaks a rule,
// with a reason naming what is missing and the expected form:
//   - construct:worker needs a `## Allowed edit
//     surfaces` section of narrow repository-relative entries, a `Spec:
//     .vault/tasks/<f>.md, T<n>` line naming an existing regular file when an
//     unfinished feature document exists, and surfaces that do not overlap those
//     of a writer still open, and, when that Spec task has an oracle envelope (envelope.mjs, stored by
//     oracle-record.mjs), surfaces all inside the envelope's surfaces; a worker whose surfaces include code (not .vault/ or a
//     doc, isFree in envelope.mjs) needs that envelope (S1 of .vault/tasks/oracle-limits.md);
//   - construct:verifier needs a `Risk: item N` or `Risk: items 2, 5` line (1-6, the whole list valid);
//   - a Workflow script (PreToolUse on Workflow) may launch only read-only agents: every agent() call
//     names a literal agentType of the reader, lens, or judge kind, or the built-in Explore or Plan
//     (a workflow's agent() never reaches PreToolUse on Agent, so the writer rules above cannot apply).
//   - construct:oracle may not list a free path (isFree: .vault/ or a doc) among its surfaces: only test files;
// Other agents pass untouched, and an admitted launch prints nothing, so it never
// conflicts with review-context.mjs (the hooks run in parallel; deny wins).
// `start` writes the record `started: true` with the agent_id first (the host may kill the hook, 30 s, during the snapshot), then
// records the first worker start of a task that has an envelope in the task state (startedAt, and baseTree: a
// snapshot of the working tree that oracle-stop.mjs diffs against, kept per worker in state.workers); the record keeps the Spec feature and task for that.
// `stop` (SubagentStop) closes the stopped writer's record: it hashes the first
// user row of agent_transcript_path (the subagent's prompt) and marks the record
// with that hash `stoppedAt` (it no longer counts for overlap; oracle-stop.mjs still reads it). Records live under ${CLAUDE_PLUGIN_DATA}/delegation-admission/<session>/
// and stop counting for overlap after SUBAGENT_MAX_IDLE_MS (one hour), like subagent-count.mjs entries.
// The check-then-record of open writers runs under an mkdir lock (withLock), so parallel
// launches in one batch cannot both pass. Fails open on unreadable input, any internal
// error, or a lock that cannot be taken; it fails closed (S3 of .vault/tasks/guarantees.md) for a worker whose Spec task has an
// envelope or task state that exists but cannot be read: the launch is denied naming the file.
// Ported from gentle-shell lib/bounded-writer-admission.ts, lib/verifier-admission.ts
// and lib/writer-surfaces.ts; the Spec rule is adapted (see S2 of .vault/tasks/gentle-parity.md).
// adapted from gentle-shell (https://github.com/Gentleman-Programming/gentle-shell), MIT, Copyright (c) 2025 Mario Zechner, see LICENSE-gentle-shell
// Usage: node delegation-admission.mjs [stop]   (hook JSON on stdin)
import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { activeDocuments, projectRoot } from './feature-state.mjs'
import { freezeWorkingTree } from './git-tree.mjs'
import { DEFAULTS, isFree } from './envelope.mjs'
import { readExemptPaths } from './exempt-paths.mjs'
import { activeLocks } from './publication-gate.mjs'
import { readEnvelope, readOracles, readTaskState, UnreadableState, writeEnvelope, writeTaskState } from './review-store.mjs'
import { kindOf, namesOf, qualified } from './roles.mjs'
import { dataDir, readInput, safeName, SUBAGENT_MAX_IDLE_MS } from './hook-io.mjs'

export const WRITERS = new Set(namesOf('writer').map(qualified))
const ORACLE = qualified('oracle')
const VERIFIER = qualified(namesOf('verifier')[0])

const HEADING = /^## Allowed edit surfaces[ \t]*$/gim
const MD_HEADING = /^ {0,3}#{1,6} /
const LIST_MARKER = /^(?:[-*+]|\d+[.)]) +/
const CONTROL = /\p{Cc}|\p{Zl}|\p{Zp}/u
const SPEC_LINE = /^[ \t]*(?:[-*+][ \t]+)?Spec:[ \t]*`?(\.vault\/tasks\/[^\s,`()]+\.md)`?[^\n]*?\bT\d+\b/gm
// The Risk-line gate's grammar (risk-line.mjs) without `none`: the whole list must be valid; a test keeps both in step.
const RISK_LINE = /^[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)?[*_`]*Risk[*_`]*:[*_`]*[ \t]*[*_`]*items? [1-6](?:,[ \t]*[1-6])*[*_`]*(?=$|\s|\()/m

const SURFACES_FORM =
  'Add the exact heading `## Allowed edit surfaces` with narrow repository-relative paths or globs, one per line (for example `src/parser.js`), wrapping a path with whitespace in backticks; put prose under the next heading.'
const SPEC_FORM =
  'An unfinished feature document exists, so add a line `Spec: .vault/tasks/<feature>.md, T<n>` (and the S# it covers) naming an existing regular file (not a symlink) under .vault/tasks/.'
const RISK_FORM =
  'Add a line `Risk: item N` (N from 1 to 6, the Task Size high-risk list), for example `Risk: item 3 (shared parser)` or `Risk: items 2, 5 (why)`. `Risk: none` does not admit a verifier: run the checks inline instead.'

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
// really sits under <root>/.vault/tasks.
function namesFeatureDocument(prompt, root) {
  for (const match of prompt.matchAll(SPEC_LINE)) {
    try {
      const realRoot = realpathSync(resolve(root))
      const tasks = realpathSync(resolve(realRoot, '.vault', 'tasks'))
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

// envelopeOf: the oracle envelope of the feature and task the prompt's Spec line names, or undefined.
export function specOf(prompt) {
  const spec = /^[ \t]*(?:[-*+][ \t]+)?Spec:[ \t]*`?(\.vault\/tasks\/[^\s,`()]+\.md)`?[^\n]*?\b(T\d+)\b/m.exec(prompt)
  return spec ? { feature: spec[1], task: spec[2] } : undefined
}

function envelopeOf(prompt, root) {
  const spec = specOf(prompt)
  return spec ? (readEnvelope(root, spec.feature, spec.task) ?? undefined) : undefined
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

// Extglobs (and a nested, unbalanced, or escaped segment) cannot be reasoned
// about; a bracket class may match anything at its own position. Parentheses
// elsewhere are literal (Next.js route groups such as `(dashboard)`).
const EXTGLOB = /[@!+*?]\(/

function uninterpretable(segment) {
  if (/[[\]\\]/.test(segment)) return true
  let depth = 0
  for (const char of segment) {
    if (char === '{' && ++depth > 1) return true
    if (char === '}' && --depth < 0) return true
  }
  return depth !== 0
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
  if (uninterpretable(a) || uninterpretable(b)) return true
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

// A brace group that spans '/' cannot be compared position by position (its branches differ in depth), so such an entry overlaps everything.
const spansSlash = (entry) => entry.split('/').some((segment) => (segment.match(/{/g) ?? []).length !== (segment.match(/}/g) ?? []).length)

export function surfacesOverlap(a, b) {
  const left = normalizeEntry(a)
  const right = normalizeEntry(b)
  if (left === undefined || right === undefined || spansSlash(left) || spansSlash(right)) return true
  const as = left.split('/')
  const bs = right.split('/')
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    if (as[i] === '**' || bs[i] === '**' || EXTGLOB.test(as[i]) || EXTGLOB.test(bs[i])) return true
    if (!segmentsCompatible(as[i], bs[i])) return false
  }
  return true
}

// surfaceContains is containment, unlike surfacesOverlap: the surface must match the whole
// repo-relative path; `**` spans zero or more segments. Both sides are normalized alike.
// A literal surface (no glob characters) also contains its descendants, like surfacesOverlap.
export function surfaceContains(surface, path) {
  const pattern = normalizeEntry(surface)
  const target = normalizeEntry(path)
  if (pattern === undefined || target === undefined) return false
  if (!SPECIAL.test(pattern) && target.startsWith(`${pattern}/`)) return true
  const match = (ps, ts) => {
    if (ps.length === 0) return ts.length === 0
    if (ps[0] === '**') return match(ps.slice(1), ts) || (ts.length > 0 && match(ps, ts.slice(1)))
    return ts.length > 0 && segmentRegExp(ps[0]).test(ts[0]) && match(ps.slice(1), ts.slice(1))
  }
  return match(pattern.split('/'), target.split('/'))
}

// otherSurfaces lists the edit surfaces of the other live writers of the session (their paths are not this writer's doing).
// A writer that stopped at or after `since` still counts: what it wrote is in the diff of a worker that started before.
export function otherSurfaces(session, root, agentId, since = Infinity) {
  return openWriters(session, root, '', Date.now(), since).filter((entry) => entry.agent_id !== agentId).flatMap((entry) => entry.surfaces)
}

// writerRecord finds the started record of the subagent with this agent_id (undefined if none); when none is readable and a file
// of the directory does not parse, it throws UnreadableState naming that file (the missing record may be the one that is broken).
export function writerRecord(session, agentId) {
  const dir = recordDir(session)
  let broken
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue
    try {
      const entry = JSON.parse(readFileSync(join(dir, name), 'utf8'))
      if (entry.agent_id === agentId && Array.isArray(entry.surfaces)) return entry
    } catch (error) {
      broken ??= new UnreadableState(join(dir, name), error?.message ?? String(error))
    }
  }
  if (broken) throw broken
  return undefined
}

const recordDir = (session) => join(dataDir(), 'delegation-admission', safeName(session))
// A record never marked started (SubagentStart) after this long belongs to a declined or failed launch.
const START_GRACE_MS = 2 * 60 * 1000
const qualify = (type) => (typeof type === 'string' && !type.includes(':') ? `construct:${type}` : type)
const promptKey = (text) => createHash('sha256').update(text.trim()).digest('hex')

// openWriters lists the live records of the session in this repository; a stale
// record (older than SUBAGENT_MAX_IDLE_MS) no longer counts for overlap (a crashed writer). A stale
// unstarted record is removed; a stale started one stays, so surface-guard still confines a long writer
// until its SubagentStop or pruneState. The unstarted
// record of `key` is skipped: it is this same prompt's earlier launch, which never started.
// shortcut: two identical prompts launched before either starts are both admitted (the same
// task twice); telling that apart from a resend after a declined launch needs a launch id.
function openWriters(session, root, key, now = Date.now(), since = Infinity) {
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
      const stale = now - statSync(join(dir, name)).mtimeMs > SUBAGENT_MAX_IDLE_MS
      const entry = JSON.parse(readFileSync(join(dir, name), 'utf8'))
      if (stale) {
        if (entry.started !== true) rmSync(join(dir, name), { force: true })
        continue
      }
      if (entry.stoppedAt !== undefined && !(entry.stoppedAt >= since)) continue
      if (entry.started === false && (name === key || now - Date.parse(entry.at) > START_GRACE_MS)) continue
      if (entry.root === root && Array.isArray(entry.surfaces)) live.push(entry)
    } catch {
      // unreadable record: ignore it (fail open)
    }
  }
  return live
}

function record(session, root, prompt, surfaces, type, spec) {
  const dir = recordDir(session)
  mkdirSync(dir, { recursive: true })
  const key = promptKey(prompt)
  const temporary = join(dir, `.${key}.${process.pid}.tmp`)
  try {
    writeFileSync(temporary, `${JSON.stringify({ root, surfaces, type, spec, started: false, at: new Date().toISOString() })}\n`)
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

// The agent types a workflow may launch: none of them can edit files.
const READ_ONLY_KINDS = new Set(['reader', 'lens', 'judge'])
const READ_ONLY_BUILTINS = ['Explore', 'Plan']
const WORKFLOW_TYPES = [...[...READ_ONLY_KINDS].flatMap((kind) => namesOf(kind)).map(qualified).sort(), ...READ_ONLY_BUILTINS]
const WORKFLOW_FORM = 'Writes go through construct:worker with the Agent tool, where edit surfaces are admitted.'
const readOnlyType = (type) => READ_ONLY_BUILTINS.includes(type) || READ_ONLY_KINDS.has(kindOf(type))

// tokenize reads a workflow script into identifiers, string literals, and punctuation, skipping comments
// and template text while still reading the code inside `${...}`. A template with an expression is never
// a literal. A `/` that cannot end a value starts a regex literal, read up to its closing `/` (a class
// `[...]` may hold `/`). A `/` right after `}` (a block or an object: the scan cannot tell) is denied by
// workflowProblem, so a regex there cannot hide code from the scan.
const KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await'])
const endsValue = (token) =>
  token !== undefined && (token.kind === 'str' || (token.kind === 'id' && !KEYWORDS.has(token.value)) || (token.kind === 'p' && /[\w)\]}$]/.test(token.value)))
function tokenize(src) {
  const tokens = []
  const templates = [] // open `${` expressions: { depth, token }
  let i = 0
  let line = 1
  const template = (token) => {
    // Reads template text from i up to the closing backtick or a `${`.
    while (i < src.length) {
      const c = src[i]
      if (c === '\\') i += 2
      else if (c === '`') return void i++
      else if (c === '$' && src[i + 1] === '{') {
        token.literal = false
        templates.push({ depth: 0, token })
        return void (i += 2)
      } else {
        if (c === '\n') line++
        token.value += c
        i++
      }
    }
  }
  while (i < src.length) {
    const c = src[i]
    if (c === '\n') {
      line++
      i++
    } else if (/\s/.test(c)) i++
    else if (c === '/' && src[i + 1] === '/') while (i < src.length && src[i] !== '\n') i++
    else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end === -1 ? src.length : end + 2
      line += src.slice(i, stop).split('\n').length - 1
      i = stop
    } else if (c === '/' && !endsValue(tokens.at(-1))) {
      let inClass = false
      i++
      while (i < src.length && src[i] !== '\n' && (inClass || src[i] !== '/')) {
        if (src[i] === '\\') i++
        else if (src[i] === '[') inClass = true
        else if (src[i] === ']') inClass = false
        i++
      }
      i++
      while (/[a-z]/i.test(src[i] ?? '')) i++
      tokens.push({ kind: 're', value: '', line })
    } else if (c === "'" || c === '"') {
      let value = ''
      i++
      while (i < src.length && src[i] !== c && src[i] !== '\n') value += src[i] === '\\' ? src[(i += 1)] : src[i], i++
      i++
      tokens.push({ kind: 'str', value, literal: true, line })
    } else if (c === '`') {
      const token = { kind: 'str', value: '', literal: true, line }
      tokens.push(token)
      i++
      template(token)
    } else if (c === '}' && templates.length > 0 && templates.at(-1).depth === 0) {
      i++
      template(templates.pop().token)
    } else {
      const id = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 256))?.[0]
      if (id) {
        tokens.push({ kind: 'id', value: id, line })
        i += id.length
      } else {
        if (templates.length > 0 && c === '{') templates.at(-1).depth++
        if (templates.length > 0 && c === '}') templates.at(-1).depth--
        tokens.push({ kind: 'p', value: c, line })
        i++
      }
    }
  }
  return tokens
}

const GLOBALS = new Set(['globalThis', 'this', 'self', 'window', 'global'])

// workflowProblem returns why a workflow script could launch an agent that writes, or null.
export function workflowProblem(src) {
  const tokens = tokenize(src)
  const is = (k, value) => tokens[k]?.kind === 'p' && tokens[k].value === value
  const at = (k) => `(line ${tokens[k].line})`
  // closing returns the index of the bracket that closes the one opened before k.
  const closing = (k) => {
    for (let depth = 1, j = k; j < tokens.length; j++) {
      if (is(j, '(') || is(j, '[') || is(j, '{')) depth++
      else if ((is(j, ')') || is(j, ']') || is(j, '}')) && --depth === 0) return j
    }
    return tokens.length
  }
  let calls = 0
  for (let k = 0; k < tokens.length; k++) {
    const { kind, value } = tokens[k]
    if (kind === 'p' && value === '\\') return `an escape outside a string cannot be admitted ${at(k)}`
    if ((kind === 'p' || kind === 're') && is(k - 1, '}') && (value === '/' || kind === 're')) return `a / right after } is ambiguous; assign the regex to a variable first ${at(k)}`
    // `(() => {}).constructor` is Function under another name.
    if ((kind === 'id' || (kind === 'str' && tokens[k].literal)) && value === 'constructor') return `a constructor reference cannot be admitted ${at(k)}`
    if (kind !== 'id' || is(k - 1, '.')) continue
    if (value === 'eval' || value === 'Function') return `dynamic code (eval or Function) cannot be admitted ${at(k)}`
    if (GLOBALS.has(value)) return `the global object cannot be referenced ${at(k)}`
    if (value !== 'agent') continue
    // An object key (`{ agent: 1 }`) is not the workflow's agent(), unless the object is a destructuring pattern.
    if (is(k + 1, ':') && (is(k - 1, '{') || is(k - 1, ','))) {
      const end = closing(k)
      if (is(end + 1, '=') && !is(end + 2, '=') && !is(end + 2, '>')) return `agent is used other than as a direct call ${at(k)}`
      continue
    }
    if (!is(k + 1, '(')) return `agent is used other than as a direct call ${at(k)}`
    calls++
    // Every agentType key of an argument object counts (the last one wins in JavaScript), and a spread there could add one.
    const types = []
    let literal = true
    for (let depth = 0, j = k + 1; j < tokens.length; j++) {
      // A computed key (`[k]: ...`) or a quoted agentType key at an argument object's level could set the type.
      if (depth === 2 && ((is(j, '[') && (is(j - 1, '{') || is(j - 1, ','))) || (tokens[j].kind === 'str' && tokens[j].value === 'agentType' && is(j + 1, ':')))) literal = false
      if (is(j, '(') || is(j, '[') || is(j, '{')) depth++
      else if (is(j, ')') || is(j, ']') || is(j, '}')) {
        if (--depth === 0) break
      } else if (depth === 2 && is(j, '.') && is(j + 1, '.') && is(j + 2, '.')) literal = false
      else if (depth === 2 && tokens[j].kind === 'id' && tokens[j].value === 'agentType' && is(j + 1, ':') && !is(j - 1, '.')) {
        const v = tokens[j + 2]
        if (v?.kind === 'str' && v.literal && (is(j + 3, ',') || is(j + 3, '}'))) types.push(v.value)
        else literal = false
      }
    }
    if (!literal || types.length === 0) return `agent() call ${calls} has no literal agentType`
    const bad = types.find((type) => !readOnlyType(type))
    if (bad !== undefined) return `agent() call ${calls} names agentType ${JSON.stringify(bad)}`
  }
  return null
}

// savedWorkflow finds a saved workflow's script by meta.name: the project's .claude/workflows, then the home one.
function savedWorkflow(name, root) {
  for (const dir of [join(root, '.claude', 'workflows'), join(homedir(), '.claude', 'workflows')]) {
    let files = []
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.js')).sort()
    } catch {
      continue
    }
    for (const file of files) {
      let text
      try {
        text = readFileSync(join(dir, file), 'utf8')
      } catch {
        continue // an unreadable entry (a directory named x.js) is not a saved workflow
      }
      const meta = /export\s+const\s+meta\s*=\s*\{[^}]*?\bname\s*:\s*(['"])(.*?)\1/s.exec(text)
      if (meta?.[2] === name) return text
    }
  }
  return null
}

function admitWorkflow(input, tool) {
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd()
  let src = null
  if (typeof tool.scriptPath === 'string' && tool.scriptPath) {
    try {
      src = readFileSync(resolve(cwd, tool.scriptPath), 'utf8')
    } catch {
      deny(`A workflow may launch only read-only agents (${WORKFLOW_TYPES.join(', ')}); scriptPath ${JSON.stringify(tool.scriptPath)} cannot be read. ${WORKFLOW_FORM}`)
      return
    }
  } else if (typeof tool.script === 'string') src = tool.script
  // A name with no saved file is a bundled workflow (such as deep-research), and a bare resume reruns an admitted run.
  else if (typeof tool.name === 'string' && tool.name) src = savedWorkflow(tool.name, projectRoot(cwd))
  if (src === null) return
  const problem = workflowProblem(src)
  if (problem) deny(`A workflow may launch only read-only agents (${WORKFLOW_TYPES.join(', ')}); ${problem}. ${WORKFLOW_FORM}`)
}

function admit(input) {
  const tool = input.tool_input
  if (!tool || typeof tool !== 'object' || Array.isArray(tool)) return
  if (input.tool_name === 'Workflow') return admitWorkflow(input, tool)
  if (input.tool_name !== 'Agent') return
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
  if (type === ORACLE && parsed.paths.some((path) => /[*?[\]{}]/.test(path))) {
    deny(`${type} edit surfaces must be exact file paths, with no glob (any of * ? [ ] { }), because each is locked by its content hash when the oracle stops. List every test file by its full path.`)
    return
  }
  const freePaths = type === ORACLE ? parsed.paths.filter((path) => isFree(path)) : []
  if (freePaths.length) {
    deny(`${type} edit surfaces include free paths (${freePaths.slice(0, 5).join(', ')}): the oracle lists only test files, each locked by its content hash; the feature document and docs are never oracle surfaces.`)
    return
  }
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd()
  const root = projectRoot(cwd)
  // The oracle record hook reads the Spec line, so an oracle needs one whether or not a feature document is unfinished.
  if (type === ORACLE && parsed.paths.some((path) => { try { return lstatSync(resolve(root, path)).isDirectory() } catch { return false } })) {
    deny(`${type} edit surfaces must be file paths, not directories: each file is locked by its content hash. List every test file by its full path.`)
    return
  }
  // S4: no writer may cover an active locked oracle, and an oracle may not be launched over one (T5: another feature's lock).
  let locks = []
  try {
    locks = activeLocks(root)
  } catch {
    // Fail closed for this check only (as surface-guard does): every recorded lock counts as active.
    try {
      locks = readOracles(root)
    } catch {
      // No lock readable: the Spec-line and surface checks still run.
    }
  }
  const covered = locks.find((lock) => parsed.paths.some((path) => surfaceContains(path, lock.path)))
  if (covered) {
    deny(`${type} edit surfaces cover ${covered.path}, a locked oracle for ${covered.feature} (task ${covered.task}). Keep the surfaces off it; if the test and the spec disagree, return \`oracle_conflict\` to the user, who can run \`construct-gate oracle unlock ${covered.path}\`.`)
    return
  }
  if ((type === ORACLE || hasUnfinishedDocument(root)) && !namesFeatureDocument(prompt, root)) {
    deny(`${type} needs a Spec line: no \`Spec:\` line in the prompt names an existing regular file under .vault/tasks/. ${SPEC_FORM}`)
    return
  }
  let bounds
  try {
    bounds = type === ORACLE ? undefined : envelopeOf(prompt, root)
    if (bounds) readTaskState(root, bounds.feature, bounds.task)
  } catch (error) {
    if (!(error instanceof UnreadableState)) throw error
    deny(`${type} cannot be launched: ${error.message}. The oracle envelope and task state decide what this worker may do; ask the user to inspect or remove the file, or re-run construct:oracle for the task.`)
    return
  }
  const code = parsed.paths.filter((path) => !isFree(path))
  const spec = specOf(prompt)
  if (type !== ORACLE && code.length > 0 && !bounds && spec) {
    // S3 of autonomy: every code surface on the default branch's allowlist: write the envelope ourselves.
    let entries
    try {
      entries = readExemptPaths(root)
    } catch (error) {
      deny(`${type} cannot be launched: ${error.message}. Fix the file on the default branch.`)
      return
    }
    const hits = entries && code.map((path) => entries.filter((entry) => surfaceContains(entry.glob, path)))
    if (hits?.every((h) => h.length > 0)) {
      const command = [...new Set(hits.flat().map((entry) => entry.command))].join(' && ')
      bounds = { ...spec, command, surfaces: parsed.paths, ...DEFAULTS, source: 'allowlist', at: Date.now() }
      writeEnvelope(root, bounds)
    }
  }
  if (type !== ORACLE && code.length > 0 && !bounds) {
    deny(`${type} edit surfaces include code (${code.slice(0, 5).join(', ')}) and the Spec task has no oracle envelope. Code goes through construct:oracle first: it writes the failing test and declares the envelope (test command, surfaces, budget); an existing failing test can be the oracle's surface, unchanged. A task with no deterministic test needs your approval: ask with AskUserQuestion naming the task in backticks (for example \`T2\`) with the options \`Exempt\` and \`Keep the oracle\`, then run \`construct-gate oracle exempt <feature-doc> <T#> -- <surface>...\` once from the main thread. A worker whose surfaces are only docs and .vault/ needs no envelope.`)
    return
  }
  const outside = bounds && parsed.paths.filter((path) => !bounds.surfaces.some((surface) => surfaceContains(surface, path)))
  if (outside?.length) {
    deny(`${type} edit surfaces ${outside.join(', ')} are outside the oracle envelope of ${bounds.feature} (task ${bounds.task}), which allows ${bounds.surfaces.join(', ')}. Keep the surfaces inside the envelope; the oracle fixes it and a worker cannot change it.`)
    return
  }
  withLock(input.session_id, () => {
    const pairs = []
    for (const open of openWriters(input.session_id, root, promptKey(prompt))) {
      for (const mine of parsed.paths) for (const theirs of open.surfaces) if (surfacesOverlap(mine, theirs)) pairs.push(`${mine} / ${theirs}`)
    }
    if (pairs.length > 0) {
      deny(
        `${type} edit surfaces overlap those of a writer still open (${[...new Set(pairs)].slice(0, 5).join('; ')}). Wait for that writer to finish, or give each writer disjoint surfaces; an entry this check cannot interpret counts as overlapping.`,
      )
      return
    }
    record(input.session_id, root, prompt, parsed.paths, type, bounds && specOf(prompt))
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
  if (!prompt) return
  // The record stays, marked, so oracle-stop.mjs can tell a sibling's finished writes from this worker's; pruneState sweeps it.
  const file = join(recordDir(input.session_id), promptKey(prompt))
  try {
    const entry = JSON.parse(readFileSync(file, 'utf8'))
    const temporary = `${file}.${process.pid}.stop.tmp`
    writeFileSync(temporary, `${JSON.stringify({ ...entry, stoppedAt: Date.now() })}\n`)
    renameSync(temporary, file)
  } catch {
    // no readable record: nothing to mark
  }
}

// start marks the oldest unstarted record of the agent type inside the grace as started. SubagentStart input
// carries no prompt, so the match is session plus agent type (shortcut: two same-type
// launches in flight may swap records, upgrade if the host adds the prompt to the input;
// surface-guard.mjs trusts this pairing, and Bash writes are not covered by it).
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
        // A record past the grace was declined by the host and no longer blocks: it is not the launch that started.
        if (entry.started === false && entry.type === type && !(Date.now() - Date.parse(entry.at) > START_GRACE_MS)) unstarted.push({ name, entry })
      } catch {
        // unreadable record: ignore it
      }
    }
    const oldest = unstarted.sort((a, b) => a.entry.at.localeCompare(b.entry.at))[0]
    if (!oldest) return
    const temporary = join(dir, `.${oldest.name}.${process.pid}.start.tmp`)
    try {
      const { root, spec } = oldest.entry
      // Started first: the host may kill this hook during the snapshot, and surface-guard confines by the started record.
      writeFileSync(temporary, `${JSON.stringify({ ...oldest.entry, started: true, agent_id: input.agent_id })}\n`)
      renameSync(temporary, join(dir, oldest.name))
      const baseTree = spec && readEnvelope(root, spec.feature, spec.task) ? freezeWorkingTree(root).candidateTree : undefined
      startTask(oldest.entry, input.agent_id, baseTree)
    } catch (error) {
      rmSync(temporary, { force: true })
      throw error
    }
  })
}

// startTask records the first worker start of a task (S5 minutes, S6 baseline); later workers of the task keep it.
// Each worker's own baseline goes to state.workers (the store, which agents cannot write), not to its admission record,
// which admission's own SubagentStop may remove or mark before oracle-stop.mjs reads it.
function startTask({ root, spec }, agentId, baseTree) {
  const envelope = spec && readEnvelope(root, spec.feature, spec.task)
  if (!envelope) return
  // The budget is copied so surface-guard can enforce it from the state alone (the envelope is locked while the task runs).
  const budget = { attempts: envelope.attempts, minutes: envelope.minutes }
  const state = readTaskState(root, spec.feature, spec.task) ?? { attempts: 0, bestPass: null, startedAt: Date.now(), baseTree, budget }
  writeTaskState(root, spec.feature, spec.task, { ...state, workers: { ...state.workers, [agentId]: { baseTree, startedAt: Date.now() } } })
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
