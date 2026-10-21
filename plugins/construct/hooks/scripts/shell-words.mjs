// Shell-word tokenizer shared by the command hooks (secret-guard and publication-gate).
// Pure: no I/O.
import { resolve } from 'node:path'

export const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh'])
// Flags of `git` that take a value, so the next word is not the subcommand.
export const GIT_VALUE_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env'])

// shortcut: `~/sub` and `$HOME/sub` are not a root target (command-guard asks for rm -r, as
// upstream denies only the roots themselves); upgrade if a deny for home subtrees is wanted.
const ROOTISH = /^(?:\/(?:\*+)?|~\/?|\$\{?HOME\}?\/?)$/
const DOTS = /^\.{1,2}\/?$/

// isRootOrHome: the one rm-root rule of both guards. True for /, ~, $HOME, and a `/*` glob of
// one of them. Without `at`, `.` and `..` count too; with `at` ({ cwd, home }) a path counts
// when it resolves to / or home, so a `.` in prose is not a root unless the cwd is one.
export function isRootOrHome(target, expand, at) {
  const t = expand(target)
  if (ROOTISH.test(target) || ROOTISH.test(t)) return true
  if (at) {
    const abs = resolve(at.cwd, t)
    if (abs === '/' || abs === resolve(at.home)) return true
  } else if (DOTS.test(target)) return true
  return /\/\*$/.test(target) && isRootOrHome(target.slice(0, -2) || '/', expand, at)
}

// splitCommands is a small shell-word splitter: quotes and backslashes group a word,
// unquoted ; | & ( ) ` newline end a command, and < > are dropped as separators so
// `cat <.env` yields the word `.env`. Each returned word keeps whether it was quoted.
export function splitCommands(input) {
  const commands = []
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
        if (input[i] === '\\' && input[i + 1] === '\n') { i++; continue }
        if (input[i] === '\\' && i + 1 < input.length && '$`"\\'.includes(input[i + 1])) i++
        cur += input[i]
      }
    } else if (c === '\\' && input[i + 1] === '\n') {
      i++ // a continuation line joins before tokenizing
    } else if (c === '\\' && i + 1 < input.length) {
      cur += input[++i]
      has = true
    } else if (/\s/.test(c) && c !== '\n') {
      endWord()
    } else if (';|&()`\n'.includes(c)) {
      endCommand()
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
      redir = op !== '<<<' && !/&[0-9-]*$/.test(op) || /^[<>]&$/.test(op)
    } else {
      cur += c
      has = true
    }
  }
  endCommand()
  return commands
}
