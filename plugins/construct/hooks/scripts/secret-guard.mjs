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

// segmentRegex compiles one glob segment. A bracket class that does not compile
// (`[z-a]`) becomes `[^/]*`, so the segment can only match more, never less.
function segmentRegex(seg) {
  for (const strict of [true, false]) {
    let re = ''
    for (let i = 0; i < seg.length; i++) {
      const c = seg[i]
      if (c === '*') re += '[^/]*'
      else if (c === '?') re += '[^/]'
      else if (c === '[' && seg.indexOf(']', i + 2) !== -1) {
        const end = seg.indexOf(']', i + 2)
        re += strict ? `[${seg.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\')}]` : '[^/]*'
        i = end
      } else re += c.replace(/[.+^${}()|\\\]\[]/g, '\\$&')
    }
    try {
      return new RegExp(`^${re}$`, 'i')
    } catch {
      // retry with the permissive form
    }
  }
  return /^.*$/
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
//
// Heredocs (`<<W`, `<<'W'`, `<<"W"`, `<<-W`): the body lines after the opening line
// are data, not commands, so they are skipped here and attached to every command of
// the opening line as `heredoc: [{ text, expands }]`; bashVerdict decides what to do
// with them. The opening line itself is split and checked as usual. A heredoc with no
// terminator line is not proven to be data, so its lines stay ordinary commands.
function splitCommands(input) {
  const commands = []
  let pending = []
  let lineStart = 0
  let words = []
  let cur = ''
  let has = false
  let redir = false
  let piped = false
  const endWord = () => {
    if (has) words.push({ t: cur, r: redir })
    if (has) redir = false
    cur = ''
    has = false
  }
  const endCommand = () => {
    endWord()
    redir = false
    if (words.length) {
      words.piped = piped
      commands.push(words)
    }
    words = []
    piped = false
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
      if (c === '\n') {
        if (pending.length) {
          const last = takeHeredocs(input, i, pending, commands, lineStart)
          if (last >= 0) i = last
        }
        pending = []
        lineStart = commands.length
      }
      // `|` and `|&` feed the next command; `||` does not.
      if (c === '|') {
        if (input[i + 1] === '|') i++
        else {
          // `|&` pipes stderr too: consume the `&` so it does not end a command.
          if (input[i + 1] === '&') i++
          piped = true
        }
      }
    } else if (c === '<' || c === '>') {
      endWord()
      // Operators: >> >| >&N <<EOF; a here-string (<<<) takes data, not a file.
      const op = /^(<<<|<<-?|>>|>\||>&[0-9-]*|<&[0-9-]*|[<>])/.exec(input.slice(i))[0]
      i += op.length - 1
      if (op === '<<' || op === '<<-') {
        const d = /^[ \t]*(?:'([^']*)'|"([^"]*)"|((?:\\.|[^\s;|&()<>'"])+))/.exec(input.slice(i + 1))
        if (d) pending.push({ word: d[1] ?? d[2] ?? d[3].replace(/\\(.)/g, '$1'), strip: op === '<<-', expands: d[3] !== undefined })
      }
      redir = op !== '<<<' && !/&[0-9-]*$/.test(op) || /^[<>]&$/.test(op)
    } else {
      cur += c
      has = true
    }
  }
  endCommand()
  return commands
}

// takeHeredocs consumes the bodies of the heredocs opened on the current line. `nl` is
// the index of the newline that ends it. It returns the index of the last consumed
// character, or -1 (nothing consumed) when a terminator line is missing.
function takeHeredocs(input, nl, pending, commands, lineStart) {
  let pos = nl + 1
  const bodies = []
  for (const { word, strip, expands } of pending) {
    const lines = []
    let found = false
    while (pos <= input.length) {
      const end = input.indexOf('\n', pos)
      const line = input.slice(pos, end === -1 ? input.length : end)
      pos = end === -1 ? input.length + 1 : end + 1
      if ((strip ? line.replace(/^\t+/, '') : line) === word) {
        found = true
        break
      }
      lines.push(line)
    }
    if (!found) return -1
    bodies.push({ text: lines.join('\n'), expands })
  }
  for (const c of commands.slice(lineStart)) c.heredoc = bodies
  return pos - 1
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
const GREP_VALUES = ['-A', '-B', '-C', '-m', '-d', '-D', '--max-count', '--context', '--after-context', '--before-context', '--directories', '--devices', '--label']
// Per command, like each tool's real CLI: GNU grep -T and ag -t take no value, rg -t/-T do.
const SEARCH = {
  grep: { values: new Set(GREP_VALUES), paths: new Set(['-f', '--file']), patternFile: true },
  rg: {
    values: new Set([...GREP_VALUES, '-t', '-T', '-j', '-M', '-E', '-r', '--type', '--type-not', '--threads', '--max-depth', '--max-filesize', '--encoding', '--replace']),
    paths: new Set(['-f', '--file', '--ignore-file']),
    patternFile: true,
  },
  ag: { values: new Set(['-A', '-B', '-C', '-m', '-G', '--depth', '--context', '--after', '--before', '--max-count']), paths: new Set(['--path-to-ignore']) },
  ack: { values: new Set(['-A', '-B', '-C', '-m', '-t', '--type', '--context']), paths: new Set() },
}
for (const name of ['egrep', 'fgrep']) SEARCH[name] = SEARCH.grep
const GLOB_FLAGS = new Set(['-g', '--glob', '--include', '--exclude'])
// Commands that run, source, or read the words piped into them.
const STDIN_READERS = new Set(['xargs', 'sh', 'bash', 'zsh', 'dash', 'ksh', 'source', '.', 'eval', 'while'])
const INTERPRETERS = { python: '-c', python3: '-c', ruby: '-e', node: '-e', perl: '-e' }

function commandIndex(texts) {
  let i = 0
  while (i < texts.length && (PREFIXES.has(basename(texts[i])) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(texts[i]) || (i > 0 && texts[i].startsWith('-') && PREFIXES.has(basename(texts[i - 1]))))) i++
  return i
}

// searchRoles marks the words of a grep-like command that are not file paths: the
// pattern (first non-option word, or the -e / --regexp value) and flag values.
// Glob-valued flags (-g, --include) are returned separately and checked as globs.
function searchRoles(texts, from, spec) {
  const data = new Set()
  const globs = new Set()
  let patternGiven = false
  for (let i = from; i < texts.length; i++) {
    const w = texts[i]
    if (w === '--') {
      if (!patternGiven && i + 1 < texts.length) data.add(++i)
      break
    }
    const [long, attached] = w.startsWith('--') ? [w.slice(0, w.indexOf('=') === -1 ? undefined : w.indexOf('=')), w.includes('=')] : [w, false]
    if (/^--regexp=/.test(w)) { data.add(i); patternGiven = true }
    else if (w === '--regexp' || /^-[A-Za-z]*e$/.test(w)) { data.add(++i); patternGiven = true }
    else if (spec.paths.has(long) || (spec.patternFile && /^-[A-Za-z]*f$/.test(w))) {
      // The value is a file read by the tool: left unmarked, so it is checked as a path.
      if (long !== '--ignore-file' && spec.patternFile) patternGiven = true
      if (!attached) i++
    }
    else if (/^--(glob|include|exclude)=/.test(w)) { globs.add(i); data.add(i) }
    else if (GLOB_FLAGS.has(w)) { globs.add(++i); data.add(i) }
    else if (spec.values.has(long)) { data.add(attached ? i : ++i) }
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

// pipedWordsVerdict checks the data words an upstream echo/printf feeds a command
// that executes or reads them: they become paths or commands there.
function pipedWordsVerdict(upstream, cwd, depth) {
  for (const word of upstream) {
    if (/\s/.test(word)) {
      const verdict = depth < 3 ? bashVerdict(word, cwd, depth + 1) : null
      if (verdict) return verdict
      continue
    }
    for (const candidate of new Set([word, ...word.split(/[=:]/)])) {
      const rule = candidate && ruleFor(candidate, cwd)
      if (rule) return { rule, target: candidate }
    }
  }
  return null
}

// Interpreters that execute a heredoc body (or a script fed on stdin) rather than store it.
const HEREDOC_RUNNERS = new Set([...STDIN_READERS, ...Object.keys(INTERPRETERS), 'awk', 'gawk', 'osascript', 'php', 'lua', 'sqlite3', 'ssh', 'su'])

// heredocVerdict decides what a heredoc body means. Conservative rule: the body is data
// (cat, tee, git commit -F -, ...) unless a word up to the command name is an
// interpreter, in which case it is executed and checked as shell text (plus its quoted
// literals, for python -c style bodies). Even for data, an unquoted delimiter lets bash
// expand $(...) and backticks inside the body, so those are checked as commands.
function heredocVerdict(bodies, head, cwd, depth) {
  const runs = head.some((w) => HEREDOC_RUNNERS.has(basename(w)))
  for (const { text, expands } of bodies) {
    if (runs) {
      const verdict = bashVerdict(text, cwd, depth + 1) ?? literalRule(text, cwd)
      if (verdict) return verdict
    } else if (expands) {
      for (const m of text.matchAll(/\$\(([^)]*)\)|`([^`]*)`/g)) {
        const verdict = bashVerdict(m[1] ?? m[2], cwd, depth + 1)
        if (verdict) return verdict
      }
    }
  }
  return null
}

function bashVerdict(command, cwd, depth = 0) {
  let upstream = []
  for (const words of splitCommands(command)) {
    const texts = words.map((w) => w.t)
    if (catastrophicRm(texts, cwd)) return { rule: 'rm -rf of / or the home directory', target: command }
    const ci = commandIndex(texts)
    let cmd = basename(texts[ci] ?? '')
    let argFrom = ci + 1
    if (cmd === 'git' && texts[ci + 1] === 'grep') { cmd = 'grep'; argFrom = ci + 2 }
    if (!words.piped) upstream = []
    if (upstream.length && texts.slice(0, ci + 1).some((w) => STDIN_READERS.has(basename(w)))) {
      const verdict = pipedWordsVerdict(upstream, cwd, depth)
      if (verdict) return verdict
    }
    if (words.heredoc && depth < 3) {
      const verdict = heredocVerdict(words.heredoc, texts.slice(0, ci + 1), cwd, depth)
      if (verdict) return verdict
    }
    if (DATA_COMMANDS.has(cmd)) upstream = words.filter((w, i) => i > ci && !w.r).map((w) => w.t)
    const shell = (SHELLS.has(cmd) && texts.includes('-c')) || cmd === 'eval'
    const flag = INTERPRETERS[cmd]
    const roles = SEARCH[cmd] ? searchRoles(texts, argFrom, SEARCH[cmd]) : { data: new Set(), globs: new Set() }
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
