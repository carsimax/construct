// PreToolUse hook: deny tool calls that touch secrets or run a catastrophic rm -rf.
// Stands in for a permissions.deny list, which a plugin cannot set. Read-only: it
// decides from the hook JSON alone and never touches the filesystem.
// Usage: node secret-guard.mjs   (hook JSON on stdin: tool_name, tool_input, cwd)
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, resolve } from 'node:path'

const TEMPLATES = new Set(['.env.example', '.env.sample', '.env.template'])
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh'])

const home = () => process.env.HOME || homedir()

function expand(word) {
  const h = home()
  return word
    .replace(/^~(?=\/|$)/, h)
    .replace(/\$\{HOME\}|\$HOME(?![A-Za-z0-9_])/g, h)
}

// ruleFor returns the name of the protected-path rule a path matches, or null.
// Globs are matched literally on their segments, so `**/*.pem` and `.ssh/**` hit.
function ruleFor(path, cwd) {
  const abs = resolve(isAbsolute(expand(path)) ? '/' : cwd, expand(path))
  const segs = abs.split('/').filter(Boolean)
  const name = basename(abs)
  if (TEMPLATES.has(name)) return null
  if (/^\.env(\..*|[*?[].*)?$/.test(name)) return '.env file'
  if (segs.includes('.ssh')) return '.ssh directory'
  if (segs.includes('.credentials')) return '.credentials directory'
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i] === 'Library' && segs[i + 1] === 'Keychains') return 'Library/Keychains'
  }
  if (abs.endsWith('/.aws/credentials')) return '.aws/credentials'
  if (abs.endsWith('/.config/gh/hosts.yml')) return '.config/gh/hosts.yml'
  if (/\.(pem|key)$/.test(name)) return '*.pem / *.key file'
  if (segs.includes('secrets')) return 'secrets directory'
  return null
}

// splitCommands is a small shell-word splitter: quotes and backslashes group a word,
// unquoted ; | & ( ) ` newline end a command, and < > are dropped as separators so
// `cat <.env` yields the word `.env`. Each returned word keeps whether it was quoted.
function splitCommands(input) {
  const commands = []
  let words = []
  let cur = ''
  let has = false
  const endWord = () => {
    if (has) words.push(cur)
    cur = ''
    has = false
  }
  const endCommand = () => {
    endWord()
    if (words.length) commands.push(words)
    words = []
  }
  for (let i = 0; i < input.length; i++) {
    const c = input[i]
    if (c === "'") {
      const end = input.indexOf("'", i + 1)
      const stop = end === -1 ? input.length : end
      cur += input.slice(i + 1, stop)
      has = true
      i = stop
    } else if (c === '"') {
      has = true
      for (i++; i < input.length && input[i] !== '"'; i++) {
        if (input[i] === '\\' && i + 1 < input.length) i++
        cur += input[i]
      }
    } else if (c === '\\' && i + 1 < input.length) {
      cur += input[++i]
      has = true
    } else if (/\s/.test(c) && c !== '\n') {
      endWord()
    } else if (';|&()`\n'.includes(c)) {
      endCommand()
    } else if (c === '<' || c === '>') {
      endWord()
    } else {
      cur += c
      has = true
    }
  }
  endCommand()
  return commands
}

function isRootOrHome(target, cwd) {
  const t = expand(target)
  if (/^\/+$/.test(t)) return true
  const abs = resolve(cwd, t)
  if (abs === '/' || abs === resolve(home())) return true
  return /\/\*$/.test(t) && isRootOrHome(t.slice(0, -2) || '/', cwd)
}

// catastrophicRm: rm with recursive and force flags, in any order or spelling,
// aimed at /, ~, $HOME, or their /* globs.
function catastrophicRm(words, cwd) {
  const at = words.findIndex((w) => basename(w) === 'rm')
  if (at === -1) return false
  let recursive = false
  let force = false
  const targets = []
  let flags = true
  for (const w of words.slice(at + 1)) {
    if (flags && w === '--') flags = false
    else if (flags && w.startsWith('--')) {
      if (w === '--recursive') recursive = true
      if (w === '--force') force = true
    } else if (flags && /^-[A-Za-z]+$/.test(w)) {
      if (/[rR]/.test(w)) recursive = true
      if (w.includes('f')) force = true
    } else targets.push(w)
  }
  return recursive && force && targets.some((t) => isRootOrHome(t, cwd))
}

function bashVerdict(command, cwd, depth = 0) {
  for (const words of splitCommands(command)) {
    if (catastrophicRm(words, cwd)) return { rule: 'rm -rf of / or the home directory', target: command }
    const shell = basename(words[0] ?? '')
    const nested = (SHELLS.has(shell) && words.includes('-c')) || shell === 'eval'
    for (const word of words) {
      // A quoted multi-word string is prose, not a path, unless a shell will run it.
      if (/\s/.test(word)) {
        if (nested && depth < 3) {
          const verdict = bashVerdict(word, cwd, depth + 1)
          if (verdict) return verdict
        }
        continue
      }
      for (const candidate of new Set([word, word.slice(word.indexOf('=') + 1)])) {
        const rule = candidate && ruleFor(candidate, cwd)
        if (rule) return { rule, target: candidate }
      }
    }
  }
  return null
}

function evaluate(event) {
  const input = event.tool_input ?? {}
  const cwd = typeof event.cwd === 'string' && event.cwd ? event.cwd : process.cwd()
  const str = (v) => (typeof v === 'string' && v ? v : null)
  if (event.tool_name === 'Bash') return str(input.command) ? bashVerdict(input.command, cwd) : null

  const paths = [input.file_path, input.notebook_path, input.path].map(str).filter(Boolean)
  const searchDir = str(input.path) ?? cwd
  const patterns = []
  if (event.tool_name === 'Glob') patterns.push(str(input.pattern))
  // A Grep pattern is a content regex, not a location: only its glob filters files.
  if (event.tool_name === 'Grep') patterns.push(str(input.glob))
  for (const p of paths) {
    const rule = ruleFor(p, cwd)
    if (rule) return { rule, target: p }
  }
  for (const p of patterns.filter(Boolean)) {
    const rule = ruleFor(p, resolve(cwd, expand(searchDir)))
    if (rule) return { rule, target: p }
  }
  return null
}

function deny(verdict) {
  const reason =
    `secret-guard blocked this call: rule "${verdict.rule}" (${verdict.target}). ` +
    'The user can run it manually if it is intended.'
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
    }),
  )
}

let raw = ''
let event
try {
  raw = readFileSync(0, 'utf8')
  event = JSON.parse(raw)
  if (!event || typeof event !== 'object') throw new Error('not an object')
} catch (error) {
  process.stderr.write(`secret-guard: unreadable hook input, allowing (${error.message})\n`)
  process.exit(0)
}

try {
  const verdict = evaluate(event)
  if (verdict) deny(verdict)
} catch (error) {
  // An evaluation error never blocks on its own; it blocks only when the raw input
  // already looks like a protected path or the rm -rf set.
  if (/\.env\b|\.ssh|\.credentials|Keychains|\.aws\/credentials|hosts\.yml|\.pem|\.key|secrets\/|rm\s+-/.test(raw)) {
    deny({ rule: 'internal error on a suspect call', target: error.message })
  } else {
    process.stderr.write(`secret-guard: internal error, allowing (${error.message})\n`)
  }
}
