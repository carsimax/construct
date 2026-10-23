// Delegation admission. PreToolUse on Agent denies a launch that breaks a rule,
// with a reason naming what is missing and the expected form:
//   - construct:worker needs a `## Allowed edit
//     surfaces` section of narrow repository-relative entries, a `Spec:
//     odd/tasks/<f>.md, T<n>` line naming an existing regular file when an
//     unfinished feature document exists, and surfaces that do not overlap those
//     of a writer still open;
//   - construct:verifier needs a `Risk: item N` or `Risk: items 2, 5` line (1-6, the whole list valid);
//   - a Workflow script (PreToolUse on Workflow) may launch only read-only agents: every agent() call
//     names a literal agentType of the reader, lens, or judge kind, or the built-in Explore or Plan
//     (a workflow's agent() never reaches PreToolUse on Agent, so the writer rules above cannot apply).
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
// adapted from gentle-shell (https://github.com/Gentleman-Programming/gentle-shell), MIT, Copyright (c) 2025 Mario Zechner, see LICENSE-gentle-shell
// Usage: node delegation-admission.mjs [stop]   (hook JSON on stdin)
import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { activeDocuments, projectRoot } from './feature-state.mjs'
import { kindOf, namesOf, qualified } from './roles.mjs'
import { dataDir, readInput, safeName, SUBAGENT_MAX_IDLE_MS } from './hook-io.mjs'

export const WRITERS = new Set(namesOf('writer').map(qualified))
const VERIFIER = qualified(namesOf('verifier')[0])

const HEADING = /^## Allowed edit surfaces[ \t]*$/gim
const MD_HEADING = /^ {0,3}#{1,6} /
const LIST_MARKER = /^(?:[-*+]|\d+[.)]) +/
const CONTROL = /\p{Cc}|\p{Zl}|\p{Zp}/u
const SPEC_LINE = /^[ \t]*(?:[-*+][ \t]+)?Spec:[ \t]*`?(odd\/tasks\/[^\s,`()]+\.md)`?[^\n]*?\bT\d+\b/gm
// The Risk-line gate's grammar (risk-line.mjs) without `none`: the whole list must be valid; a test keeps both in step.
const RISK_LINE = /^[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)?[*_`]*Risk[*_`]*:[*_`]*[ \t]*[*_`]*items? [1-6](?:,[ \t]*[1-6])*[*_`]*(?=$|\s|\()/m

const SURFACES_FORM =
  'Add the exact heading `## Allowed edit surfaces` with narrow repository-relative paths or globs, one per line (for example `src/parser.js`), wrapping a path with whitespace in backticks; put prose under the next heading.'
const SPEC_FORM =
  'An unfinished feature document exists, so add a line `Spec: odd/tasks/<feature>.md, T<n>` (and the S# it covers) naming an existing regular file (not a symlink) under odd/tasks/.'
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

// writerRecord finds the started record of the subagent with this agent_id (undefined if none).
export function writerRecord(session, agentId) {
  const dir = recordDir(session)
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue
    try {
      const entry = JSON.parse(readFileSync(join(dir, name), 'utf8'))
      if (entry.agent_id === agentId && Array.isArray(entry.surfaces)) return entry
    } catch {
      // unreadable record: ignore it
    }
  }
  return undefined
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

// The agent types a workflow may launch: none of them can edit files.
const READ_ONLY_KINDS = new Set(['reader', 'lens', 'judge'])
const READ_ONLY_BUILTINS = ['Explore', 'Plan']
const WORKFLOW_TYPES = [...[...READ_ONLY_KINDS].flatMap((kind) => namesOf(kind)).map(qualified).sort(), ...READ_ONLY_BUILTINS]
const WORKFLOW_FORM = 'Writes go through construct:worker with the Agent tool, where edit surfaces are admitted.'
const readOnlyType = (type) => READ_ONLY_BUILTINS.includes(type) || READ_ONLY_KINDS.has(kindOf(type))

// tokenize reads a workflow script into identifiers, string literals, and punctuation, skipping comments
// and template text while still reading the code inside `${...}`. A template with an expression is never
// a literal. A `/` that cannot end a value starts a regex literal, read up to its closing `/` (a class
// `[...]` may hold `/`). shortcut: `}` is taken as ending a value, so a regex right after a block is read
// as division; upgrade to a real parser if a script needs that.
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
      const text = readFileSync(join(dir, file), 'utf8')
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
      writeFileSync(temporary, `${JSON.stringify({ ...oldest.entry, started: true, agent_id: input.agent_id })}\n`)
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
