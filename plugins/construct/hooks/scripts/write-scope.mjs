// Write scope for secret-guard.mjs (S3 and S4, gentle-parity). Applies to Edit, Write,
// MultiEdit, and NotebookEdit, after the secret check:
//   S4: the main thread (no agent_id) may not write a path inside the project repository
//       unless it is under odd/tasks/; code goes through construct:odd-worker. Paths
//       outside the repository, and a cwd outside any repository, are allowed.
//   S3: a writer subagent (construct:odd-worker or construct:jd-fix-agent) may write only
//       inside the `## Allowed edit surfaces` of its own prompt, read from the first user
//       row of <session dir>/subagents/agent-<agent_id>.jsonl with the parser that
//       delegation-admission.mjs admitted the launch with.
// Other subagents are not affected. Read-only; every unreadable input allows (the
// admission hook already checked the prompt, and the transcript layout is undocumented).
// Pure module: secret-guard.mjs imports `writeScopeVerdict` and owns the output.
import { execFileSync } from 'node:child_process'
import { lstatSync, readlinkSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { firstUserPrompt, parseSurfaces, WRITERS } from './delegation-admission.mjs'

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const SAFE_ID = /^[A-Za-z0-9_-]+$/

const str = (v) => (typeof v === 'string' && v ? v : null)

// gitRoot is the real git top level of cwd, or null outside a repository.
function gitRoot(cwd) {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return out ? realpathSync(out) : null
  } catch {
    return null
  }
}

// realPath resolves where a write to `abs` would really land. A symlink (including a
// dangling one, which existsSync cannot see) is followed with readlink, relative links
// against their own directory; the nearest existing ancestor is resolved with realpath
// and the rest is kept, so a file that does not exist yet still compares against the real
// repository root. A chain longer than 40 links throws (the caller allows on error).
export function realPath(abs, hops = 0) {
  if (hops > 40) throw new Error('too many symbolic links')
  const rest = []
  let dir = abs
  for (;;) {
    let stat = null
    try {
      stat = lstatSync(dir)
    } catch {
      // missing: climb
    }
    if (stat?.isSymbolicLink()) return realPath(join(resolve(dirname(dir), readlinkSync(dir)), ...rest), hops + 1)
    if (stat) return join(realpathSync(dir), ...rest)
    const parent = dirname(dir)
    if (parent === dir) return abs
    rest.unshift(basename(dir))
    dir = parent
  }
}

const inside = (rel) => rel !== '' && rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel)

// surfaceRegExp compiles one surface entry: `*` stays in a segment, `**` crosses
// segments, `?` is one character, `{a,b}` alternates, `[...]` is a class. The entry
// also covers everything under what it matches (a directory entry covers its files).
function surfaceRegExp(entry) {
  const pattern = entry.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/\/+$/, '')
  let source = ''
  let braces = 0
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*' && pattern[i + 1] === '*') {
      i += 1
      if (pattern[i + 1] === '/') {
        i += 1
        source += '(?:.*/)?'
      } else source += '.*'
    } else if (c === '*') source += '[^/]*'
    else if (c === '?') source += '[^/]'
    else if (c === '{') {
      braces += 1
      source += '(?:'
    } else if (c === '}' && braces > 0) {
      braces -= 1
      source += ')'
    } else if (c === ',' && braces > 0) source += '|'
    else if (c === '[' && pattern.indexOf(']', i + 2) !== -1) {
      const end = pattern.indexOf(']', i + 2)
      source += `[${pattern.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`
      i = end
    } else source += c.replace(/[.+^${}()|\\\]\[]/g, '\\$&')
  }
  return new RegExp(`^${source}(?:/.*)?$`)
}

// writerSurfaces reads the surfaces of the writer's own prompt, or null when they cannot
// be read (no transcript, no section, odd agent_id): the caller then allows.
function writerSurfaces(event) {
  const transcript = str(event.transcript_path)
  const id = str(event.agent_id)
  if (!transcript || !id || !SAFE_ID.test(id)) return null
  const file = join(dirname(transcript), basename(transcript, '.jsonl'), 'subagents', `agent-${id}.jsonl`)
  let prompt
  try {
    prompt = firstUserPrompt(file)
  } catch {
    return null
  }
  const parsed = typeof prompt === 'string' ? parseSurfaces(prompt) : null
  return parsed && 'paths' in parsed ? parsed.paths : null
}

const MAIN_REASON = (path) =>
  `write-scope blocked this call: the main thread orchestrates and does not write code, so ${path} inside the repository is not edited here. ` +
  'Delegate the change to construct:odd-worker with an `## Allowed edit surfaces` section naming this path (odd-delegation skill); only odd/tasks/ is edited directly.'

const WRITER_REASON = (path, surfaces) =>
  `write-scope blocked this call: ${path} is outside the \`## Allowed edit surfaces\` of this writer's prompt (${surfaces.join(', ')}). ` +
  'Edit only those paths; if the task needs another path, stop and report it as an open issue (needs_interaction) so the parent can widen the surfaces.'

// writeScopeVerdict returns { reason } to deny the call, or null to allow it.
export function writeScopeVerdict(event) {
  if (!WRITE_TOOLS.has(event.tool_name)) return null
  const input = event.tool_input ?? {}
  const target = str(event.tool_name === 'NotebookEdit' ? input.notebook_path : input.file_path)
  if (!target) return null
  const cwd = str(event.cwd) ?? process.cwd()
  const root = gitRoot(cwd)
  if (!root) return null
  const rel = relative(root, realPath(resolve(cwd, target)))
  const within = inside(rel)

  if (!str(event.agent_id)) {
    if (!within || rel === 'odd/tasks' || rel.startsWith('odd/tasks/')) return null
    return { reason: MAIN_REASON(rel) }
  }
  const type = str(event.agent_type)
  if (!type || !(WRITERS.has(type) || WRITERS.has(`construct:${type}`))) return null
  const surfaces = writerSurfaces(event)
  if (!surfaces) return null
  if (within && surfaces.some((entry) => surfaceRegExp(entry).test(rel))) return null
  return { reason: WRITER_REASON(within ? rel : target, surfaces) }
}
