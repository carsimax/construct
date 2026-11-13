// Shell parsing and command unwrapping for the publication gate, the command guard, and the review
// store guard. The shell grammar is read by sh-syntax 0.8.4 (mvdan/sh v3.14.1 compiled to standard
// Go WASM, MIT, vendored unmodified as ../vendor/sh-syntax, see its LICENSE), so a command
// hidden inside `$( )`, `case`, a heredoc, `${a:-'})'}`, or a quoted spelling is found as bash finds it.
// Text the parser rejects throws ShellParseError: bash can still run the part before a syntax
// error, so the callers deny it instead of guessing.
import { createRequire } from 'node:module'
import { basename } from 'node:path'

export const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])
// Commands whose arguments or input run as shell code.
const RUNNERS = new Set([...SHELLS, 'eval', 'source', '.'])
// Flags of `git` that take a value, so the next word is not the subcommand.
export const GIT_VALUE_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env'])

export class ShellParseError extends Error {}

// The 3.8 MB parser loads on the first parse only.
let syntax
const parser = () => (syntax ??= createRequire(import.meta.url)('../vendor/sh-syntax/lib/sync/index.cjs'))

// ANSI-C quoting: $'\x67it' is the word git.
const ANSI = { a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' }
const ansiC = (text) =>
  text.replace(/\\(?:([abeEfnrtv\\'"?])|x([0-9a-fA-F]{1,2})|u([0-9a-fA-F]{1,4})|U([0-9a-fA-F]{1,8})|([0-7]{1,3})|c(.))/g, (m, c, x, u, big, oct, ctl) => {
    if (c) return ANSI[c]
    if (x) return String.fromCharCode(parseInt(x, 16))
    if (u || big) return String.fromCodePoint(parseInt(u ?? big, 16))
    if (oct) return String.fromCharCode(parseInt(oct, 8) & 255)
    return String.fromCharCode(ctl.charCodeAt(0) & 31)
  })

// splitCommands parses `input` and returns every simple command in it, in source order, nested
// ones included (`$( )`, backticks, `<( )`, subshells, `case`, loops, `${a:-$(...)}`, heredoc
// expansions). Each command is an array of words:
//   t  the word's literal text; quotes and escapes resolved, an expansion (`$x`, `$(...)`) kept as written;
//   r  a redirection target (not an argument);
//   h  a here-string (`<<< text`): data for the command, and a script when the command is a shell;
//   s  the word's source text.
// Assignments (`FOO=1 git`) and `export`/`declare` arguments are words too. Properties of the array:
//   parens     the `(` and `)` of subshells and substitutions opened or closed since the previous command, in order;
//   heredocs   the source of each heredoc body fed to the command;
//   pipeline   the same object for every command of one pipeline;
//   simple     true when the command is a plain call (not a block, `if`, loop, `case`, subshell, or function);
//   parent     the command whose substitution or body holds this one.
// Throws ShellParseError when the text is not valid shell.
// A text is parsed once per process: bash-guard.mjs runs three guards over one command, and each reads the same text (and its nested lines).
// The result is shared and read-only; a failure is cached too.
const parsed = new Map()
export function splitCommands(input) {
  if (!parsed.has(input)) {
    // Any failure (parse, walk, or word extraction) is a ShellParseError, so no caller fails open on it.
    try {
      parsed.set(input, readCommands(input))
    } catch (error) {
      parsed.set(input, error instanceof ShellParseError ? error : new ShellParseError(typeof error?.Error === 'function' ? error.Error() : (error?.message ?? String(error))))
    }
  }
  const result = parsed.get(input)
  if (result instanceof ShellParseError) throw result
  return result
}

function readCommands(input) {
  const sh = parser()
  const file = sh.parse(input)
  const bytes = Buffer.from(input) // node offsets are UTF-8 byte offsets
  const raw = (node) => bytes.subarray(node.start, node.end).toString()
  const part = (p, quoted) => {
    switch (p.type) {
      case 'Lit': return quoted ? p.value.replace(/\\([$`"\\])|\\\n/g, (_, c) => c ?? '') : p.value.replace(/\\([\s\S])/g, (_, c) => (c === '\n' ? '' : c))
      case 'SglQuoted': return p.dollar ? ansiC(p.value) : p.value
      case 'DblQuoted': return p.parts.map((q) => part(q, true)).join('')
      default: return raw(p)
    }
  }
  const text = (word) => word.parts.map((p) => part(p, false)).join('')
  const word = (w, extra) => ({ t: text(w), r: false, h: false, s: raw(w), ...extra })
  const assign = (a) => {
    if (a.array) return { t: raw(a), r: false, h: false, s: raw(a) }
    if (a.name === null) return word(a.value) // a declare flag: `-x`
    const value = a.value === null ? '' : text(a.value)
    return { t: `${a.name.value}${a.append ? '+' : ''}${a.naked ? '' : '='}${value}`, r: false, h: false, s: raw(a) }
  }
  const commands = []
  const stack = []
  const stmts = [] // the enclosing Stmt commands, innermost last
  const PIPES = new Set([sh.BinCmdOperator.Pipe, sh.BinCmdOperator.PipeAll])
  let parens = ''
  let pipeline = null
  let pipeDepth = 0
  sh.walk(file, {
    enter(node) {
      const type = node.type
      stack.push(type === 'BinaryCmd' && PIPES.has(node.op) ? 'Pipe' : type)
      if (type === 'Subshell' || type === 'CmdSubst' || type === 'ProcSubst') parens += '('
      else if (type === 'BinaryCmd' && PIPES.has(node.op)) {
        if (pipeDepth++ === 0) pipeline = {}
      } else if (type === 'Stmt') {
        const words = []
        const cmdType = node.cmd === null ? null : node.cmd.type
        if (cmdType === 'CallExpr') words.push(...node.cmd.assigns.map(assign), ...node.cmd.args.map((w) => word(w)))
        else if (cmdType === 'DeclClause') {
          const name = node.cmd.variant?.value ?? ''
          words.push({ t: name, r: false, h: false, s: name }, ...node.cmd.args.map(assign))
        }
        const heredocs = []
        for (const redir of node.redirs) {
          if (redir.hdoc) heredocs.push(redir.hdoc.parts.every((p) => p.type === 'Lit') ? redir.hdoc.parts.map((p) => p.value).join('') : raw(redir.hdoc).replace(/\n?[ \t]*[^\n]*$/, '\n'))
          if (redir.op === sh.RedirOperator.WordHdoc) words.push(word(redir.word, { h: true }))
          else words.push(word(redir.word, { r: true }))
        }
        Object.assign(words, { parens: words.length > 0 ? parens : '', heredocs, pipeline, simple: cmdType === 'CallExpr', parent: stmts.at(-1) ?? null })
        stmts.push(words)
        if (words.length > 0) {
          parens = ''
          commands.push(words)
        }
      }
    },
    exit(node) {
      const type = stack.pop()
      if (type === 'Stmt') stmts.pop()
      if (type === 'Subshell' || type === 'CmdSubst' || type === 'ProcSubst') parens += ')'
      else if (type === 'Pipe' && --pipeDepth === 0) pipeline = null
    }
  })
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


// heredocScripts maps each command to the heredoc and here-string bodies it feeds, as
// `{ text, strict }`. A body is strict (a script: a parse failure denies) when its command, a
// command of its pipeline, or an enclosing command is a shell, `eval`, `source`, or `.`, or when
// the command is not a plain call (block, `if`, loop, `case`, subshell, function). Every other body
// reaches a consumer the parser cannot name (`f` defined as `bash`, an alias, `su -c`, `ssh`, ...), so
// it is read best-effort: `parsesAsShell` tells whether to check it. The accepted cost: a body that
// parses and has a line starting with `git push` is denied even when it was meant as data.
export function heredocScripts(commands) {
  const groups = new Map()
  for (const command of commands) {
    const key = command.pipeline ?? command
    groups.set(key, [...(groups.get(key) ?? []), command])
  }
  const runner = (c) => c.simple && RUNNERS.has(nestedLines(c.filter((w) => !w.r).map((w) => w.t)).name)
  const runs = (c) => runner(c) || (c.pipeline !== null && (groups.get(c.pipeline) ?? []).some(runner))
  const scripts = new Map()
  for (const c of commands) {
    const bodies = [...c.heredocs, ...c.filter((w) => w.h).map((w) => w.t)]
    if (bodies.length === 0) continue
    let strict = !c.simple
    for (let up = c; !strict && up; up = up.parent) strict = runs(up)
    scripts.set(c, bodies.map((text) => ({ text, strict })))
  }
  return scripts
}

// parsesAsShell is true when `text` is valid shell: a best-effort body that is not is data.
export function parsesAsShell(text) {
  try {
    splitCommands(text)
    return true
  } catch (error) {
    if (error instanceof ShellParseError) return false
    throw error
  }
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
