// Shell-word tokenizer and command unwrapping for the publication gate.
// Pure: no I/O.
import { basename } from 'node:path'

export const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])
// Flags of `git` that take a value, so the next word is not the subcommand.
export const GIT_VALUE_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env'])

// splitCommands is a small shell-word splitter: quotes and backslashes group a word,
// unquoted ; | & ( ) ` newline end a command, and < > are dropped as separators so
// `cat <.env` yields the word `.env`. A bare digit word glued to < or > is the redirection's
// file descriptor and is dropped (`2>&1`), and `&>` / `&>>` redirect instead of ending the
// command. Each returned word keeps whether it was quoted (`r`: redirection target) and its raw source text (`s`, quotes intact).
// Each command keeps the unquoted `(` and `)` seen since the previous command, in order (`parens`), so a caller can end a subshell.
export function splitCommands(input) {
  const commands = []
  let words = []
  let parens = ''
  let cur = ''
  let has = false
  let plain = true // no quote or backslash went into the current word
  let redir = false
  let piped = false
  let ws = 0 // index where the current word's raw source starts
  const endWord = (end) => {
    if (has) words.push({ t: cur, r: redir, s: input.slice(ws, end).trim() })
    if (has) redir = false
    cur = ''
    has = false
    plain = true
  }
  const endCommand = (end) => {
    endWord(end)
    redir = false
    if (words.length) {
      words.piped = piped
      words.parens = parens
      parens = ''
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
      plain = false
      i = stop
    } else if (c === '"') {
      has = true
      plain = false
      for (i++; i < input.length && input[i] !== '"'; i++) {
        // A `$(...)` inside double quotes is one span: its own quotes do not close the string.
        const end = input[i] === '$' && input[i + 1] === '(' ? closingParen(input, i + 2) : -1
        if (end > 0) {
          cur += input.slice(i, end + 1)
          i = end
          continue
        }
        // Inside double quotes bash drops a backslash only before $ ` " \ or newline.
        if (input[i] === '\\' && input[i + 1] === '\n') { i++; continue }
        if (input[i] === '\\' && i + 1 < input.length && '$`"\\'.includes(input[i + 1])) i++
        cur += input[i]
      }
    } else if (c === '\\' && input[i + 1] === '\n') {
      i++ // a continuation line joins before tokenizing
    } else if (c === '\\' && i + 1 < input.length) {
      cur += input[++i]
      has = true
      plain = false
    } else if (/\s/.test(c) && c !== '\n') {
      endWord(i)
    } else if (';|&()`\n'.includes(c) && !(c === '&' && input[i + 1] === '>')) {
      endCommand(i)
      if (c === '(' || c === ')') parens += c
      // `|` and `|&` feed the next command; `||` does not.
      if (c === '|') {
        if (input[i + 1] === '|') i++
        else {
          // `|&` pipes stderr too: consume the `&` so it does not end a command.
          if (input[i + 1] === '&') i++
          piped = true
        }
      }
    } else if (c === '<' || c === '>' || c === '&') {
      if (c !== '&' && plain && /^[0-9]+$/.test(cur)) { cur = ''; has = false }
      endWord(i)
      // Operators: >> >| >&N &>> &> <<EOF; a here-string (<<<) takes data, not a file.
      const op = /^(<<<|<<-?|>>|>\||>&[0-9-]*|<&[0-9-]*|&>>|&>|[<>])/.exec(input.slice(i))[0]
      i += op.length - 1
      redir = op !== '<<<' && !/&[0-9-]*$/.test(op) || /^[<>]&$/.test(op)
    } else {
      cur += c
      has = true
    }
    if (!has) ws = i + 1
  }
  endCommand(input.length)
  return commands
}

// Words that keep command position for the next word, and the flags of each that take a value.
// shortcut: wrapper flags are skipped by shape (a leading `-`, plus the listed value flags);
// upgrade to per-wrapper grammars if a wrapper hides a command behind an unlisted value flag.
const WRAPPERS = {
  sudo: new Set(['-u', '-g', '-C', '-h', '-p', '-r', '-t', '-U', '-D', '--user', '--group', '--host', '--prompt', '--chdir', '--role', '--type', '--other-user', '--close-from']),
  command: new Set(),
  builtin: new Set(),
  env: new Set(['-u', '-C', '-S', '--unset', '--chdir', '--split-string']),
  nohup: new Set(),
  time: new Set(),
  exec: new Set(['-a']),
  xargs: new Set(['-a', '-d', '-E', '-I', '-J', '-L', '-n', '-P', '-R', '-S', '-s', '--max-args', '--max-procs', '--max-chars', '--process-slot-var', '--delimiter', '--arg-file']),
  nice: new Set(['-n', '--adjustment']),
  ionice: new Set(['-c', '-n', '-p', '--class', '--classdata', '--pid']),
  timeout: new Set(['-s', '-k', '--signal', '--kill-after']),
  '!': new Set(),
  '{': new Set(),
  if: new Set(),
  then: new Set(),
  else: new Set(),
  elif: new Set(),
  do: new Set(),
  while: new Set(),
  until: new Set(),
}
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

// unwrap walks past assignments, wrappers, their flags and values, and the positional
// argument `timeout` takes (its DURATION). `at` is the index of the word that names the
// command; `strings` are `env -S`/`--split-string` values, each a command line of its own
// (env splits it into the command and its arguments, so the rest of the words follow it).
function unwrap(texts) {
  const strings = []
  let i = 0
  while (i < texts.length) {
    const w = basename(texts[i])
    if (ASSIGNMENT.test(texts[i])) i++
    else if (Object.hasOwn(WRAPPERS, w)) {
      const values = WRAPPERS[w]
      i++
      while (i < texts.length) {
        const t = texts[i]
        if (t === '--') { i++; break }
        if (!t.startsWith('-') || t.length === 1) {
          if (w === 'env' && ASSIGNMENT.test(t)) { i++; continue }
          break
        }
        if (w === 'env' && /^-S./.test(t)) strings.push(t.slice(2))
        else if (w === 'env' && t.startsWith('--split-string=')) strings.push(t.slice('--split-string='.length))
        else if (w === 'env' && (t === '-S' || t === '--split-string') && texts[i + 1] !== undefined) strings.push(texts[i + 1])
        i += values.has(t) ? 2 : 1
      }
      if (w === 'timeout' && i < texts.length) i++
    } else break
  }
  return { at: i, strings, rest: texts.slice(i) }
}

const HEREDOC_RE = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1[^\n]*\n[\s\S]*?\n[ \t]*\2(?=\n|$)/g

// extractHeredocs removes heredoc bodies from the command (they are data) and returns them
// with the header line they belong to, so a body fed to a shell or SQL client is checked.
export function extractHeredocs(command) {
  const bodies = []
  const text = command.replace(HEREDOC_RE, (raw, _q, _tag, offset) => {
    const nl = raw.indexOf('\n')
    const lineStart = command.lastIndexOf('\n', offset - 1) + 1
    const header = command.slice(lineStart, offset) + raw.slice(0, nl)
    bodies.push({ header, body: raw.slice(nl + 1, raw.lastIndexOf('\n')) })
    return raw.slice(0, nl)
  })
  return { text, bodies }
}

// closingBacktick returns the index of the backtick that closes the span opened before `from`, or -1.
export function closingBacktick(text, from) {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '\\') i++
    else if (text[i] === '`') return i
  }
  return -1
}

// closingParen returns the index of the `)` that closes a `$(` whose body starts at `from`, or -1.
// The body is scanned with quote state: a `)` inside single or double quotes, after a backslash,
// or inside a nested `$(...)` or backtick span does not close it.
export function closingParen(text, from) {
  for (let i = from; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') i++
    else if (c === "'") {
      i = text.indexOf("'", i + 1)
      if (i < 0) return -1
    } else if (c === '"') {
      i = closingDouble(text, i + 1)
      if (i < 0) return -1
    } else if (c === '`') {
      i = closingBacktick(text, i + 1)
      if (i < 0) return -1
    } else if (c === '$' && text[i + 1] === '(') {
      i = closingParen(text, i + 2)
      if (i < 0) return -1
    } else if (c === ')') return i
  }
  return -1
}

// closingDouble returns the index of the `"` that closes a double-quoted string whose body starts
// at `from`, or -1. Substitutions inside it are skipped whole.
function closingDouble(text, from) {
  for (let i = from; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') i++
    else if (c === '"') return i
    else if (c === '`') {
      i = closingBacktick(text, i + 1)
      if (i < 0) return -1
    } else if (c === '$' && text[i + 1] === '(') {
      i = closingParen(text, i + 2)
      if (i < 0) return -1
    }
  }
  return -1
}

// substitutionBodies lists the bodies of $(...), <(...), >(...), and backticks outside
// single quotes. A body is a command line of its own (its own substitutions are found when it is read).
export function substitutionBodies(command) {
  const out = []
  let quote = null
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote === "'") {
      if (c === "'") quote = null
    } else if (c === '\\') i++
    else if (c === "'" && quote === null) quote = "'"
    else if (c === '"') quote = quote === '"' ? null : '"'
    else if ((c === '$' || c === '<' || c === '>') && command[i + 1] === '(' && (c === '$' || quote === null)) {
      const end = closingParen(command, i + 2)
      out.push(command.slice(i + 2, end < 0 ? command.length : end))
      i = end < 0 ? command.length : end
    } else if (c === '`') {
      let j = i + 1
      while (j < command.length && command[j] !== '`') j += command[j] === '\\' ? 2 : 1
      out.push(command.slice(i + 1, j).replace(/\\([\\$`])/g, '$1'))
      i = j
    }
  }
  return out
}

// nestedLines lists the command lines one simple command (its live words) runs as a string:
// `env -S "..."` values (followed by the words after them), the body of `sh|bash|zsh -c [--] 'cmd'`,
// and `eval` arguments. `at` and `name` are the head word's index and basename, `args` the words after it.
export function nestedLines(live) {
  const { at, strings } = unwrap(live)
  const lines = strings.map((text) => [text, ...live.slice(at)].join(' '))
  const name = basename(live[at] ?? '')
  const args = live.slice(at + 1)
  if (SHELLS.has(name)) {
    const flag = args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a))
    const body = flag + 1 < args.length && args[flag + 1] === '--' ? flag + 2 : flag + 1
    if (flag >= 0 && args[body] !== undefined) lines.push(args[body])
  } else if (name === 'eval') lines.push((args[0] === '--' ? args.slice(1) : args).join(' '))
  return { at, name, args, lines }
}
