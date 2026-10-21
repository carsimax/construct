// Destructive command rules for secret-guard.mjs (S1, gentle-parity). Port of gentle-shell
// lib/destructive-command-guard.ts and the hard-deny and confirm tiers of extensions/gentle-ai.ts.
// Pure: no I/O. secret-guard passes in its own shell-word splitter, so there is one tokenizer.
//   tier "deny": never allowed.   tier "ask": the user confirms; inside a subagent it is a deny.
import { basename } from 'node:path'
import { GIT_VALUE_FLAGS, isRootOrHome, SHELLS } from './shell-words.mjs'

const SQL_CLIENTS = new Set(['psql', 'mysql', 'mariadb', 'sqlite3'])
const DATA_COMMANDS = new Set(['echo', 'printf'])
const MAX_DEPTH = 4
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
  xargs: new Set(['-n', '-I', '-L', '-P', '-s', '-d', '-E', '-a', '-l', '-i', '--max-args', '--replace', '--max-procs', '--max-lines', '--delimiter', '--arg-file']),
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

// headIndex is the index of the word that names the command: past assignments, wrappers,
// their flags and values, and the duration `timeout` takes.
export function headIndex(texts) {
  return unwrap(texts).at
}

// npm flags that take a separate value, so the subcommand is the first word after them.
// shortcut: a value flag missing here makes its value look like the subcommand; add it to the set.
const NPM_VALUE_FLAGS = new Set(['--access', '--registry', '--otp', '--tag', '--prefix', '--workspace', '-w', '--userconfig', '--globalconfig', '--cache', '--loglevel', '--scope', '--tmp', '--before', '--omit', '--include', '--fund', '--audit-level', '--cwd', '--logs-dir', '--script-shell', '--node-options', '--provenance-file'])
function npmSubcommand(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--') return args[i + 1]
    if (!args[i].startsWith('-') || args[i] === '-') return args[i]
    if (NPM_VALUE_FLAGS.has(args[i])) i++
  }
  return undefined
}

const hasFlag = (args, short, long) => args.some((a) => (long && (a === long || a.startsWith(`${long}=`))) || (/^-[^-]/.test(a) && a.slice(1).includes(short)))

// sqlDestroys: DROP, TRUNCATE, or DELETE FROM without a real WHERE, after comments and
// string literals are removed (a table named "where" is not a predicate).
function sqlDestroys(sql) {
  const code = sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[(?:\]\]|[^\]])*\]/g, (raw) => (/^["`[]/.test(raw) ? 'identifier' : ' '))
  return code.split(';').some((statement) => {
    if (/^\s*(?:DROP\s+(?:TABLE|DATABASE|SCHEMA|INDEX|VIEW)\b|TRUNCATE\s+(?:TABLE\s+)?\S)/i.test(statement)) return true
    if (!/^\s*DELETE\s+FROM\s+\S/i.test(statement)) return false
    return !/\bWHERE\b/i.test(statement) || /\bWHERE\s+(?:1\s*=\s*1|TRUE)\s*$/i.test(statement.trim())
  })
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

// substitutionBodies lists the bodies of $(...), <(...), >(...), and backticks outside
// single quotes. A body is a command line of its own.
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
      let depth = 1
      let j = i + 2
      for (; j < command.length && depth > 0; j++) {
        if (command[j] === '(') depth++
        else if (command[j] === ')') depth--
      }
      out.push(command.slice(i + 2, depth === 0 ? j - 1 : j))
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

// gitMatches: rules for one `git` invocation (args are the words after `git`).
function gitMatches(args, add) {
  let i = 0
  while (args[i]?.startsWith('-')) i += GIT_VALUE_FLAGS.has(args[i]) ? 2 : 1
  const action = args[i]
  const flags = args.slice(i + 1)
  const force = flags.some((a) => /^--force/.test(a) || /^-[^-]*f/.test(a))
  if (action === 'reset' && flags.includes('--hard')) add('deny', 'git reset --hard')
  else if (action === 'clean' && force && (flags.includes('--directories') || flags.some((a) => /^-[^-]*d/.test(a)))) add('deny', 'git clean -fd')
  else if (action === 'clean' && force) add('ask', 'git clean -f')
  else if (action === 'push' && force) add('deny', 'force push')
  else if (action === 'push') add('ask', 'git push')
  else if (action === 'rebase') add('ask', 'git rebase')
  else if (action === 'restore') add('ask', 'git restore')
  else if (action === 'checkout' && flags.includes('--')) add('ask', 'git checkout -- <path>')
  else if (action === 'checkout' && force) add('ask', 'git checkout -f')
  else if (action === 'stash' && (flags[0] === 'drop' || flags[0] === 'clear')) add('ask', `git stash ${flags[0]}`)
  else if (action === 'branch' && (flags.some((a) => /^-[^-]*D/.test(a)) || (force && (flags.includes('--delete') || flags.some((a) => /^-[^-]*d/.test(a)))))) add('ask', 'git branch -D')
}

// findMatches returns [{ tier, rule }] for a command line, unwrapping nested shells.
function findMatches(command, deps, depth = 0) {
  if (depth > MAX_DEPTH) return []
  const { split, expand } = deps
  const matches = []
  const add = (tier, rule) => matches.push({ tier, rule })
  const { text, bodies } = extractHeredocs(command)
  const nested = (line) => matches.push(...findMatches(line, deps, depth + 1))

  for (const body of substitutionBodies(text)) nested(body)

  let previous = []
  for (const words of split(text)) {
    const live = words.filter((w) => !w.r).map((w) => w.t)
    const { name, args, lines } = nestedLines(live)
    for (const line of lines) nested(line)
    if (!words.piped) previous = []
    if (SHELLS.has(name) || name === 'eval') {
      // Its string bodies were walked above.
    } else if (SQL_CLIENTS.has(name)) {
      const payloads = args.map((a) => a.replace(/^(?:--command|--execute)=/, ''))
      if (previous.length) payloads.push(previous.join(' ').replace(/^%s\s*/, ''))
      if (payloads.some(sqlDestroys)) add('ask', 'SQL DROP/TRUNCATE/DELETE without WHERE')
    } else if (name === 'rm' && (hasFlag(args, 'r', '--recursive') || hasFlag(args, 'R'))) {
      const targets = args.filter((a) => !a.startsWith('-') || a === '-')
      if (targets.some((t) => isRootOrHome(t, expand)) || args.includes('--no-preserve-root')) add('deny', 'rm -rf of /, ~, $HOME, ., or ..')
      else add('ask', 'rm -r')
    } else if (name === 'find') {
      if (args.includes('-delete')) add('ask', 'find -delete')
      for (let i = 0; i < args.length; i++) {
        if (args[i] !== '-exec' && args[i] !== '-execdir') continue
        let end = i + 1
        while (end < args.length && args[end] !== ';' && args[end] !== '+') end++
        nested(args.slice(i + 1, end).join(' '))
        i = end
      }
    } else if (name === 'git') gitMatches(args, add)
    else if (name === 'chmod' && hasFlag(args, 'R', '--recursive') && args.some((a) => /^0?777$/.test(a))) add('deny', 'chmod -R 777')
    else if (name === 'chown' && hasFlag(args, 'R', '--recursive')) add('deny', 'chown -R')
    else if (name === 'npm' && npmSubcommand(args) === 'publish') add('deny', 'npm publish')
    if (DATA_COMMANDS.has(name)) previous = args
  }

  // Heredoc bodies are data, except when the command they feed is a shell or a SQL client.
  for (const { header, body } of bodies) {
    const segments = split(header.replace(/<<-?\s*['"]?\w+['"]?/, ' '))
    for (const words of segments) {
      const texts = words.filter((w) => !w.r).map((w) => w.t)
      const name = basename(texts[headIndex(texts)] ?? '')
      if (SHELLS.has(name) && !texts.includes('-c')) nested(body)
      else if (SQL_CLIENTS.has(name) && sqlDestroys(body)) add('ask', 'SQL DROP/TRUNCATE/DELETE without WHERE')
    }
  }
  return matches
}

// commandVerdict returns null, or { rule, decision: 'deny' | 'ask', reason }. A deny beats an
// ask. Inside a subagent nothing can answer a confirmation, so an ask becomes a deny.
export function commandVerdict(command, { split, expand, subagent = false }) {
  const matches = findMatches(command, { split, expand })
  const hit = matches.find((m) => m.tier === 'deny') ?? matches[0]
  if (!hit) return null
  if (hit.tier === 'deny') {
    return { rule: hit.rule, decision: 'deny', reason: `command-guard blocked this command: rule "${hit.rule}". Ask the user for a safer plan, or let them run it manually.` }
  }
  if (subagent) {
    return { rule: hit.rule, decision: 'deny', reason: `command-guard blocked this command: rule "${hit.rule}" needs the user's confirmation, and a subagent cannot ask. Report it to the parent, which can run it after the user agrees.` }
  }
  return { rule: hit.rule, decision: 'ask', reason: `command-guard: rule "${hit.rule}" changes or discards data. Confirm to run it.` }
}
