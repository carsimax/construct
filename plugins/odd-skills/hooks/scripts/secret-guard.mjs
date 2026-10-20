// PreToolUse hook: deny tool calls that touch secrets or run a catastrophic rm -rf.
// Stands in for a permissions.deny list, which a plugin cannot set. Read-only: it
// decides from the hook JSON alone and never touches the filesystem.
// Usage: node secret-guard.mjs   (hook JSON on stdin: tool_name, tool_input, cwd)
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, resolve } from 'node:path'

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
  const abs = resolve(isAbsolute(expand(path)) ? '/' : cwd, expand(path)).toLowerCase()
  const segs = abs.split('/').filter(Boolean)
  const name = basename(abs)
  if (TEMPLATES.has(name)) return null
  if (/^\.env(\..*|[*?[].*)?$/.test(name)) return '.env file'
  if (segs.includes('.ssh')) return '.ssh directory'
  if (segs.includes('.credentials')) return '.credentials directory'
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i] === 'library' && segs[i + 1] === 'keychains') return 'Library/Keychains'
  }
  if (abs.endsWith('/.aws/credentials')) return '.aws/credentials'
  if (abs.endsWith('/.config/gh/hosts.yml')) return '.config/gh/hosts.yml'
  if (/\.(pem|key)$/.test(name)) return '*.pem / *.key file'
  if (segs.includes('secrets')) return 'secrets directory'
  return null
}

function expandBraces(glob, depth = 0) {
  const m = /\{([^{}]*)\}/.exec(glob)
  if (!m || depth > 4) return [glob]
  return m[1].split(',').flatMap((alt) => expandBraces(glob.slice(0, m.index) + alt + glob.slice(m.index + m[0].length), depth + 1))
}

function segmentRegex(seg) {
  let re = ''
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i]
    if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else if (c === '[' && seg.indexOf(']', i + 2) !== -1) {
      const end = seg.indexOf(']', i + 2)
      re += `[${seg.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`
      i = end
    } else re += c.replace(/[.+^${}()|\\\]\[]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'i')
}

const DIR_NAMES = [['.ssh', '.ssh directory'], ['.credentials', '.credentials directory'], ['secrets', 'secrets directory']]
const FILE_NAMES = [['.env', '.env file'], ['.env.local', '.env file'], ['.env.production', '.env file'], ['x.pem', '*.pem / *.key file'], ['x.key', '*.pem / *.key file']]
const PAIRS = [['Library', 'Keychains', 'Library/Keychains'], ['.aws', 'credentials', '.aws/credentials'], ['gh', 'hosts.yml', '.config/gh/hosts.yml']]

// globRule returns the rule a glob could match: each segment becomes a regex and is
// tried against the protected names. Wildcard-only segments (`*`, `**`) are skipped,
// so listing a whole tree is not blocked, only globs that name something protected.
function globRule(glob) {
  for (const alt of expandBraces(glob)) {
    const segs = alt.split('/').filter((x) => x && x !== '.')
    const res = segs.map((x) => (/[^*?]/.test(x) ? segmentRegex(x) : null))
    for (let i = 0; i < segs.length; i++) {
      if (!res[i]) continue
      for (const [name, rule] of DIR_NAMES) if (res[i].test(name)) return rule
      if (i === segs.length - 1) for (const [name, rule] of FILE_NAMES) if (res[i].test(name)) return rule
      if (i > 0 && res[i - 1]) {
        for (const [a, b, rule] of PAIRS) if (res[i - 1].test(a) && res[i].test(b)) return rule
      }
    }
  }
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
  let redir = false
  const endWord = () => {
    if (has) words.push({ t: cur, r: redir })
    if (has) redir = false
    cur = ''
    has = false
  }
  const endCommand = () => {
    endWord()
    redir = false
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
        // Inside double quotes bash drops a backslash only before $ ` " \ or newline.
        if (input[i] === '\\' && i + 1 < input.length && '$`"\\\n'.includes(input[i + 1])) i++
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
      // Operators: >> >| >&N <<EOF; a here-string (<<<) takes data, not a file.
      const op = /^(<<<|<<-?|>>|>\||>&[0-9-]*|<&[0-9-]*|[<>])/.exec(input.slice(i))[0]
      i += op.length - 1
      redir = op !== '<<<' && !/&[0-9-]*$/.test(op) || /^[<>]&$/.test(op)
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

const PREFIXES = new Set(['sudo', 'command', 'builtin', 'env', 'nohup', 'time', 'exec', 'xargs'])
const DATA_COMMANDS = new Set(['echo', 'printf'])
const SEARCH = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack'])
const ARG_FLAGS = new Set(['-A', '-B', '-C', '-m', '-t', '-T', '-d', '-D', '--max-count', '--type', '--context'])
const GLOB_FLAGS = new Set(['-g', '--glob', '--include', '--exclude'])
const INTERPRETERS = { python: '-c', python3: '-c', ruby: '-e', node: '-e', perl: '-e' }

function commandIndex(texts) {
  let i = 0
  while (i < texts.length && (PREFIXES.has(basename(texts[i])) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(texts[i]) || (i > 0 && texts[i].startsWith('-') && PREFIXES.has(basename(texts[i - 1]))))) i++
  return i
}

// searchRoles marks the words of a grep-like command that are not file paths: the
// pattern (first non-option word, or the -e / --regexp value) and flag values.
// Glob-valued flags (-g, --include) are returned separately and checked as globs.
function searchRoles(texts, from) {
  const data = new Set()
  const globs = new Set()
  let patternGiven = false
  for (let i = from; i < texts.length; i++) {
    const w = texts[i]
    if (w === '--') {
      if (!patternGiven && i + 1 < texts.length) data.add(++i)
      break
    }
    if (/^--regexp=/.test(w)) { data.add(i); patternGiven = true }
    else if (w === '--regexp' || /^-[A-Za-z]*e$/.test(w)) { data.add(++i); patternGiven = true }
    else if (/^--(glob|include|exclude)=/.test(w)) { globs.add(i); data.add(i) }
    else if (GLOB_FLAGS.has(w)) { globs.add(++i); data.add(i) }
    else if (ARG_FLAGS.has(w)) data.add(++i)
    else if (w.startsWith('-') && w.length > 1) continue
    else if (!patternGiven) { data.add(i); patternGiven = true }
  }
  return { data, globs }
}

function literalRule(text, cwd) {
  for (const m of text.matchAll(/(["'])((?:(?!\1).)+)\1/g)) {
    const lit = m[2].replace(/^[<>+\s]+/, '')
    const rule = ruleFor(lit, cwd)
    if (rule) return { rule, target: lit }
  }
  return null
}

function bashVerdict(command, cwd, depth = 0) {
  for (const words of splitCommands(command)) {
    const texts = words.map((w) => w.t)
    if (catastrophicRm(texts, cwd)) return { rule: 'rm -rf of / or the home directory', target: command }
    const ci = commandIndex(texts)
    let cmd = basename(texts[ci] ?? '')
    let argFrom = ci + 1
    if (cmd === 'git' && texts[ci + 1] === 'grep') { cmd = 'grep'; argFrom = ci + 2 }
    const shell = (SHELLS.has(cmd) && texts.includes('-c')) || cmd === 'eval'
    const flag = INTERPRETERS[cmd]
    const roles = SEARCH.has(cmd) ? searchRoles(texts, argFrom) : { data: new Set(), globs: new Set() }
    for (let i = 0; i < words.length; i++) {
      const { t: word, r } = words[i]
      if (DATA_COMMANDS.has(cmd) && !r && i >= ci) continue
      if (roles.globs.has(i)) {
        const g = word.replace(/^--[a-z]+=/, '')
        const rule = globRule(g)
        if (rule) return { rule, target: g }
        continue
      }
      if (roles.data.has(i) && !r) continue
      if (/\s/.test(word)) {
        if (shell && depth < 3) {
          const verdict = bashVerdict(word, cwd, depth + 1)
          if (verdict) return verdict
        }
        if (flag && texts[i - 1] === flag) {
          const verdict = literalRule(word, cwd)
          if (verdict) return verdict
        }
        continue
      }
      if (flag && texts[i - 1] === flag) {
        const verdict = literalRule(word, cwd) ?? (ruleFor(word, cwd) && { rule: ruleFor(word, cwd), target: word })
        if (verdict) return verdict
        continue
      }
      for (const candidate of new Set([word, ...word.split(/[=:]/)])) {
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
    const rule = ruleFor(p, resolve(cwd, expand(searchDir))) ?? globRule(expand(p))
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
